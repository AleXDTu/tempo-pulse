//! 前端可调用的命令。写操作统一走 persist_and_broadcast：
//! 落盘 → 广播 config-changed → 立即推一次 tick，保证所有窗口一致。

use crate::engine::{self, Skipped};
use crate::model::{self, AppConfig, PulseState, Schedule, Settings, StateKind};
use crate::state::AppState;
use crate::windows;
use chrono::Local;
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub fn get_config(app: AppHandle) -> AppConfig {
    app.state::<AppState>().config.read().unwrap().clone()
}

#[tauri::command]
pub fn get_snapshot(app: AppHandle) -> engine::PulseSnapshot {
    engine::current_snapshot(&app)
}

#[tauri::command]
pub fn save_states(app: AppHandle, states: Vec<PulseState>) -> Result<(), String> {
    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.write().unwrap();
        cfg.states = states;
        model::save(&st.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    broadcast_config(&app);
    Ok(())
}

#[tauri::command]
pub fn save_schedules(app: AppHandle, schedules: Vec<Schedule>) -> Result<(), String> {
    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.write().unwrap();
        cfg.schedules = schedules;
        model::save(&st.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    broadcast_config(&app);
    Ok(())
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let autostart = settings.autostart;
    let mini_visible = settings.mini.visible;
    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.write().unwrap();
        // 迷你窗位置由窗口层管理，防止前端旧值覆盖
        let (px, py) = (cfg.settings.mini.x, cfg.settings.mini.y);
        cfg.settings = settings;
        cfg.settings.mini.x = px;
        cfg.settings.mini.y = py;
        model::save(&st.config_path, &cfg).map_err(|e| e.to_string())?;
    }

    use tauri_plugin_autostart::ManagerExt;
    if let Err(e) = if autostart {
        app.autolaunch().enable()
    } else {
        app.autolaunch().disable()
    } {
        eprintln!("[tempo-pulse] 设置自启失败: {e}");
    }

    windows::set_mini_visible(&app, mini_visible);
    broadcast_config(&app);
    Ok(())
}

#[tauri::command]
pub fn set_mini_visible(app: AppHandle, visible: bool) {
    windows::set_mini_visible(&app, visible);
    broadcast_config(&app);
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) {
    windows::show_main(&app);
}

/// 打开配置目录（用户可手动修正法定节假日/调休数据）
#[tauri::command]
pub fn open_config_dir(app: AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

/// 开始 / 停止节奏总开关：停止时引擎不计时。
/// 重新开始会重置切换记忆，当前块按「新进入」处理（在休息块内则立即弹休息屏）。
pub fn do_set_running(app: &AppHandle, running: bool) {
    {
        let st = app.state::<AppState>();
        {
            let mut cfg = st.config.write().unwrap();
            cfg.settings.running = running;
            let _ = model::save(&st.config_path, &cfg);
        }
        let mut g = st.engine.write().unwrap();
        g.reset();
    }
    if !running {
        windows::hide_rest(app);
        let _ = app.emit(crate::EV_REST_DISMISSED, ());
    }
    broadcast_config(app);
}

#[tauri::command]
pub fn set_running(app: AppHandle, running: bool) {
    do_set_running(&app, running);
}

/// 跳过当前时间块：本块静默（视作空闲），下一块照常。
/// 托盘菜单与命令共用。
pub fn do_skip(app: &AppHandle) {
    let snap = engine::current_snapshot(app);
    let Some(block_id) = snap.block_id.clone() else {
        return;
    };
    {
        let st = app.state::<AppState>();
        let mut g = st.engine.write().unwrap();
        g.skipped = Some(Skipped { block_id, date: Local::now().date_naive() });
        g.rest_dismissed_block = None;
    }
    let was_rest = snap
        .state
        .as_ref()
        .map(|s| s.kind == StateKind::Rest)
        .unwrap_or(false);
    if was_rest {
        windows::hide_rest(app);
        let _ = app.emit(crate::EV_REST_DISMISSED, ());
    }
    let fresh = engine::current_snapshot(app);
    engine::emit_tick(app, &fresh);
    crate::tray::update(app, fresh.state.as_ref());
}

#[tauri::command]
pub fn skip_current_block(app: AppHandle) {
    do_skip(&app);
}

/// 关掉休息屏但不跳过休息（该块内不再弹出）
#[tauri::command]
pub fn dismiss_rest_screen(app: AppHandle) {
    let snap = engine::current_snapshot(&app);
    {
        let st = app.state::<AppState>();
        let mut g = st.engine.write().unwrap();
        if let Some(id) = snap.block_id.clone() {
            g.rest_dismissed_block = Some(id);
        }
    }
    windows::hide_rest(&app);
    let _ = app.emit(crate::EV_REST_DISMISSED, ());
}

/// 保存休息屏背景图（dataURL），返回资产绝对路径（前端 convertFileSrc 加载）
#[tauri::command]
pub fn save_rest_bg_image(app: AppHandle, data_url: String) -> Result<String, String> {
    use base64::Engine;
    let (_, b64) = data_url.split_once(',').ok_or("无效的 dataURL")?;
    let meta = data_url.split(',').next().unwrap_or_default();
    let mime = meta
        .strip_prefix("data:")
        .and_then(|m| m.split(';').next())
        .unwrap_or("");
    let ext = match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => return Err(format!("不支持的图片格式: {mime}")),
    };
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| e.to_string())?;

    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // 清掉旧背景
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with("rest-bg.") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let path = dir.join(format!("rest-bg.{ext}"));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

/// 节假日数据概况（供设置页展示）
#[tauri::command]
pub fn get_holiday_info(app: AppHandle) -> serde_json::Value {
    let st = app.state::<AppState>();
    let store = st.holidays.read().unwrap();
    let last_updated = st.config.read().unwrap().settings.legal_days.last_updated.clone();
    serde_json::json!({
        "years": store.year_list(),
        "lastUpdated": last_updated,
    })
}

/// 手动触发节假日数据检查更新，返回结果文案
#[tauri::command]
pub async fn check_holiday_update(app: AppHandle) -> Result<String, String> {
    crate::holidays::check_update(&app).await
}

pub(crate) fn broadcast_config(app: &AppHandle) {
    let cfg = {
        let st = app.state::<AppState>();
        let cfg = st.config.read().unwrap().clone();
        let _ = model::save(&st.config_path, &cfg);
        cfg
    };
    let _ = app.emit(crate::EV_CONFIG_CHANGED, &cfg);
    let snap = engine::current_snapshot(app);
    engine::emit_tick(app, &snap);
}

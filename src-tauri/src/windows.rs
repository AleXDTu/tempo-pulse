//! 三窗口生命周期管理：主窗（配置声明）/ 迷你悬浮窗 / 全屏休息屏。
//! 迷你窗与休息屏由 Rust 按需创建，位置与可见性来自配置。

use crate::state::AppState;
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};

pub const MAIN: &str = "main";
pub const MINI: &str = "mini";
pub const REST: &str = "rest";

const MINI_W: f64 = 232.0;
const MINI_H: f64 = 72.0;

const REST_FULL_W: f64 = 900.0;
const REST_FULL_H: f64 = 640.0;
const REST_WIN_W: f64 = 380.0;
const REST_WIN_H: f64 = 520.0;

/// 迷你窗悬浮行为：置顶 + macOS 跨 Space 常驻
fn apply_mini_float(win: &tauri::WebviewWindow, on: bool) {
    let _ = win.set_always_on_top(on);
    let _ = win.set_visible_on_all_workspaces(on);
}

pub fn create_mini(app: &AppHandle) -> tauri::Result<()> {
    let st = app.state::<AppState>();
    let (saved_x, saved_y, visible, always_visible) = {
        let cfg = st.config.read().unwrap();
        let m = &cfg.settings.mini;
        (m.x, m.y, m.visible, m.always_visible)
    };

    #[allow(unused_mut)]
    let mut builder = WebviewWindowBuilder::new(
        app,
        MINI,
        WebviewUrl::App("mini.html".into()),
    )
    .title("Tempo Pulse Mini")
    .inner_size(MINI_W, MINI_H)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .resizable(false)
    .maximizable(false)
    .always_on_top(true)
    .visible(visible);

    // macOS 上 skip_taskbar 会把整个应用藏出 Dock（含主窗），只对 Win/Linux 生效
    #[cfg(not(target_os = "macos"))]
    {
        builder = builder.skip_taskbar(true);
    }

    let win = builder.build()?;

    apply_mini_float(&win, always_visible);

    // 保存过位置则物理坐标精确还原；否则默认贴主屏右上角
    match (saved_x, saved_y) {
        (Some(x), Some(y)) => {
            win.set_position(PhysicalPosition::new(x as i32, y as i32))?;
        }
        _ => {
            if let Ok(Some(monitor)) = app.primary_monitor() {
                let sf = monitor.scale_factor();
                let phys_w = (MINI_W * sf) as i32;
                let mx = monitor.position().x;
                let my = monitor.position().y;
                let mw = monitor.size().width as i32;
                win.set_position(PhysicalPosition::new(mx + mw - phys_w - 16, my + 48))?;
            }
        }
    }
    Ok(())
}

pub fn create_rest(app: &AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, REST, WebviewUrl::App("rest.html".into()))
        .title("休息一下")
        .inner_size(REST_FULL_W, REST_FULL_H)
        .decorations(false)
        .shadow(false)
        .transparent(true)
        .resizable(true)
        .always_on_top(true)
        .visible(false)
        .build()?;
    Ok(())
}

pub fn show_rest(app: &AppHandle) {
    let mode = {
        let st = app.state::<AppState>();
        let cfg = st.config.read().unwrap();
        cfg.settings.rest_screen.mode.clone()
    };
    if let Some(win) = app.get_webview_window(REST) {
        match mode.as_str() {
            "window" => {
                // 小窗模式：置顶弹出、可拖动
                let _ = win.set_fullscreen(false);
                let _ = win.set_size(tauri::LogicalSize::new(REST_WIN_W, REST_WIN_H));
                let _ = win.center();
            }
            _ => {
                // 全屏模式
                let _ = win.set_size(tauri::LogicalSize::new(REST_FULL_W, REST_FULL_H));
                let _ = win.set_fullscreen(true);
            }
        }
        let _ = win.show();
        let _ = win.set_focus();
    }
}

pub fn hide_rest(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(REST) {
        // 先隐藏再退全屏：若先退全屏，退出动画期间窗口会以
        // 无边框小窗形态短暂可见且无法拖动（用户误以为跳过失效）
        let _ = win.hide();
        let _ = win.set_fullscreen(false);
    }
}

pub fn set_mini_visible(app: &AppHandle, visible: bool) {
    if let Some(win) = app.get_webview_window(MINI) {
        let always_visible = {
            let st = app.state::<AppState>();
            let cfg = st.config.read().unwrap();
            cfg.settings.mini.always_visible
        };
        apply_mini_float(&win, always_visible);
        if visible {
            let _ = win.show();
            let _ = win.set_focus();
        } else {
            let _ = win.hide();
        }
    }
    let st = app.state::<AppState>();
    let mut cfg = st.config.write().unwrap();
    if cfg.settings.mini.visible != visible {
        cfg.settings.mini.visible = visible;
        let _ = crate::model::save(&st.config_path, &cfg);
    }
}

pub fn toggle_mini(app: &AppHandle) {
    let visible = app
        .get_webview_window(MINI)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false);
    set_mini_visible(app, !visible);
}

pub fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window(MAIN) {
        let focused = win.is_focused().unwrap_or(false);
        if focused {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
    }
}

/// 迷你窗位置持久化（带节流，Moved 事件高频触发）
pub fn save_mini_position(app: &AppHandle, pos: PhysicalPosition<i32>) {
    use std::sync::atomic::{AtomicU64, Ordering};
    static LAST_SAVE_MS: AtomicU64 = AtomicU64::new(0);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_SAVE_MS.load(Ordering::Relaxed);
    if now.saturating_sub(last) < 800 {
        return;
    }
    LAST_SAVE_MS.store(now, Ordering::Relaxed);

    let st = app.state::<AppState>();
    let mut cfg = st.config.write().unwrap();
    cfg.settings.mini.x = Some(pos.x as f64);
    cfg.settings.mini.y = Some(pos.y as f64);
    let _ = crate::model::save(&st.config_path, &cfg);
}

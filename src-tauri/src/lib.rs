//! Tempo Pulse —— 自定义时间节奏的桌面伴侣。
//! 架构：计时引擎跑在 Rust 进程（托盘常驻），窗口只是视图，
//! 前端通过事件订阅引擎，写操作通过命令回到 Rust 落盘并广播。

mod commands;
mod engine;
mod model;
mod state;
mod tray;
mod windows;

use state::AppState;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

pub const EV_TICK: &str = "pulse://tick";
pub const EV_TRANSITION: &str = "pulse://transition";
pub const EV_CONFIG_CHANGED: &str = "pulse://config-changed";
pub const EV_REST_DISMISSED: &str = "pulse://rest-dismissed";

fn register_shortcuts(app: &AppHandle) {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
    let gs = app.global_shortcut();
    if let Err(e) = gs.on_shortcut("CmdOrCtrl+Shift+M", |app, _s, e| {
        if e.state == ShortcutState::Pressed {
            windows::toggle_main(app);
        }
    }) {
        eprintln!("[tempo-pulse] 快捷键 CmdOrCtrl+Shift+M 注册失败: {e}");
    }
    if let Err(e) = gs.on_shortcut("CmdOrCtrl+Shift+B", |app, _s, e| {
        if e.state == ShortcutState::Pressed {
            windows::toggle_mini(app);
        }
    }) {
        eprintln!("[tempo-pulse] 快捷键 CmdOrCtrl+Shift+B 注册失败: {e}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config_dir)?;
            let config_path = config_dir.join("config.json");
            let config = model::load_or_default(&config_path);

            // 让自启状态与设置一致（配置迁移/手动删除 LaunchAgent 后可自愈）
            if config.settings.autostart {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }

            app.manage(AppState {
                config: RwLock::new(config),
                engine: RwLock::new(engine::EngineState::default()),
                config_path,
            });

            tray::init(app.handle())?;
            windows::create_mini(app.handle())?;
            windows::create_rest(app.handle())?;
            register_shortcuts(app.handle());
            tauri::async_runtime::spawn(engine::run(app.handle().clone()));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            // 三个窗口的关闭一律转为隐藏，节奏引擎继续在托盘里跑
            tauri::WindowEvent::CloseRequested { api, .. } => match window.label() {
                windows::MAIN | windows::MINI => {
                    api.prevent_close();
                    let _ = window.hide();
                }
                windows::REST => {
                    api.prevent_close();
                    windows::hide_rest(window.app_handle());
                }
                _ => {}
            },
            tauri::WindowEvent::Moved(pos) => {
                if window.label() == windows::MINI {
                    windows::save_mini_position(window.app_handle(), *pos);
                }
            }
            _ => {},
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_config,
            commands::get_snapshot,
            commands::save_states,
            commands::save_schedules,
            commands::save_settings,
            commands::set_mini_visible,
            commands::show_main_window,
            commands::open_config_dir,
            commands::skip_current_block,
            commands::set_running,
            commands::dismiss_rest_screen,
            commands::postpone_rest_screen,
            commands::save_rest_bg_image,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // 退出前把迷你窗当前位置落盘
                if let Some(mini) = app.get_webview_window(windows::MINI) {
                    if let Ok(pos) = mini.outer_position() {
                        let st = app.state::<AppState>();
                        let mut cfg = st.config.write().unwrap();
                        cfg.settings.mini.x = Some(pos.x as f64);
                        cfg.settings.mini.y = Some(pos.y as f64);
                        let _ = model::save(&st.config_path, &cfg);
                    }
                }
            }
        });
}

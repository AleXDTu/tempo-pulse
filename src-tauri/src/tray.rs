//! 托盘：常驻入口 + 当前状态的可视化（色点图标 + tooltip）

use crate::model::PulseState;
use crate::state::AppState;
use crate::windows;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_ID: &str = "tempo-tray";

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let toggle_run =
        MenuItem::with_id(app, "toggle_run", "开始 / 停止节奏", true, None::<&str>)?;
    let open_main = MenuItem::with_id(app, "open_main", "打开主窗口", true, None::<&str>)?;
    let toggle_mini =
        MenuItem::with_id(app, "toggle_mini", "显示 / 隐藏迷你窗", true, None::<&str>)?;
    let skip = MenuItem::with_id(app, "skip", "跳过当前时间块", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出 Tempo Pulse", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[
            &toggle_run,
            &PredefinedMenuItem::separator(app)?,
            &open_main,
            &toggle_mini,
            &skip,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(circle_icon("#38bdf8"))
        .tooltip("Tempo Pulse")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "toggle_run" => {
                let running = {
                    let st = app.state::<AppState>();
                    let cfg = st.config.read().unwrap();
                    cfg.settings.running
                };
                crate::commands::do_set_running(app, !running);
            }
            "open_main" => windows::show_main(app),
            "toggle_mini" => windows::toggle_mini(app),
            "skip" => crate::commands::do_skip(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                windows::show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// 状态切换时更新托盘图标颜色与提示文字；停止中显示灰色 ⏸
pub fn update(app: &AppHandle, state: Option<&PulseState>) {
    let running = {
        let st = app.state::<AppState>();
        let cfg = st.config.read().unwrap();
        cfg.settings.running
    };
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let (tooltip, color) = if !running {
        ("Tempo Pulse · ⏸ 已停止".to_string(), "#64748b".to_string())
    } else {
        match state {
            Some(s) => {
                let emoji = s.emoji.as_deref().unwrap_or("");
                (
                    format!("Tempo Pulse · {emoji} {}", s.label),
                    s.color.clone(),
                )
            }
            None => ("Tempo Pulse · 自由时间".to_string(), "#64748b".to_string()),
        }
    };
    let _ = tray.set_tooltip(Some(&tooltip));
    let _ = tray.set_icon(Some(circle_icon(&color)));
}

/// 生成一张指定颜色的圆形 RGBA 图标（无需图片资源）
fn circle_icon(hex: &str) -> tauri::image::Image<'static> {
    let (r, g, b) = parse_hex(hex).unwrap_or((100, 116, 139));
    let size = 32usize;
    let c = (size - 1) as f64 / 2.0;
    let radius = c - 2.0;
    let mut rgba = Vec::with_capacity(size * size * 4);
    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - c;
            let dy = y as f64 - c;
            let dist = (dx * dx + dy * dy).sqrt();
            let alpha = ((radius - dist) / 1.5).clamp(0.0, 1.0);
            rgba.extend_from_slice(&[r, g, b, (alpha * 255.0) as u8]);
        }
    }
    tauri::image::Image::new_owned(rgba, size as u32, size as u32)
}

fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let h = hex.strip_prefix('#')?;
    if h.len() != 6 {
        return None;
    }
    let v = u32::from_str_radix(h, 16).ok()?;
    Some((
        ((v >> 16) & 0xff) as u8,
        ((v >> 8) & 0xff) as u8,
        (v & 0xff) as u8,
    ))
}

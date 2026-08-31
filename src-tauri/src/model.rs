//! 领域模型与持久化。
//! 与前端 src/lib/types.ts 一一对应（serde camelCase），修改任一侧需同步另一侧。

use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StateKind {
    Focus,
    Rest,
    Slack,
    Custom,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PulseState {
    pub id: String,
    pub label: String,
    pub emoji: Option<String>,
    pub color: String,
    pub kind: StateKind,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeBlock {
    pub id: String,
    /// "HH:MM" 墙钟时间
    pub start: String,
    /// "HH:MM"，必须大于 start（不支持跨午夜）
    pub end: String,
    pub state_id: String,
    pub note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub blocks: Vec<TimeBlock>,
    /// 生效日，1=周一 … 7=周日
    pub active_days: Vec<u8>,
}

fn default_true() -> bool {
    true
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiniSettings {
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub visible: bool,
    /// 跨桌面常驻：切换 Space / 全屏应用时迷你窗仍然可见
    #[serde(default = "default_true")]
    pub always_visible: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestScreenSettings {
    /// "fullscreen" | "window"
    #[serde(default = "default_rest_mode")]
    pub mode: String,
    /// "color" | "gradient" | "image"
    pub bg_type: String,
    /// color: "#RRGGBB" / gradient: CSS gradient / image: 资产绝对路径
    pub bg_value: String,
    pub title: String,
    pub subtitle: String,
    /// "skippable" | "postpone-once" | "locked"
    pub strictness: String,
}

fn default_rest_mode() -> String {
    "fullscreen".into()
}

/// 法定工作日：法定节假日（放假）与调休补班日（上班），"YYYY-MM-DD"
/// 默认内置 2026 年国务院办公厅官方安排（国办发明电〔2025〕，2025-11-04 发布）：
/// 元旦 1.1-1.3（1.4 班）/ 春节 2.15-2.23（2.14、2.28 班）/ 清明 4.4-4.6 /
/// 劳动节 5.1-5.5（5.9 班）/ 端午 6.19-6.21 / 中秋 9.25-9.27 /
/// 国庆 10.1-10.7（9.20、10.10 班）
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegalDaysSettings {
    pub enabled: bool,
    pub holidays: Vec<String>,
    pub workdays: Vec<String>,
}

fn default_legal_days() -> LegalDaysSettings {
    let holidays = [
        "2026-01-01", "2026-01-02", "2026-01-03", //
        "2026-02-15", "2026-02-16", "2026-02-17", "2026-02-18", "2026-02-19",
        "2026-02-20", "2026-02-21", "2026-02-22", "2026-02-23", //
        "2026-04-04", "2026-04-05", "2026-04-06", //
        "2026-05-01", "2026-05-02", "2026-05-03", "2026-05-04", "2026-05-05", //
        "2026-06-19", "2026-06-20", "2026-06-21", //
        "2026-09-25", "2026-09-26", "2026-09-27", //
        "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05",
        "2026-10-06", "2026-10-07",
    ];
    let workdays = [
        "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20",
        "2026-10-10",
    ];
    LegalDaysSettings {
        enabled: true,
        holidays: holidays.iter().map(|s| s.to_string()).collect(),
        workdays: workdays.iter().map(|s| s.to_string()).collect(),
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub mini: MiniSettings,
    pub rest_screen: RestScreenSettings,
    #[serde(default = "default_legal_days")]
    pub legal_days: LegalDaysSettings,
    /// 是否在跑节奏；停止后引擎不计时、不弹休息屏、不发通知
    /// （老配置缺此字段时默认 true，升级用户行为不变）
    #[serde(default = "default_true")]
    pub running: bool,
    /// 是否完成过新手引导（老配置默认 true，避免升级后弹引导）
    #[serde(default = "default_true")]
    pub onboarded: bool,
    pub autostart: bool,
    pub notifications: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub states: Vec<PulseState>,
    pub schedules: Vec<Schedule>,
    pub settings: Settings,
}

impl Default for AppConfig {
    fn default() -> Self {
        let focus = PulseState {
            id: uuid::Uuid::new_v4().to_string(),
            label: "认真工作".into(),
            emoji: Some("💪".into()),
            color: "#f97316".into(),
            kind: StateKind::Focus,
        };
        let slack = PulseState {
            id: uuid::Uuid::new_v4().to_string(),
            label: "摸鱼".into(),
            emoji: Some("🐟".into()),
            color: "#38bdf8".into(),
            kind: StateKind::Slack,
        };
        let rest = PulseState {
            id: uuid::Uuid::new_v4().to_string(),
            label: "休息".into(),
            emoji: Some("☕".into()),
            color: "#34d399".into(),
            kind: StateKind::Rest,
        };

        AppConfig {
            states: vec![focus, slack, rest],
            // 新装不预置时间表：一进来就计时体验不好，节奏交给引导/用户自己定义
            schedules: vec![],
            settings: Settings {
                mini: MiniSettings { x: None, y: None, visible: true, always_visible: true },
                rest_screen: RestScreenSettings {
                    mode: default_rest_mode(),
                    bg_type: "gradient".into(),
                    bg_value: "linear-gradient(135deg, #0f172a 0%, #312e81 50%, #581c87 100%)".into(),
                    title: "该休息啦 ☕".into(),
                    subtitle: "离开屏幕，站起来走走，看看远处".into(),
                    strictness: "skippable".into(),
                },
                legal_days: default_legal_days(),
                // 新装默认停止 + 未引导：由新手引导完成后开始
                running: false,
                onboarded: false,
                autostart: false,
                notifications: true,
            },
        }
    }
}

/// 读取配置；文件不存在或损坏时回退默认值并立即落盘
pub fn load_or_default(path: &Path) -> AppConfig {
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str(&content) {
            Ok(cfg) => cfg,
            Err(e) => {
                eprintln!("[tempo-pulse] 配置解析失败，使用默认配置: {e}");
                let cfg = AppConfig::default();
                let _ = save(path, &cfg);
                cfg
            }
        },
        Err(_) => {
            let cfg = AppConfig::default();
            let _ = save(path, &cfg);
            cfg
        }
    }
}

pub fn save(path: &Path, cfg: &AppConfig) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())
}

/// 周几（1=周一 … 7=周日）
pub fn weekday_index(date: NaiveDate) -> u8 {
    date.weekday().num_days_from_monday() as u8 + 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_has_no_schedules_and_starts_stopped() {
        let cfg = AppConfig::default();
        assert!(cfg.schedules.is_empty());
        assert!(!cfg.settings.running);
        assert!(!cfg.settings.onboarded);
        assert_eq!(cfg.states.len(), 3); // 引导用的三个基础状态
    }

    #[test]
    fn legacy_config_keeps_running_and_skips_onboarding() {
        // 老版本配置没有 running/onboarded 字段，反序列化应默认 true
        let legacy = r##"{
            "states": [],
            "schedules": [{"id":"a","name":"n","blocks":[],"activeDays":[1]}],
            "settings": {
                "mini": {"x":null,"y":null,"visible":true},
                "restScreen": {"bgType":"color","bgValue":"#000000","title":"t","subtitle":"s","strictness":"skippable"},
                "autostart": false,
                "notifications": true
            }
        }"##;
        let cfg: AppConfig = serde_json::from_str(legacy).unwrap();
        assert!(cfg.settings.running);
        assert!(cfg.settings.onboarded);
        assert!(cfg.settings.legal_days.enabled);
        assert!(cfg.settings.mini.always_visible);
        assert_eq!(cfg.settings.rest_screen.mode, "fullscreen");
    }
}

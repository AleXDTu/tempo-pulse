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

/// 法定工作日设置。
/// 自动数据来自 holiday-cn（内置离线 + 可自动更新，见 holidays.rs）；
/// `holidays` / `workdays` 仅作为用户「手动补充」，通常留空。
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegalDaysSettings {
    pub enabled: bool,
    pub holidays: Vec<String>,
    pub workdays: Vec<String>,
    /// 自动更新节假日数据（holiday-cn）
    #[serde(default = "default_true")]
    pub auto_update: bool,
    #[serde(default)]
    pub last_updated: Option<String>,
}

/// v1.0.x 内置的旧默认数据：仅用于把「未修改过」的存量配置迁移为跟随自动数据
pub const LEGACY_HOLIDAYS: [&str; 33] = [
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
pub const LEGACY_WORKDAYS: [&str; 6] = [
    "2026-01-04", "2026-02-14", "2026-02-28", "2026-05-09", "2026-09-20",
    "2026-10-10",
];

fn default_legal_days() -> LegalDaysSettings {
    LegalDaysSettings {
        enabled: true,
        holidays: vec![],
        workdays: vec![],
        auto_update: true,
        last_updated: None,
    }
}

/// 迁移 v1.0.x 的硬编码默认数据：内容与旧默认一致视为「未修改」→ 清空以跟随自动数据；
/// 用户改过 → 保留为手动补充。返回是否发生了迁移。
pub fn migrate_legacy_legal_days(cfg: &mut AppConfig) -> bool {
    let legal = &mut cfg.settings.legal_days;
    let legacy_holidays: Vec<String> = LEGACY_HOLIDAYS.iter().map(|s| s.to_string()).collect();
    let legacy_workdays: Vec<String> = LEGACY_WORKDAYS.iter().map(|s| s.to_string()).collect();
    let same = legal.holidays == legacy_holidays && legal.workdays == legacy_workdays;
    // 排序后比较，容忍用户端可能的顺序差异
    let same_sorted = {
        let mut h1 = legal.holidays.clone();
        let mut h2 = legacy_holidays.clone();
        h1.sort();
        h2.sort();
        let mut w1 = legal.workdays.clone();
        let mut w2 = legacy_workdays.clone();
        w1.sort();
        w2.sort();
        h1 == h2 && w1 == w2
    };
    if same || same_sorted {
        legal.holidays = vec![];
        legal.workdays = vec![];
        true
    } else {
        false
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

/// 读取配置；文件不存在或损坏时回退默认值并立即落盘。
/// v1.0.x 的硬编码法定日数据在此迁移为「跟随自动数据」。
pub fn load_or_default(path: &Path) -> AppConfig {
    match std::fs::read_to_string(path) {
        Ok(content) => match serde_json::from_str::<AppConfig>(&content) {
            Ok(mut cfg) => {
                if migrate_legacy_legal_days(&mut cfg) {
                    println!("[tempo-pulse] 已迁移旧版法定日数据 → 跟随自动更新");
                    let _ = save(path, &cfg);
                }
                cfg
            }
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
        // 默认不再硬编码节假日，改为跟随自动数据
        assert!(cfg.settings.legal_days.holidays.is_empty());
        assert!(cfg.settings.legal_days.workdays.is_empty());
        assert!(cfg.settings.legal_days.auto_update);
    }

    #[test]
    fn migration_clears_unmodified_legacy_data() {
        let mut cfg = AppConfig::default();
        cfg.settings.legal_days.holidays = LEGACY_HOLIDAYS.iter().map(|s| s.to_string()).collect();
        cfg.settings.legal_days.workdays = LEGACY_WORKDAYS.iter().map(|s| s.to_string()).collect();
        assert!(migrate_legacy_legal_days(&mut cfg));
        assert!(cfg.settings.legal_days.holidays.is_empty());
        assert!(cfg.settings.legal_days.workdays.is_empty());
    }

    #[test]
    fn migration_keeps_user_modified_data() {
        let mut cfg = AppConfig::default();
        cfg.settings.legal_days.holidays = vec!["2027-01-01".into()]; // 用户手改过
        assert!(!migrate_legacy_legal_days(&mut cfg));
        assert_eq!(cfg.settings.legal_days.holidays, vec!["2027-01-01".to_string()]);
    }

    #[test]
    fn legacy_config_deserializes_and_migrates() {
        // v1.0.x 的完整配置（含旧硬编码数据）应能加载并完成迁移
        let json = serde_json::json!({
            "states": [],
            "schedules": [],
            "settings": {
                "mini": {"x": null, "y": null, "visible": true},
                "restScreen": {"bgType": "color", "bgValue": "#000000", "title": "t", "subtitle": "s", "strictness": "skippable"},
                "legalDays": {"enabled": true, "holidays": Vec::from(LEGACY_HOLIDAYS), "workdays": Vec::from(LEGACY_WORKDAYS)},
                "running": true,
                "autostart": false,
                "notifications": true
            }
        });
        let mut cfg: AppConfig = serde_json::from_value(json).unwrap();
        assert!(migrate_legacy_legal_days(&mut cfg));
        assert!(cfg.settings.legal_days.holidays.is_empty());
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

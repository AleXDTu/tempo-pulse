//! 法定节假日数据：内置 [holiday-cn](https://github.com/NateScarlet/holiday-cn) 离线数据
//! + 本地缓存 + 自动更新。
//!
//! holiday-cn 在国务院通知发布后自动更新，JSON 形如：
//! `{ "year": 2026, "days": [{ "name": "元旦", "date": "2026-01-01", "isOffDay": true }] }`
//! `isOffDay = true` 放假日 / `false` 调休补班日。
//!
//! 加载优先级：本地缓存（`{config_dir}/holidays/{年}.json`）> 编译期内置。
//! 自动更新：启动后延迟检查当年+次年，之后每 24h 一次；次年安排未公布时 404 静默跳过。

use crate::state::AppState;
use chrono::{Datelike, Local, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Duration;
use tauri::{AppHandle, Manager};

/// 编译期内置的离线数据（新增年份时在此追加文件并注册）
const BUILTIN: &[&str] = &[include_str!("../resources/holiday-cn/2026.json")];

const SOURCES: &[&str] = &[
    "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/{year}.json",
    "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/{year}.json",
];

#[derive(Clone, Deserialize, Serialize)]
struct HolidayCnFile {
    year: u16,
    days: Vec<HolidayCnDay>,
}

#[derive(Clone, Deserialize, Serialize)]
struct HolidayCnDay {
    #[serde(default)]
    #[allow(dead_code)]
    name: String,
    date: String,
    #[serde(rename = "isOffDay")]
    is_off_day: bool,
}

/// 某一年的节假日判定数据
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HolidayYear {
    pub year: u16,
    pub off_days: Vec<String>,
    pub work_days: Vec<String>,
}

impl HolidayYear {
    fn from_file(file: HolidayCnFile) -> Self {
        let mut off = Vec::new();
        let mut work = Vec::new();
        for d in file.days {
            if d.is_off_day {
                off.push(d.date);
            } else {
                work.push(d.date);
            }
        }
        off.sort();
        work.sort();
        Self { year: file.year, off_days: off, work_days: work }
    }

    fn parse(text: &str) -> Option<Self> {
        serde_json::from_str::<HolidayCnFile>(text)
            .ok()
            .map(Self::from_file)
    }
}

/// 全部年份数据的内存视图
#[derive(Default)]
pub struct HolidayStore {
    pub years: BTreeMap<u16, HolidayYear>,
}

impl HolidayStore {
    /// 缓存优先，内置兜底
    pub fn load(config_dir: &Path) -> Self {
        let mut years = BTreeMap::new();
        let dir = config_dir.join("holidays");
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                let path = e.path();
                let is_json = path.extension().map(|x| x == "json").unwrap_or(false);
                if !is_json {
                    continue;
                }
                if let Ok(text) = std::fs::read_to_string(&path) {
                    if let Some(hy) = HolidayYear::parse(&text) {
                        years.insert(hy.year, hy);
                    }
                }
            }
        }
        for text in BUILTIN {
            if let Some(hy) = HolidayYear::parse(text) {
                years.entry(hy.year).or_insert_with(|| hy);
            }
        }
        Self { years }
    }

    pub fn is_off_day(&self, date: NaiveDate) -> bool {
        let ds = date.format("%Y-%m-%d").to_string();
        self.years.values().any(|y| y.off_days.iter().any(|d| d == &ds))
    }

    pub fn is_work_day(&self, date: NaiveDate) -> bool {
        let ds = date.format("%Y-%m-%d").to_string();
        self.years.values().any(|y| y.work_days.iter().any(|d| d == &ds))
    }

    pub fn year_list(&self) -> Vec<u16> {
        self.years.keys().copied().collect()
    }
}

/// 拉取某一年数据（依次尝试各来源；404 = 次年安排尚未公布，返回 Err 由调用方静默跳过）
async fn fetch_year(client: &reqwest::Client, year: u16) -> Result<HolidayCnFile, String> {
    let mut last_err = String::from("无可用来源");
    for tpl in SOURCES {
        let url = tpl.replace("{year}", &year.to_string());
        match client.get(&url).send().await {
            Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => {
                return Err(format!("{year} 年安排尚未公布"));
            }
            Ok(resp) if resp.status().is_success() => match resp.text().await {
                Ok(text) => match serde_json::from_str::<HolidayCnFile>(&text) {
                    Ok(file) => return Ok(file),
                    Err(e) => last_err = format!("{url} 解析失败: {e}"),
                },
                Err(e) => last_err = format!("{url} 读取失败: {e}"),
            },
            Ok(resp) => last_err = format!("{url} HTTP {}", resp.status()),
            Err(e) => last_err = format!("{url} {e}"),
        }
    }
    Err(last_err)
}

/// 检查并应用更新：当年 + 次年；有变化则写缓存、更新内存、广播重算。
/// 返回给前端展示的结果文案。
pub async fn check_update(app: &AppHandle) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("tempo-pulse/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|e| e.to_string())?;

    let this_year = Local::now().year() as u16;
    let dir = {
        let st = app.state::<AppState>();
        st.config_path.parent().unwrap().join("holidays")
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let mut updated: Vec<u16> = Vec::new();
    for year in [this_year, this_year + 1] {
        let file = match fetch_year(&client, year).await {
            Ok(f) => f,
            Err(_) => continue, // 网络失败 / 次年未公布：静默
        };
        let hy = HolidayYear::from_file(file.clone());
        // 次年安排未公布时仓库可能是空占位文件：不落缓存、不算更新
        if hy.off_days.is_empty() && hy.work_days.is_empty() {
            continue;
        }
        let changed = {
            let st = app.state::<AppState>();
            let store = st.holidays.read().unwrap();
            store.years.get(&year) != Some(&hy)
        };
        if !changed {
            continue;
        }
        let json = serde_json::to_string_pretty(&file).map_err(|e| e.to_string())?;
        std::fs::write(dir.join(format!("{year}.json")), json).map_err(|e| e.to_string())?;
        let st = app.state::<AppState>();
        st.holidays.write().unwrap().years.insert(year, hy);
        updated.push(year);
    }

    if updated.is_empty() {
        return Ok("节假日数据已是最新".into());
    }

    {
        let st = app.state::<AppState>();
        let mut cfg = st.config.write().unwrap();
        cfg.settings.legal_days.last_updated = Some(Local::now().to_rfc3339());
        crate::model::save(&st.config_path, &cfg).map_err(|e| e.to_string())?;
    }
    crate::commands::broadcast_config(app);
    let years = updated
        .iter()
        .map(|y| y.to_string())
        .collect::<Vec<_>>()
        .join("、");
    Ok(format!("已更新 {years} 年节假日数据"))
}

/// 后台自动更新循环：启动后延迟 5s 首查，之后每 24h 一次（可在设置中关闭）
pub async fn run_auto_update(app: AppHandle) {
    tokio::time::sleep(Duration::from_secs(5)).await;
    loop {
        let enabled = {
            let st = app.state::<AppState>();
            let cfg = st.config.read().unwrap();
            cfg.settings.legal_days.auto_update
        };
        if enabled {
            match check_update(&app).await {
                Ok(msg) => println!("[tempo-pulse] 节假日数据: {msg}"),
                Err(e) => eprintln!("[tempo-pulse] 节假日数据更新失败: {e}"),
            }
        }
        tokio::time::sleep(Duration::from_secs(24 * 3600)).await;
    }
}

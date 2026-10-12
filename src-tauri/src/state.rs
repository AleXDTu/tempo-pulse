//! 全局应用状态（Tauri managed）

use crate::engine::EngineState;
use crate::holidays::HolidayStore;
use crate::model::AppConfig;
use std::path::PathBuf;
use std::sync::RwLock;

pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub engine: RwLock<EngineState>,
    /// 法定节假日自动数据（内置 holiday-cn + 本地缓存 + 在线更新）
    pub holidays: RwLock<HolidayStore>,
    pub config_path: PathBuf,
}

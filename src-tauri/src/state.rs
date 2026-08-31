//! 全局应用状态（Tauri managed）

use crate::engine::EngineState;
use crate::model::AppConfig;
use std::path::PathBuf;
use std::sync::RwLock;

pub struct AppState {
    pub config: RwLock<AppConfig>,
    pub engine: RwLock<EngineState>,
    pub config_path: PathBuf,
}

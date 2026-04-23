use std::collections::HashMap;
use std::sync::Arc;

use anyhow::Result;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::db::{self, Database};
use crate::import_export::StoredImportPreview;
use crate::scheduler::SchedulerController;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub scheduler: SchedulerController,
    pub import_previews: Arc<Mutex<HashMap<String, StoredImportPreview>>>,
}

impl AppState {
    pub async fn new(app_data_dir: std::path::PathBuf) -> Result<Self> {
        let db = db::init_database(&app_data_dir).await?;
        let paused = db::get_setting_json(&db.pool, "scheduler_paused")
            .await?
            .and_then(|value| value.as_bool())
            .unwrap_or(false);

        Ok(Self {
            db,
            scheduler: SchedulerController::new(paused),
            import_previews: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub async fn scheduler_paused(&self) -> Result<bool> {
        Ok(db::get_setting_json(&self.db.pool, "scheduler_paused")
            .await?
            .and_then(|value| value.as_bool())
            .unwrap_or(false))
    }

    pub async fn set_scheduler_paused(&self, paused: bool) -> Result<()> {
        db::set_setting_json(&self.db.pool, "scheduler_paused", &Value::Bool(paused)).await?;
        self.scheduler.set_paused(paused).await;
        Ok(())
    }
}

use tauri::State;

use crate::app_state::AppState;
use crate::db;
use crate::models::{RunDetail, RunListFilter, RunLogLine, RunSummary};

#[tauri::command]
pub async fn list_runs(
    filter: Option<RunListFilter>,
    state: State<'_, AppState>,
) -> Result<Vec<RunSummary>, String> {
    db::list_runs(&state.db.pool, filter)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_run(run_id: String, state: State<'_, AppState>) -> Result<RunDetail, String> {
    db::get_run_detail(&state.db.pool, &run_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_run_logs(
    run_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<RunLogLine>, String> {
    db::get_run_logs(&state.db.pool, &run_id)
        .await
        .map_err(|error| error.to_string())
}

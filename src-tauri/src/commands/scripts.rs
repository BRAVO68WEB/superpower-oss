use anyhow::Result;
use tauri::{AppHandle, State};

use crate::app_state::AppState;
use crate::db;
use crate::models::{RunSummary, ScriptDetail, ScriptInput, ScriptSummary};
use crate::tray;

#[tauri::command]
pub async fn list_scripts(state: State<'_, AppState>) -> Result<Vec<ScriptSummary>, String> {
    db::list_scripts(&state.db.pool)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_script(
    script_id: String,
    state: State<'_, AppState>,
) -> Result<ScriptDetail, String> {
    db::get_script(&state.db.pool, &script_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn create_script(
    app: AppHandle,
    input: ScriptInput,
    state: State<'_, AppState>,
) -> Result<ScriptDetail, String> {
    let detail = db::create_script(&state.db.pool, &input)
        .await
        .map_err(|error| error.to_string())?;
    state
        .scheduler
        .refresh(app.clone(), state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())?;
    Ok(detail)
}

#[tauri::command]
pub async fn update_script(
    app: AppHandle,
    script_id: String,
    input: ScriptInput,
    state: State<'_, AppState>,
) -> Result<ScriptDetail, String> {
    let detail = db::update_script(&state.db.pool, &script_id, &input)
        .await
        .map_err(|error| error.to_string())?;
    state
        .scheduler
        .refresh(app.clone(), state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())?;
    Ok(detail)
}

#[tauri::command]
pub async fn delete_script(
    app: AppHandle,
    script_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    db::delete_script(&state.db.pool, &script_id)
        .await
        .map_err(|error| error.to_string())?;
    state
        .scheduler
        .refresh(app.clone(), state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn duplicate_script(
    app: AppHandle,
    script_id: String,
    state: State<'_, AppState>,
) -> Result<ScriptDetail, String> {
    let detail = db::duplicate_script(&state.db.pool, &script_id)
        .await
        .map_err(|error| error.to_string())?;
    state
        .scheduler
        .refresh(app.clone(), state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())?;
    Ok(detail)
}

#[tauri::command]
pub async fn run_script_now(
    app: AppHandle,
    script_id: String,
    state: State<'_, AppState>,
) -> Result<RunSummary, String> {
    state
        .scheduler
        .request_manual_run(app, state.inner().clone(), script_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_script_enabled(
    app: AppHandle,
    script_id: String,
    enabled: bool,
    state: State<'_, AppState>,
) -> Result<ScriptSummary, String> {
    let summary = db::set_script_enabled(&state.db.pool, &script_id, enabled)
        .await
        .map_err(|error| error.to_string())?;
    state
        .scheduler
        .refresh(app.clone(), state.inner().clone())
        .await
        .map_err(|error| error.to_string())?;
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())?;
    Ok(summary)
}

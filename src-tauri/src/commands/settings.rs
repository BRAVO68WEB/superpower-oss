use tauri::{AppHandle, Emitter, State};

use crate::app_state::AppState;
use crate::db;
use crate::import_export;
use crate::models::{
    ExportResult, ImportPreview, ImportResult, NotificationChannel, NotificationChannelInput,
    RuntimeHealth, SchedulerState, UpdateConfiguration, UpdateSummary,
};
use crate::notifications;
use crate::runtime::bun::BunRuntime;
use crate::tray;
use crate::updater;

#[tauri::command]
pub async fn list_notification_channels(
    state: State<'_, AppState>,
) -> Result<Vec<NotificationChannel>, String> {
    notifications::list_channels_with_secret_state(&state.db.pool)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn upsert_notification_channel(
    input: NotificationChannelInput,
    state: State<'_, AppState>,
) -> Result<NotificationChannel, String> {
    let channel = db::upsert_notification_channel(&state.db.pool, &input)
        .await
        .map_err(|error| error.to_string())?;
    notifications::persist_secret(&input, &channel.id).map_err(|error| error.to_string())?;
    let mut channel = channel;
    channel.has_secret = notifications::load_secret(&channel.id)
        .map_err(|error| error.to_string())?
        .is_some();
    Ok(channel)
}

#[tauri::command]
pub async fn get_notification_channel_secret(
    channel_id: String,
) -> Result<Option<serde_json::Value>, String> {
    notifications::load_secret(&channel_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn delete_notification_channel(
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    db::delete_notification_channel(&state.db.pool, &channel_id)
        .await
        .map_err(|error| error.to_string())?;
    notifications::delete_secret(&channel_id).map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn send_test_notification(
    app: AppHandle,
    channel_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let channel = db::get_notification_channel(&state.db.pool, &channel_id)
        .await
        .map_err(|error| error.to_string())?;
    let secret = notifications::load_secret(&channel_id).map_err(|error| error.to_string())?;
    let payload = crate::notifications::providers::NormalizedNotification {
        title: Some("Superpower OSS test".to_string()),
        message: "Test notification from Superpower OSS".to_string(),
        level: "info".to_string(),
        script_name: "Settings".to_string(),
        script_id: "settings".to_string(),
        trigger_label: "Manual test".to_string(),
        timestamp: db::now_iso(),
        channel: None,
        metadata: None,
    };
    crate::notifications::providers::send_notification(&app, &channel, secret, &payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_runtime_health(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<RuntimeHealth, String> {
    let runtime = BunRuntime::resolve(&app)
        .await
        .map_err(|error| error.to_string())?;
    let bun_version = runtime.version().await;
    let paused = state
        .scheduler_paused()
        .await
        .map_err(|error| error.to_string())?;

    Ok(RuntimeHealth {
        bun_path: Some(runtime.executable.to_string_lossy().to_string()),
        bun_version,
        bundled_bun_available: runtime.bundled_available,
        scheduler_paused: paused,
        db_path: state.db.path.to_string_lossy().to_string(),
        app_version: app.package_info().version.to_string(),
        updates_configured: updater::update_configuration(&app).updates_configured,
    })
}

#[tauri::command]
pub async fn get_update_configuration(app: AppHandle) -> Result<UpdateConfiguration, String> {
    Ok(updater::update_configuration(&app))
}

#[tauri::command]
pub async fn check_for_updates(
    app: AppHandle,
    channel: String,
) -> Result<Option<UpdateSummary>, String> {
    updater::check_for_updates(&app, &channel)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_update(
    app: AppHandle,
    channel: String,
) -> Result<Option<UpdateSummary>, String> {
    updater::install_update(&app, &channel)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn set_pause_scheduling(
    app: AppHandle,
    paused: bool,
    state: State<'_, AppState>,
) -> Result<SchedulerState, String> {
    state
        .set_scheduler_paused(paused)
        .await
        .map_err(|error| error.to_string())?;
    let scheduler_state = state.scheduler.scheduler_state().await;
    app.emit("scheduler:state_changed", &scheduler_state).ok();
    tray::build_or_update_tray(&app, state.inner())
        .await
        .map_err(|error| error.to_string())?;
    Ok(scheduler_state)
}

#[tauri::command]
pub async fn export_scripts(
    script_ids: Vec<String>,
    destination_path: String,
    state: State<'_, AppState>,
) -> Result<ExportResult, String> {
    import_export::export_scripts_to_path(&state.db.pool, &script_ids, &destination_path)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_scripts(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<ImportPreview, String> {
    let preview = import_export::import_preview_from_path(&source_path)
        .await
        .map_err(|error| error.to_string())?;
    state.import_previews.lock().await.insert(
        preview.preview_id.clone(),
        import_export::StoredImportPreview {
            scripts: preview.scripts.clone(),
            notification_channel_refs: preview.notification_channel_refs.clone(),
        },
    );
    Ok(preview)
}

#[tauri::command]
pub async fn confirm_import(
    app: AppHandle,
    preview_id: String,
    state: State<'_, AppState>,
) -> Result<ImportResult, String> {
    let preview = state
        .import_previews
        .lock()
        .await
        .remove(&preview_id)
        .ok_or_else(|| "import preview not found".to_string())?;
    let result = import_export::confirm_import(&state.db.pool, &preview)
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
    Ok(result)
}

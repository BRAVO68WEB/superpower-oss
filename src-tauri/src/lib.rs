mod app_state;
mod commands;
mod db;
mod import_export;
mod models;
mod notifications;
mod runtime;
mod scheduler;
mod tray;
mod updater;

use anyhow::Context;
use tauri::{Manager, WindowEvent};
use tauri_plugin_dialog::DialogExt;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init());

    if updater::updater_configured() {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .context("failed to resolve app data directory")?;
            let state = match tauri::async_runtime::block_on(app_state::AppState::new(app_data_dir))
            {
                Ok(state) => state,
                Err(error) => {
                    let message = format!("Superpower OSS could not start.\n\n{error}");
                    let handle = app.handle().clone();
                    std::thread::spawn(move || {
                        handle
                            .dialog()
                            .message(message)
                            .title("Startup failed")
                            .blocking_show();
                    })
                    .join()
                    .ok();

                    return Err(error.into());
                }
            };

            app.manage(state.clone());

            tauri::async_runtime::block_on(async {
                tray::build_or_update_tray(app.handle(), &state).await?;
                state
                    .scheduler
                    .refresh(app.handle().clone(), state.clone())
                    .await
            })?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scripts::list_scripts,
            commands::scripts::get_script,
            commands::scripts::create_script,
            commands::scripts::update_script,
            commands::scripts::delete_script,
            commands::scripts::duplicate_script,
            commands::scripts::run_script_now,
            commands::scripts::set_script_enabled,
            commands::runs::list_runs,
            commands::runs::get_run,
            commands::runs::get_run_logs,
            commands::settings::list_notification_channels,
            commands::settings::upsert_notification_channel,
            commands::settings::get_notification_channel_secret,
            commands::settings::delete_notification_channel,
            commands::settings::send_test_notification,
            commands::settings::get_runtime_health,
            commands::settings::get_update_configuration,
            commands::settings::check_for_updates,
            commands::settings::install_update,
            commands::settings::set_pause_scheduling,
            commands::settings::export_scripts,
            commands::settings::import_scripts,
            commands::settings::confirm_import,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

use anyhow::Result;
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app_state::AppState;
use crate::db;

const TRAY_ID: &str = "superpower-tray";
const OPEN_ID: &str = "tray-open";
const PAUSE_ID: &str = "tray-pause";
const QUIT_ID: &str = "tray-quit";
const RUN_PREFIX: &str = "tray-run::";

pub async fn build_or_update_tray(app: &AppHandle, state: &AppState) -> Result<()> {
    let menu = build_tray_menu(app, state).await?;

    if let Some(existing) = app.tray_by_id(TRAY_ID) {
        existing.set_menu(Some(menu))?;
        return Ok(());
    }

    let icon = app.default_window_icon().cloned();
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("Superpower OSS")
        .show_menu_on_left_click(true)
        .on_menu_event({
            let state = state.clone();
            move |app, event| {
                let id = event.id().0.as_str();
                match id {
                    OPEN_ID => {
                        let _ = show_main_window(app);
                    }
                    PAUSE_ID => {
                        let state = state.clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Ok(paused) = state.scheduler_paused().await {
                                let _ = state.set_scheduler_paused(!paused).await;
                                let _ = app.emit(
                                    "scheduler:state_changed",
                                    state.scheduler.scheduler_state().await,
                                );
                            }
                        });
                    }
                    QUIT_ID => app.exit(0),
                    other if other.starts_with(RUN_PREFIX) => {
                        let script_id = other.trim_start_matches(RUN_PREFIX).to_string();
                        let state = state.clone();
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = state
                                .scheduler
                                .request_manual_run(app.clone(), state.clone(), script_id)
                                .await;
                        });
                    }
                    _ => {}
                }
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let _ = show_main_window(&tray.app_handle());
            }
        });

    if let Some(icon) = icon {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

async fn build_tray_menu(
    app: &AppHandle,
    state: &AppState,
) -> Result<tauri::menu::Menu<tauri::Wry>> {
    let scripts = db::list_scripts(&state.db.pool).await?;
    let paused = state.scheduler_paused().await?;

    let run_submenu = scripts
        .into_iter()
        .filter(|script| script.enabled && script.manual_run_enabled)
        .fold(SubmenuBuilder::new(app, "Run Script"), |builder, script| {
            builder.text(format!("{RUN_PREFIX}{}", script.id), script.name)
        })
        .build()?;

    let pause_item = CheckMenuItemBuilder::with_id(PAUSE_ID, "Pause Scheduling")
        .checked(paused)
        .build(app)?;

    let menu = MenuBuilder::new(app)
        .text(OPEN_ID, "Open Superpower")
        .separator()
        .item(&run_submenu)
        .separator()
        .item(&pause_item)
        .separator()
        .text(QUIT_ID, "Quit")
        .build()?;

    Ok(menu)
}

pub fn show_main_window(app: &AppHandle) -> Result<()> {
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
        window.unminimize()?;
        window.set_focus()?;
    }
    Ok(())
}

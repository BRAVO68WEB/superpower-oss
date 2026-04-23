use anyhow::Result;
use keyring::Entry;
use serde_json::Value;
use tauri::AppHandle;

use crate::db;
use crate::models::{NotificationChannel, NotificationChannelInput, NotifyPayload, RunSummary};

pub mod providers;

const KEYRING_SERVICE: &str = "superpower-oss";

pub async fn list_channels_with_secret_state(
    pool: &sqlx::SqlitePool,
) -> Result<Vec<NotificationChannel>> {
    let mut channels = db::list_notification_channels(pool).await?;
    for channel in &mut channels {
        channel.has_secret = load_secret(&channel.id).ok().flatten().is_some();
    }
    Ok(channels)
}

pub fn persist_secret(input: &NotificationChannelInput, channel_id: &str) -> Result<()> {
    if let Some(secret) = &input.secret {
        let entry = Entry::new(KEYRING_SERVICE, channel_id)?;
        entry.set_password(&secret.to_string())?;
    }
    Ok(())
}

pub fn delete_secret(channel_id: &str) -> Result<()> {
    let entry = Entry::new(KEYRING_SERVICE, channel_id)?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn load_secret(channel_id: &str) -> Result<Option<Value>> {
    let entry = Entry::new(KEYRING_SERVICE, channel_id)?;
    match entry.get_password() {
        Ok(password) => Ok(Some(serde_json::from_str(&password)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub async fn send_broadcast_notification(
    app: &AppHandle,
    pool: &sqlx::SqlitePool,
    run: &RunSummary,
    payload: &NotifyPayload,
) -> Result<()> {
    let channels = list_channels_with_secret_state(pool).await?;
    let normalized = providers::NormalizedNotification {
        title: payload.title.clone(),
        message: payload.message.clone(),
        level: payload.level.clone().unwrap_or_else(|| "info".to_string()),
        script_name: run.script_name.clone(),
        script_id: run.script_id.clone(),
        trigger_label: run.trigger_label.clone(),
        timestamp: db::now_iso(),
        channel: payload.channel.clone(),
        metadata: payload.metadata.clone(),
    };

    for channel in channels.into_iter().filter(|channel| channel.enabled) {
        let secret = load_secret(&channel.id).ok().flatten();
        if let Err(error) = providers::send_notification(app, &channel, secret, &normalized).await {
            let _ = db::insert_run_log(
                pool,
                &run.id,
                crate::models::RunLogStream::Event,
                0,
                &format!("notification provider {} failed: {error}", channel.name),
            )
            .await;
        }
    }
    Ok(())
}

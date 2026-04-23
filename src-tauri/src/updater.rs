use anyhow::{anyhow, Result};
use reqwest::Url;
use serde_json::Value;
use tauri::AppHandle;
use tauri_plugin_updater::UpdaterExt;

use crate::models::{UpdateConfiguration, UpdateSummary};

const UPDATE_CHANNEL_STABLE: &str = "stable";
const UPDATE_CHANNEL_BETA: &str = "beta";

pub fn update_configuration(app: &AppHandle) -> UpdateConfiguration {
    UpdateConfiguration {
        app_version: app.package_info().version.to_string(),
        updates_configured: updater_configured(),
    }
}

pub async fn check_for_updates(app: &AppHandle, channel: &str) -> Result<Option<UpdateSummary>> {
    if !updater_configured() {
        return Ok(None);
    }

    let updater = updater_for_channel(app, channel)?;
    let update = updater.check().await?;
    Ok(update.map(|update| summarize_update(app, channel, &update.raw_json)))
}

pub async fn install_update(app: &AppHandle, channel: &str) -> Result<Option<UpdateSummary>> {
    if !updater_configured() {
        return Ok(None);
    }

    let updater = updater_for_channel(app, channel)?;
    let update = updater.check().await?;
    let Some(update) = update else {
        return Ok(None);
    };

    let summary = summarize_update(app, channel, &update.raw_json);
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(Some(summary))
}

fn updater_for_channel(app: &AppHandle, channel: &str) -> Result<tauri_plugin_updater::Updater> {
    let endpoint = channel_endpoint(channel)?;
    let pubkey = updater_pubkey()
        .ok_or_else(|| anyhow!("updater public key is not configured for this build"))?;

    app.updater_builder()
        .pubkey(pubkey)
        .endpoints(vec![Url::parse(&endpoint)?])?
        .build()
        .map_err(Into::into)
}

fn summarize_update(app: &AppHandle, channel: &str, raw_json: &Value) -> UpdateSummary {
    UpdateSummary {
        version: raw_json
            .get("version")
            .and_then(Value::as_str)
            .unwrap_or("unknown")
            .to_string(),
        current_version: app.package_info().version.to_string(),
        notes: raw_json
            .get("notes")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                raw_json
                    .get("body")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }),
        pub_date: raw_json
            .get("pub_date")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| {
                raw_json
                    .get("pubDate")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            }),
        channel: channel.to_string(),
    }
}

fn channel_endpoint(channel: &str) -> Result<String> {
    let repo = github_repository()
        .ok_or_else(|| anyhow!("GitHub repository is not configured for updater builds"))?;

    match channel {
        UPDATE_CHANNEL_STABLE => Ok(format!(
            "https://github.com/{repo}/releases/latest/download/latest.json"
        )),
        UPDATE_CHANNEL_BETA => Ok(format!(
            "https://github.com/{repo}/releases/download/beta/latest.json"
        )),
        _ => Err(anyhow!("unsupported update channel {channel}")),
    }
}

fn github_repository() -> Option<&'static str> {
    option_env!("SUPERPOWER_GH_REPO").filter(|value| !value.trim().is_empty())
}

fn updater_pubkey() -> Option<&'static str> {
    option_env!("SUPERPOWER_TAURI_UPDATER_PUBKEY").filter(|value| !value.trim().is_empty())
}

pub(crate) fn updater_configured() -> bool {
    github_repository().is_some() && updater_pubkey().is_some()
}

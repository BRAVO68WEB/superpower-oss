use anyhow::{anyhow, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::fs;
use uuid::Uuid;

use crate::db;
use crate::models::{
    ExportPackageV1, ExportResult, ImportPreview, ImportResult, NotificationChannel,
    NotificationChannelRef, ScriptInput,
};

#[derive(Debug, Clone)]
pub struct StoredImportPreview {
    pub scripts: Vec<ScriptInput>,
    pub notification_channel_refs: Vec<NotificationChannelRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RawImportPackage {
    version: i64,
    exported_at: String,
    app: String,
    scripts: Vec<ScriptInput>,
    notification_channel_refs: Vec<NotificationChannelRef>,
}

pub async fn export_scripts_to_path(
    pool: &sqlx::SqlitePool,
    script_ids: &[String],
    destination_path: &str,
) -> Result<ExportResult> {
    let mut scripts = Vec::new();
    for script_id in script_ids {
        let detail = db::get_script(pool, script_id).await?;
        scripts.push(ScriptInput {
            name: detail.name,
            description: detail.description,
            code: detail.code,
            enabled: detail.enabled,
            manual_run_enabled: detail.manual_run_enabled,
            triggers: detail.triggers,
            policy: detail.policy,
        });
    }

    let refs = db::list_notification_channels(pool)
        .await?
        .into_iter()
        .map(notification_channel_ref_from_channel)
        .collect::<Vec<_>>();

    let payload = ExportPackageV1 {
        version: 1,
        exported_at: db::now_iso(),
        app: "superpower-oss".to_string(),
        scripts,
        notification_channel_refs: refs,
    };

    let bytes = serde_json::to_vec_pretty(&payload)?;
    fs::write(destination_path, bytes).await?;

    Ok(ExportResult {
        path: destination_path.to_string(),
        script_count: payload.scripts.len(),
    })
}

pub async fn import_preview_from_path(path: &str) -> Result<ImportPreview> {
    let bytes = fs::read(path).await?;
    let package: RawImportPackage =
        serde_json::from_slice(&bytes).context("invalid import/export package")?;

    if package.version != 1 {
        return Err(anyhow!("unsupported import version {}", package.version));
    }

    if package.app != "superpower-oss" {
        return Err(anyhow!("unsupported app {}", package.app));
    }

    Ok(ImportPreview {
        preview_id: Uuid::new_v4().to_string(),
        scripts: package.scripts,
        notification_channel_refs: package.notification_channel_refs,
    })
}

pub async fn confirm_import(
    pool: &sqlx::SqlitePool,
    preview: &StoredImportPreview,
) -> Result<ImportResult> {
    let existing_channels = db::list_notification_channels(pool).await?;
    let mut created_channel_ids = Vec::new();

    for channel_ref in &preview.notification_channel_refs {
        let exists = existing_channels
            .iter()
            .any(|channel| channel.kind == channel_ref.kind && channel.name == channel_ref.name);
        if !exists {
            let channel = db::upsert_notification_channel(
                pool,
                &crate::models::NotificationChannelInput {
                    id: None,
                    kind: channel_ref.kind,
                    name: channel_ref.name.clone(),
                    enabled: false,
                    config: serde_json::json!({}),
                    secret: None,
                },
            )
            .await?;
            created_channel_ids.push(channel.id);
        }
    }

    let mut imported_script_ids = Vec::new();
    for script in &preview.scripts {
        let mut script = script.clone();
        script.name = dedupe_import_name(pool, &script.name).await?;
        let detail = db::create_script(pool, &script).await?;
        imported_script_ids.push(detail.id);
    }

    Ok(ImportResult {
        imported_script_ids,
        created_notification_channel_ids: created_channel_ids,
    })
}

async fn dedupe_import_name(pool: &sqlx::SqlitePool, base: &str) -> Result<String> {
    let existing = db::list_scripts(pool).await?;
    if !existing.iter().any(|script| script.name == base) {
        return Ok(base.to_string());
    }

    for counter in 1..=999 {
        let candidate = if counter == 1 {
            format!("{base} (Imported)")
        } else {
            format!("{base} (Imported {counter})")
        };
        if !existing.iter().any(|script| script.name == candidate) {
            return Ok(candidate);
        }
    }

    Err(anyhow!("could not find an available imported name"))
}

fn notification_channel_ref_from_channel(channel: NotificationChannel) -> NotificationChannelRef {
    NotificationChannelRef {
        kind: channel.kind,
        name: channel.name,
        has_secret: channel.has_secret,
    }
}

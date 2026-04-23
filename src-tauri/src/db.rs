use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use serde_json::{json, Value};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow};
use sqlx::{Row, SqlitePool};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use tokio::fs;
use uuid::Uuid;

use crate::models::{
    NotificationChannel, NotificationChannelInput, NotificationChannelKind, RunDetail,
    RunListFilter, RunLogLine, RunLogStream, RunStatus, RunSummary, RunTriggerKind, ScriptDetail,
    ScriptInput, ScriptPolicy, ScriptSummary, TriggerDefinition, TriggerKind,
};

pub mod migrations;

#[derive(Clone)]
pub struct Database {
    pub pool: SqlitePool,
    pub path: PathBuf,
}

pub async fn init_database(app_data_dir: &Path) -> Result<Database> {
    fs::create_dir_all(app_data_dir).await?;
    let db_path = app_data_dir.join("superpower.sqlite");
    let url = format!("sqlite://{}", db_path.display());
    let options = SqliteConnectOptions::from_str(&url)?.create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
        .with_context(|| format!("failed to connect to {}", db_path.display()))?;

    sqlx::query("PRAGMA journal_mode = WAL;")
        .execute(&pool)
        .await?;
    sqlx::query("PRAGMA foreign_keys = ON;")
        .execute(&pool)
        .await?;

    migrations::prepare_database(&pool, &db_path).await?;

    ensure_default_settings(&pool).await?;

    Ok(Database {
        pool,
        path: db_path,
    })
}

fn schema_statements() -> &'static [&'static str] {
    &[
        r#"
        CREATE TABLE IF NOT EXISTS scripts (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          description TEXT NOT NULL,
          code TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          manual_run_enabled INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          last_run_at TEXT
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS triggers (
          id TEXT PRIMARY KEY,
          script_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          config_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS script_policies (
          script_id TEXT PRIMARY KEY,
          notify_on_failure INTEGER NOT NULL,
          notify_on_success INTEGER NOT NULL,
          max_run_seconds INTEGER,
          FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS notification_channels (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL,
          name TEXT NOT NULL UNIQUE,
          enabled INTEGER NOT NULL,
          config_json_non_secret TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          script_id TEXT NOT NULL,
          trigger_kind TEXT NOT NULL,
          trigger_label TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT,
          duration_ms INTEGER,
          exit_code INTEGER,
          error_summary TEXT,
          coalesced_count INTEGER NOT NULL DEFAULT 0,
          FOREIGN KEY(script_id) REFERENCES scripts(id) ON DELETE CASCADE
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS run_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          stream TEXT NOT NULL,
          line_no INTEGER NOT NULL,
          content TEXT NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE CASCADE
        )
        "#,
        r#"
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        )
        "#,
    ]
}

async fn ensure_default_settings(pool: &SqlitePool) -> Result<()> {
    let existing = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM app_settings WHERE key = ?")
        .bind("log_retention_per_script")
        .fetch_one(pool)
        .await?;
    if existing == 0 {
        sqlx::query("INSERT INTO app_settings (key, value_json) VALUES (?, ?)")
            .bind("log_retention_per_script")
            .bind(json!(1000).to_string())
            .execute(pool)
            .await?;
    }

    let paused = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM app_settings WHERE key = ?")
        .bind("scheduler_paused")
        .fetch_one(pool)
        .await?;
    if paused == 0 {
        sqlx::query("INSERT INTO app_settings (key, value_json) VALUES (?, ?)")
            .bind("scheduler_paused")
            .bind(json!(false).to_string())
            .execute(pool)
            .await?;
    }

    Ok(())
}

pub async fn get_setting_json(pool: &SqlitePool, key: &str) -> Result<Option<Value>> {
    let row = sqlx::query("SELECT value_json FROM app_settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;

    row.map(|row| {
        let value: String = row.get("value_json");
        serde_json::from_str(&value).context("invalid app_settings value")
    })
    .transpose()
}

pub async fn set_setting_json(pool: &SqlitePool, key: &str, value: &Value) -> Result<()> {
    sqlx::query(
        "INSERT INTO app_settings (key, value_json) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
    )
    .bind(key)
    .bind(value.to_string())
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn list_scripts(pool: &SqlitePool) -> Result<Vec<ScriptSummary>> {
    let rows = sqlx::query(
        r#"
        SELECT s.*, COUNT(t.id) as trigger_count
        FROM scripts s
        LEFT JOIN triggers t ON t.script_id = s.id
        GROUP BY s.id
        ORDER BY lower(s.name) ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter().map(map_script_summary).collect()
}

pub async fn get_script(pool: &SqlitePool, script_id: &str) -> Result<ScriptDetail> {
    let row = sqlx::query("SELECT * FROM scripts WHERE id = ?")
        .bind(script_id)
        .fetch_one(pool)
        .await?;
    let policy_row = sqlx::query("SELECT * FROM script_policies WHERE script_id = ?")
        .bind(script_id)
        .fetch_optional(pool)
        .await?;
    let trigger_rows =
        sqlx::query("SELECT * FROM triggers WHERE script_id = ? ORDER BY created_at ASC")
            .bind(script_id)
            .fetch_all(pool)
            .await?;

    Ok(ScriptDetail {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        code: row.get("code"),
        enabled: row.get::<i64, _>("enabled") != 0,
        manual_run_enabled: row.get::<i64, _>("manual_run_enabled") != 0,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
        last_run_at: row.get("last_run_at"),
        triggers: trigger_rows
            .into_iter()
            .map(map_trigger_definition)
            .collect::<Result<Vec<_>>>()?,
        policy: map_script_policy(policy_row)?,
    })
}

pub async fn create_script(pool: &SqlitePool, input: &ScriptInput) -> Result<ScriptDetail> {
    let id = Uuid::new_v4().to_string();
    let now = now_iso();
    let mut tx = pool.begin().await?;

    sqlx::query(
        "INSERT INTO scripts (id, name, description, code, enabled, manual_run_enabled, created_at, updated_at, last_run_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)",
    )
    .bind(&id)
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.code)
    .bind(bool_to_int(input.enabled))
    .bind(bool_to_int(input.manual_run_enabled))
    .bind(&now)
    .bind(&now)
    .execute(&mut *tx)
    .await?;

    upsert_script_policy_tx(&mut tx, &id, &input.policy).await?;
    replace_triggers_tx(&mut tx, &id, &input.triggers).await?;
    tx.commit().await?;

    get_script(pool, &id).await
}

pub async fn update_script(
    pool: &SqlitePool,
    script_id: &str,
    input: &ScriptInput,
) -> Result<ScriptDetail> {
    let now = now_iso();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE scripts
         SET name = ?, description = ?, code = ?, enabled = ?, manual_run_enabled = ?, updated_at = ?
         WHERE id = ?",
    )
    .bind(&input.name)
    .bind(&input.description)
    .bind(&input.code)
    .bind(bool_to_int(input.enabled))
    .bind(bool_to_int(input.manual_run_enabled))
    .bind(&now)
    .bind(script_id)
    .execute(&mut *tx)
    .await?;

    upsert_script_policy_tx(&mut tx, script_id, &input.policy).await?;
    replace_triggers_tx(&mut tx, script_id, &input.triggers).await?;
    tx.commit().await?;

    get_script(pool, script_id).await
}

pub async fn delete_script(pool: &SqlitePool, script_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM scripts WHERE id = ?")
        .bind(script_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn duplicate_script(pool: &SqlitePool, script_id: &str) -> Result<ScriptDetail> {
    let script = get_script(pool, script_id).await?;
    let mut input = ScriptInput {
        name: dedupe_script_name(pool, &format!("{} Copy", script.name)).await?,
        description: script.description,
        code: script.code,
        enabled: false,
        manual_run_enabled: script.manual_run_enabled,
        triggers: script.triggers,
        policy: script.policy,
    };
    for trigger in &mut input.triggers {
        trigger.id = None;
    }
    create_script(pool, &input).await
}

async fn dedupe_script_name(pool: &SqlitePool, base: &str) -> Result<String> {
    let mut candidate = base.to_string();
    let mut counter = 2;
    loop {
        let exists = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM scripts WHERE name = ?")
            .bind(&candidate)
            .fetch_one(pool)
            .await?;
        if exists == 0 {
            return Ok(candidate);
        }
        candidate = format!("{base} {counter}");
        counter += 1;
    }
}

async fn upsert_script_policy_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    script_id: &str,
    policy: &ScriptPolicy,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO script_policies (script_id, notify_on_failure, notify_on_success, max_run_seconds)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(script_id) DO UPDATE SET
           notify_on_failure = excluded.notify_on_failure,
           notify_on_success = excluded.notify_on_success,
           max_run_seconds = excluded.max_run_seconds",
    )
    .bind(script_id)
    .bind(bool_to_int(policy.notify_on_failure))
    .bind(bool_to_int(policy.notify_on_success))
    .bind(policy.max_run_seconds)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn replace_triggers_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    script_id: &str,
    triggers: &[TriggerDefinition],
) -> Result<()> {
    sqlx::query("DELETE FROM triggers WHERE script_id = ?")
        .bind(script_id)
        .execute(&mut **tx)
        .await?;

    let now = now_iso();
    for trigger in triggers {
        let trigger_id = trigger
            .id
            .clone()
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        sqlx::query(
            "INSERT INTO triggers (id, script_id, kind, enabled, config_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(trigger_id)
        .bind(script_id)
        .bind(trigger.kind.as_str())
        .bind(bool_to_int(trigger.enabled))
        .bind(trigger.config.to_string())
        .bind(&now)
        .bind(&now)
        .execute(&mut **tx)
        .await?;
    }

    Ok(())
}

pub async fn set_script_enabled(
    pool: &SqlitePool,
    script_id: &str,
    enabled: bool,
) -> Result<ScriptSummary> {
    sqlx::query("UPDATE scripts SET enabled = ?, updated_at = ? WHERE id = ?")
        .bind(bool_to_int(enabled))
        .bind(now_iso())
        .bind(script_id)
        .execute(pool)
        .await?;

    list_scripts(pool)
        .await?
        .into_iter()
        .find(|script| script.id == script_id)
        .ok_or_else(|| anyhow!("script not found after update"))
}

pub async fn list_notification_channels(pool: &SqlitePool) -> Result<Vec<NotificationChannel>> {
    let rows = sqlx::query("SELECT * FROM notification_channels ORDER BY lower(name) ASC")
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(map_notification_channel).collect()
}

pub async fn upsert_notification_channel(
    pool: &SqlitePool,
    input: &NotificationChannelInput,
) -> Result<NotificationChannel> {
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let now = now_iso();
    let created_at = if input.id.is_some() {
        sqlx::query_scalar::<_, String>("SELECT created_at FROM notification_channels WHERE id = ?")
            .bind(&id)
            .fetch_optional(pool)
            .await?
            .unwrap_or_else(|| now.clone())
    } else {
        now.clone()
    };

    sqlx::query(
        "INSERT INTO notification_channels (id, kind, name, enabled, config_json_non_secret, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind,
           name = excluded.name,
           enabled = excluded.enabled,
           config_json_non_secret = excluded.config_json_non_secret,
           updated_at = excluded.updated_at",
    )
    .bind(&id)
    .bind(input.kind.as_str())
    .bind(&input.name)
    .bind(bool_to_int(input.enabled))
    .bind(input.config.to_string())
    .bind(created_at)
    .bind(&now)
    .execute(pool)
    .await?;

    get_notification_channel(pool, &id).await
}

pub async fn get_notification_channel(
    pool: &SqlitePool,
    channel_id: &str,
) -> Result<NotificationChannel> {
    let row = sqlx::query("SELECT * FROM notification_channels WHERE id = ?")
        .bind(channel_id)
        .fetch_one(pool)
        .await?;
    map_notification_channel(row)
}

pub async fn delete_notification_channel(pool: &SqlitePool, channel_id: &str) -> Result<()> {
    sqlx::query("DELETE FROM notification_channels WHERE id = ?")
        .bind(channel_id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn create_run(
    pool: &SqlitePool,
    script_id: &str,
    trigger_kind: RunTriggerKind,
    trigger_label: &str,
    status: RunStatus,
    started_at: Option<String>,
) -> Result<RunSummary> {
    let id = Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO runs (id, script_id, trigger_kind, trigger_label, status, started_at, finished_at, duration_ms, exit_code, error_summary, coalesced_count)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, 0)",
    )
    .bind(&id)
    .bind(script_id)
    .bind(trigger_kind.as_str())
    .bind(trigger_label)
    .bind(status.as_str())
    .bind(started_at)
    .execute(pool)
    .await?;
    get_run_summary(pool, &id).await
}

pub async fn increment_run_coalesced_count(pool: &SqlitePool, run_id: &str) -> Result<RunSummary> {
    sqlx::query("UPDATE runs SET coalesced_count = coalesced_count + 1 WHERE id = ?")
        .bind(run_id)
        .execute(pool)
        .await?;
    get_run_summary(pool, run_id).await
}

pub async fn mark_run_started(pool: &SqlitePool, run_id: &str) -> Result<RunSummary> {
    sqlx::query("UPDATE runs SET status = ?, started_at = ? WHERE id = ?")
        .bind(RunStatus::Running.as_str())
        .bind(now_iso())
        .bind(run_id)
        .execute(pool)
        .await?;
    get_run_summary(pool, run_id).await
}

pub async fn finish_run(
    pool: &SqlitePool,
    run_id: &str,
    status: RunStatus,
    exit_code: Option<i64>,
    error_summary: Option<String>,
) -> Result<RunSummary> {
    let started_at =
        sqlx::query_scalar::<_, Option<String>>("SELECT started_at FROM runs WHERE id = ?")
            .bind(run_id)
            .fetch_one(pool)
            .await?;
    let finished_at = now_iso();
    let duration_ms = started_at
        .as_deref()
        .and_then(parse_duration_ms(&finished_at));

    sqlx::query(
        "UPDATE runs
         SET status = ?, finished_at = ?, duration_ms = ?, exit_code = ?, error_summary = ?
         WHERE id = ?",
    )
    .bind(status.as_str())
    .bind(&finished_at)
    .bind(duration_ms)
    .bind(exit_code)
    .bind(error_summary)
    .bind(run_id)
    .execute(pool)
    .await?;

    let script_id = sqlx::query_scalar::<_, String>("SELECT script_id FROM runs WHERE id = ?")
        .bind(run_id)
        .fetch_one(pool)
        .await?;
    sqlx::query("UPDATE scripts SET last_run_at = ? WHERE id = ?")
        .bind(&finished_at)
        .bind(script_id)
        .execute(pool)
        .await?;

    prune_runs_for_limit(pool).await?;
    get_run_summary(pool, run_id).await
}

fn parse_duration_ms(finished_at: &str) -> impl FnOnce(&str) -> Option<i64> + '_ {
    move |started_at| {
        let start = chrono::DateTime::parse_from_rfc3339(started_at).ok()?;
        let finish = chrono::DateTime::parse_from_rfc3339(finished_at).ok()?;
        Some((finish - start).num_milliseconds())
    }
}

pub async fn insert_run_log(
    pool: &SqlitePool,
    run_id: &str,
    stream: RunLogStream,
    line_no: i64,
    content: &str,
) -> Result<RunLogLine> {
    let created_at = now_iso();
    let result = sqlx::query(
        "INSERT INTO run_logs (run_id, stream, line_no, content, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(run_id)
    .bind(stream.as_str())
    .bind(line_no)
    .bind(content)
    .bind(&created_at)
    .execute(pool)
    .await?;

    Ok(RunLogLine {
        id: result.last_insert_rowid(),
        run_id: run_id.to_string(),
        stream,
        line_no,
        content: content.to_string(),
        created_at,
    })
}

pub async fn list_runs(
    pool: &SqlitePool,
    filter: Option<RunListFilter>,
) -> Result<Vec<RunSummary>> {
    let rows = if let Some(filter) = filter {
        if let Some(script_id) = filter.script_id {
            sqlx::query(
                r#"
                SELECT r.*, s.name AS script_name
                FROM runs r
                INNER JOIN scripts s ON s.id = r.script_id
                WHERE r.script_id = ?
                ORDER BY COALESCE(r.started_at, r.finished_at, '') DESC
                LIMIT 250
                "#,
            )
            .bind(script_id)
            .fetch_all(pool)
            .await?
        } else {
            list_runs_rows(pool).await?
        }
    } else {
        list_runs_rows(pool).await?
    };

    rows.into_iter().map(map_run_summary).collect()
}

async fn list_runs_rows(pool: &SqlitePool) -> Result<Vec<SqliteRow>> {
    Ok(sqlx::query(
        r#"
        SELECT r.*, s.name AS script_name
        FROM runs r
        INNER JOIN scripts s ON s.id = r.script_id
        ORDER BY COALESCE(r.started_at, r.finished_at, '') DESC
        LIMIT 250
        "#,
    )
    .fetch_all(pool)
    .await?)
}

pub async fn get_run_summary(pool: &SqlitePool, run_id: &str) -> Result<RunSummary> {
    let row = sqlx::query(
        r#"
        SELECT r.*, s.name AS script_name
        FROM runs r
        INNER JOIN scripts s ON s.id = r.script_id
        WHERE r.id = ?
        "#,
    )
    .bind(run_id)
    .fetch_one(pool)
    .await?;
    map_run_summary(row)
}

pub async fn get_run_detail(pool: &SqlitePool, run_id: &str) -> Result<RunDetail> {
    let run = get_run_summary(pool, run_id).await?;
    let logs = get_run_logs(pool, run_id).await?;
    Ok(RunDetail { run, logs })
}

pub async fn get_run_logs(pool: &SqlitePool, run_id: &str) -> Result<Vec<RunLogLine>> {
    let rows = sqlx::query("SELECT * FROM run_logs WHERE run_id = ? ORDER BY id ASC")
        .bind(run_id)
        .fetch_all(pool)
        .await?;
    rows.into_iter().map(map_run_log).collect()
}

pub async fn list_enabled_triggers(
    pool: &SqlitePool,
) -> Result<Vec<(String, String, TriggerDefinition)>> {
    let rows = sqlx::query(
        r#"
        SELECT t.*, s.name AS script_name
        FROM triggers t
        INNER JOIN scripts s ON s.id = t.script_id
        INNER JOIN script_policies p ON p.script_id = s.id
        WHERE t.enabled = 1 AND s.enabled = 1
        ORDER BY t.created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await?;

    rows.into_iter()
        .map(|row| {
            let script_id: String = row.get("script_id");
            let script_name: String = row.get("script_name");
            let trigger = map_trigger_definition(row)?;
            Ok((script_id, script_name, trigger))
        })
        .collect()
}

pub async fn prune_runs_for_limit(pool: &SqlitePool) -> Result<()> {
    let retention = get_setting_json(pool, "log_retention_per_script")
        .await?
        .and_then(|value| value.as_i64())
        .unwrap_or(1000);

    let script_ids = sqlx::query_scalar::<_, String>("SELECT id FROM scripts")
        .fetch_all(pool)
        .await?;

    for script_id in script_ids {
        let old_run_ids = sqlx::query_scalar::<_, String>(
            r#"
            SELECT id
            FROM runs
            WHERE script_id = ?
            ORDER BY COALESCE(started_at, finished_at, '') DESC
            LIMIT -1 OFFSET ?
            "#,
        )
        .bind(&script_id)
        .bind(retention)
        .fetch_all(pool)
        .await?;

        for run_id in old_run_ids {
            sqlx::query("DELETE FROM runs WHERE id = ?")
                .bind(run_id)
                .execute(pool)
                .await?;
        }
    }
    Ok(())
}

fn map_script_summary(row: SqliteRow) -> Result<ScriptSummary> {
    Ok(ScriptSummary {
        id: row.get("id"),
        name: row.get("name"),
        description: row.get("description"),
        enabled: row.get::<i64, _>("enabled") != 0,
        manual_run_enabled: row.get::<i64, _>("manual_run_enabled") != 0,
        last_run_at: row.get("last_run_at"),
        updated_at: row.get("updated_at"),
        trigger_count: row.get::<i64, _>("trigger_count") as usize,
    })
}

fn map_script_policy(row: Option<SqliteRow>) -> Result<ScriptPolicy> {
    match row {
        Some(row) => Ok(ScriptPolicy {
            notify_on_failure: row.get::<i64, _>("notify_on_failure") != 0,
            notify_on_success: row.get::<i64, _>("notify_on_success") != 0,
            max_run_seconds: row.get("max_run_seconds"),
        }),
        None => Ok(ScriptPolicy::default()),
    }
}

fn map_trigger_definition(row: SqliteRow) -> Result<TriggerDefinition> {
    let kind: String = row.get("kind");
    let config_json: String = row.get("config_json");
    Ok(TriggerDefinition {
        id: Some(row.get("id")),
        kind: TriggerKind::from_str(&kind).ok_or_else(|| anyhow!("invalid trigger kind {kind}"))?,
        enabled: row.get::<i64, _>("enabled") != 0,
        config: serde_json::from_str(&config_json)?,
    })
}

fn map_notification_channel(row: SqliteRow) -> Result<NotificationChannel> {
    let kind: String = row.get("kind");
    let config_json: String = row.get("config_json_non_secret");
    Ok(NotificationChannel {
        id: row.get("id"),
        kind: NotificationChannelKind::from_str(&kind)
            .ok_or_else(|| anyhow!("invalid notification channel kind {kind}"))?,
        name: row.get("name"),
        enabled: row.get::<i64, _>("enabled") != 0,
        config: serde_json::from_str(&config_json)?,
        has_secret: false,
        created_at: row.get("created_at"),
        updated_at: row.get("updated_at"),
    })
}

fn map_run_summary(row: SqliteRow) -> Result<RunSummary> {
    let status: String = row.get("status");
    let trigger_kind: String = row.get("trigger_kind");
    Ok(RunSummary {
        id: row.get("id"),
        script_id: row.get("script_id"),
        script_name: row.get("script_name"),
        trigger_kind: RunTriggerKind::from_str(&trigger_kind)
            .ok_or_else(|| anyhow!("invalid trigger kind {trigger_kind}"))?,
        trigger_label: row.get("trigger_label"),
        status: RunStatus::from_str(&status)
            .ok_or_else(|| anyhow!("invalid run status {status}"))?,
        started_at: row.get("started_at"),
        finished_at: row.get("finished_at"),
        duration_ms: row.get("duration_ms"),
        exit_code: row.get("exit_code"),
        error_summary: row.get("error_summary"),
        coalesced_count: row.get("coalesced_count"),
    })
}

fn map_run_log(row: SqliteRow) -> Result<RunLogLine> {
    let stream: String = row.get("stream");
    Ok(RunLogLine {
        id: row.get("id"),
        run_id: row.get("run_id"),
        stream: RunLogStream::from_str(&stream)
            .ok_or_else(|| anyhow!("invalid run log stream {stream}"))?,
        line_no: row.get("line_no"),
        content: row.get("content"),
        created_at: row.get("created_at"),
    })
}

pub fn bool_to_int(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

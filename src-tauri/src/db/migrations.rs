use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use sqlx::{Executor, Row, Sqlite, SqlitePool, Transaction};
use std::path::{Path, PathBuf};
use tokio::fs;

pub const LATEST_SCHEMA_VERSION: i64 = 1;

pub async fn prepare_database(pool: &SqlitePool, path: &Path) -> Result<()> {
    let current_version = current_schema_version(pool).await?;
    if current_version > LATEST_SCHEMA_VERSION {
        return Err(anyhow!(
            "this database was created by a newer version of Superpower OSS (schema {}, supported {})",
            current_version,
            LATEST_SCHEMA_VERSION
        ));
    }

    let has_existing_schema = has_existing_app_schema(pool).await?;
    if current_version == 0 && !has_existing_schema {
        create_latest_schema(pool).await?;
        set_schema_version(pool, LATEST_SCHEMA_VERSION).await?;
        return Ok(());
    }

    if current_version == LATEST_SCHEMA_VERSION {
        return Ok(());
    }

    let backup_path = backup_database(pool, path)
        .await
        .with_context(|| format!("failed to create backup for {}", path.display()))?;

    for version in current_version..LATEST_SCHEMA_VERSION {
        let mut transaction = pool.begin().await?;
        run_migration_step(&mut transaction, version)
            .await
            .with_context(|| {
                format!(
                    "failed to migrate database from schema {} to {}",
                    version,
                    version + 1
                )
            })?;
        set_schema_version_tx(&mut transaction, version + 1).await?;
        transaction.commit().await?;
    }

    let final_version = current_schema_version(pool).await?;
    if final_version != LATEST_SCHEMA_VERSION {
        return Err(anyhow!(
            "database migration completed with unexpected schema version {} (expected {}), backup: {}",
            final_version,
            LATEST_SCHEMA_VERSION,
            backup_path.display()
        ));
    }

    Ok(())
}

pub async fn current_schema_version(pool: &SqlitePool) -> Result<i64> {
    let version = sqlx::query_scalar::<_, i64>("PRAGMA user_version")
        .fetch_one(pool)
        .await?;
    Ok(version)
}

pub async fn backup_database(pool: &SqlitePool, path: &Path) -> Result<PathBuf> {
    sqlx::query("PRAGMA wal_checkpoint(TRUNCATE);")
        .execute(pool)
        .await?;

    let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
    let backup_path = path.with_file_name(format!(
        "{}.bak.{}",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("superpower.sqlite"),
        timestamp
    ));
    fs::copy(path, &backup_path)
        .await
        .with_context(|| format!("failed to copy database to {}", backup_path.display()))?;
    Ok(backup_path)
}

async fn set_schema_version(pool: &SqlitePool, version: i64) -> Result<()> {
    sqlx::query(&format!("PRAGMA user_version = {version}"))
        .execute(pool)
        .await?;
    Ok(())
}

async fn set_schema_version_tx(
    transaction: &mut Transaction<'_, Sqlite>,
    version: i64,
) -> Result<()> {
    transaction
        .execute(sqlx::query(&format!("PRAGMA user_version = {version}")))
        .await?;
    Ok(())
}

async fn create_latest_schema(pool: &SqlitePool) -> Result<()> {
    for statement in super::schema_statements() {
        sqlx::query(statement).execute(pool).await?;
    }
    Ok(())
}

async fn run_migration_step(transaction: &mut Transaction<'_, Sqlite>, version: i64) -> Result<()> {
    match version {
        0 => migrate_0_to_1(transaction).await,
        _ => Err(anyhow!("no migration registered for schema {}", version)),
    }
}

async fn migrate_0_to_1(transaction: &mut Transaction<'_, Sqlite>) -> Result<()> {
    for statement in super::schema_statements() {
        transaction.execute(sqlx::query(statement)).await?;
    }
    Ok(())
}

async fn has_existing_app_schema(pool: &SqlitePool) -> Result<bool> {
    let row = sqlx::query(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('scripts', 'triggers', 'script_policies', 'notification_channels', 'runs', 'run_logs', 'app_settings')",
    )
    .fetch_one(pool)
    .await?;
    Ok(row.get::<i64, _>("count") > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use std::str::FromStr;
    use uuid::Uuid;

    const LEGACY_FIXTURE: &str = include_str!("../../tests/fixtures/db/v0.sql");

    #[tokio::test]
    async fn migrates_legacy_fixture_and_creates_backup() -> Result<()> {
        let temp_root =
            std::env::temp_dir().join(format!("superpower-migrations-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).await?;
        let db_path = temp_root.join("superpower.sqlite");
        let url = format!("sqlite://{}", db_path.display());
        let options = SqliteConnectOptions::from_str(&url)?.create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;

        for statement in LEGACY_FIXTURE.split("\n-- statement --\n") {
            let statement = statement.trim();
            if statement.is_empty() {
                continue;
            }
            sqlx::query(statement).execute(&pool).await?;
        }

        prepare_database(&pool, &db_path).await?;

        let version = current_schema_version(&pool).await?;
        assert_eq!(version, LATEST_SCHEMA_VERSION);

        let script_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM scripts")
            .fetch_one(&pool)
            .await?;
        let policy_count = sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM script_policies")
            .fetch_one(&pool)
            .await?;
        assert_eq!(script_count, 1);
        assert_eq!(policy_count, 1);

        let mut backup_count = 0usize;
        let mut directory = fs::read_dir(&temp_root).await?;
        while let Some(entry) = directory.next_entry().await? {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("superpower.sqlite.bak.")
            {
                backup_count += 1;
            }
        }
        assert_eq!(backup_count, 1);

        Ok(())
    }

    #[tokio::test]
    async fn initializes_fresh_databases_directly_to_latest_version() -> Result<()> {
        let temp_root =
            std::env::temp_dir().join(format!("superpower-migrations-{}", Uuid::new_v4()));
        fs::create_dir_all(&temp_root).await?;
        let db_path = temp_root.join("superpower.sqlite");
        let url = format!("sqlite://{}", db_path.display());
        let options = SqliteConnectOptions::from_str(&url)?.create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await?;

        prepare_database(&pool, &db_path).await?;

        assert_eq!(current_schema_version(&pool).await?, LATEST_SCHEMA_VERSION);
        let mut has_backup = false;
        let mut dir = fs::read_dir(&temp_root).await?;
        while let Some(entry) = dir.next_entry().await? {
            if entry
                .file_name()
                .to_string_lossy()
                .starts_with("superpower.sqlite.bak.")
            {
                has_backup = true;
            }
        }
        assert!(!has_backup);

        Ok(())
    }
}

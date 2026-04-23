use anyhow::{Context, Result};
use serde_json::Value;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use tokio::fs;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::app_state::AppState;
use crate::db;
use crate::models::{
    NotifyPayload, RunEventPayload, RunLogEventPayload, RunLogStream, RunStatus, RunSummary,
    RuntimeRunContext, ScriptDetail,
};
use crate::notifications;

use super::bun::{validate_bun_path, BunRuntime};

const NOTIFY_PREFIX: &str = "__SUPERPOWER_NOTIFY__:";

#[derive(Debug, Clone)]
pub struct ExecutionRequest {
    pub run_id: String,
    pub script_id: String,
    pub trigger_kind: crate::models::RunTriggerKind,
    pub trigger_label: String,
    pub payload: Option<Value>,
}

pub async fn execute_run(app: AppHandle, state: AppState, request: ExecutionRequest) -> Result<()> {
    let script = db::get_script(&state.db.pool, &request.script_id).await?;
    let runtime = BunRuntime::resolve(&app).await?;
    validate_bun_path(&runtime.executable)?;

    let run = db::get_run_summary(&state.db.pool, &request.run_id).await?;
    app.emit("run:started", RunEventPayload { run: run.clone() })
        .ok();

    let script_file = write_script_file(&app, &script).await?;
    let wrapper_file = write_wrapper_file(&app).await?;
    let run_context = RuntimeRunContext {
        script_id: script.id.clone(),
        script_name: script.name.clone(),
        trigger: crate::models::RunContextTrigger {
            kind: request.trigger_kind,
            label: request.trigger_label.clone(),
            fired_at: db::now_iso(),
        },
        payload: request.payload.clone(),
    };

    let mut child = Command::new(&runtime.executable)
        .arg("run")
        .arg(&wrapper_file)
        .env(
            "SUPERPOWER_SCRIPT_FILE",
            script_file.to_string_lossy().to_string(),
        )
        .env(
            "SUPERPOWER_RUN_CONTEXT",
            serde_json::to_string(&run_context)?,
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .context("failed to spawn bun runtime")?;

    let stdout = child.stdout.take().context("missing stdout pipe")?;
    let stderr = child.stderr.take().context("missing stderr pipe")?;

    let stdout_task = tokio::spawn(process_stdout(
        app.clone(),
        state.clone(),
        run.clone(),
        BufReader::new(stdout),
    ));
    let stderr_task = tokio::spawn(process_stderr(
        app.clone(),
        state.clone(),
        run.clone(),
        BufReader::new(stderr),
    ));

    let output = child.wait().await?;
    stdout_task.await??;
    stderr_task.await??;

    let status = if output.success() {
        RunStatus::Success
    } else {
        RunStatus::Failure
    };
    let exit_code = output.code().map(i64::from);
    let error_summary = if status == RunStatus::Failure {
        Some(format!(
            "Script exited with status {}",
            exit_code
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        ))
    } else {
        None
    };

    let finished_run = db::finish_run(
        &state.db.pool,
        &request.run_id,
        status,
        exit_code,
        error_summary,
    )
    .await?;
    maybe_send_status_notification(&app, &state, &script, &finished_run).await?;
    app.emit("run:finished", RunEventPayload { run: finished_run })
        .ok();
    Ok(())
}

async fn maybe_send_status_notification(
    app: &AppHandle,
    state: &AppState,
    script: &ScriptDetail,
    run: &RunSummary,
) -> Result<()> {
    match run.status {
        RunStatus::Failure if script.policy.notify_on_failure => {
            notifications::send_broadcast_notification(
                app,
                &state.db.pool,
                run,
                &NotifyPayload {
                    title: Some(format!("{} failed", script.name)),
                    message: run
                        .error_summary
                        .clone()
                        .unwrap_or_else(|| "Script execution failed".to_string()),
                    level: Some("error".to_string()),
                    channel: None,
                    metadata: None,
                },
            )
            .await?;
        }
        RunStatus::Success if script.policy.notify_on_success => {
            notifications::send_broadcast_notification(
                app,
                &state.db.pool,
                run,
                &NotifyPayload {
                    title: Some(format!("{} succeeded", script.name)),
                    message: "Script execution completed".to_string(),
                    level: Some("info".to_string()),
                    channel: None,
                    metadata: None,
                },
            )
            .await?;
        }
        _ => {}
    }
    Ok(())
}

async fn process_stdout(
    app: AppHandle,
    state: AppState,
    run: RunSummary,
    reader: BufReader<tokio::process::ChildStdout>,
) -> Result<()> {
    process_stream(app, state, run, reader, RunLogStream::Stdout).await
}

async fn process_stderr(
    app: AppHandle,
    state: AppState,
    run: RunSummary,
    reader: BufReader<tokio::process::ChildStderr>,
) -> Result<()> {
    process_stream(app, state, run, reader, RunLogStream::Stderr).await
}

async fn process_stream<R>(
    app: AppHandle,
    state: AppState,
    run: RunSummary,
    mut reader: BufReader<R>,
    stream: RunLogStream,
) -> Result<()>
where
    R: tokio::io::AsyncRead + Unpin,
{
    let mut line_no = 0i64;
    let mut buf = String::new();

    loop {
        buf.clear();
        let bytes = reader.read_line(&mut buf).await?;
        if bytes == 0 {
            break;
        }
        let line = buf.trim_end_matches(&['\r', '\n'][..]).to_string();
        line_no += 1;

        if stream == RunLogStream::Stdout && line.starts_with(NOTIFY_PREFIX) {
            let payload = &line[NOTIFY_PREFIX.len()..];
            match serde_json::from_str::<NotifyPayload>(payload) {
                Ok(payload) => {
                    let log = db::insert_run_log(
                        &state.db.pool,
                        &run.id,
                        RunLogStream::Event,
                        line_no,
                        &serde_json::to_string(&payload)?,
                    )
                    .await?;
                    app.emit(
                        "run:log",
                        RunLogEventPayload {
                            run_id: run.id.clone(),
                            log,
                        },
                    )
                    .ok();
                    notifications::send_broadcast_notification(
                        &app,
                        &state.db.pool,
                        &run,
                        &payload,
                    )
                    .await?;
                }
                Err(error) => {
                    let log = db::insert_run_log(
                        &state.db.pool,
                        &run.id,
                        RunLogStream::Event,
                        line_no,
                        &format!("invalid notify payload: {error}"),
                    )
                    .await?;
                    app.emit(
                        "run:log",
                        RunLogEventPayload {
                            run_id: run.id.clone(),
                            log,
                        },
                    )
                    .ok();
                }
            }
            continue;
        }

        let log = db::insert_run_log(&state.db.pool, &run.id, stream, line_no, &line).await?;
        app.emit(
            "run:log",
            RunLogEventPayload {
                run_id: run.id.clone(),
                log,
            },
        )
        .ok();
    }

    Ok(())
}

async fn write_script_file(app: &AppHandle, script: &ScriptDetail) -> Result<PathBuf> {
    let directory = app.path().app_data_dir()?.join("scripts");
    fs::create_dir_all(&directory).await?;
    let script_path = directory.join(format!("{}.ts", script.id));
    fs::write(&script_path, &script.code).await?;
    Ok(script_path)
}

async fn write_wrapper_file(app: &AppHandle) -> Result<PathBuf> {
    let directory = app.path().app_data_dir()?.join("runtime");
    fs::create_dir_all(&directory).await?;
    let wrapper_path = directory.join("run-script.ts");
    let wrapper = r#"
globalThis.runContext = JSON.parse(process.env.SUPERPOWER_RUN_CONTEXT ?? "{}");
globalThis.notify = async (input) => {
  process.stdout.write(`__SUPERPOWER_NOTIFY__:${JSON.stringify(input)}\n`);
};

try {
  const scriptPath = process.env.SUPERPOWER_SCRIPT_FILE;
  if (!scriptPath) {
    throw new Error("SUPERPOWER_SCRIPT_FILE is not defined");
  }
  await import(scriptPath);
} catch (error) {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
}
"#;
    fs::write(&wrapper_path, wrapper).await?;
    Ok(wrapper_path)
}

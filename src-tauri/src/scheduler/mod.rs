use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde_json::{json, Value};
use tauri::AppHandle;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::app_state::AppState;
use crate::db;
use crate::models::{
    RunStatus, RunSummary, RunTriggerKind, SchedulerState, TriggerDefinition, TriggerKind,
};
use crate::runtime::runner::{self, ExecutionRequest};

pub mod cron;
pub mod monitors;

#[derive(Clone)]
pub struct SchedulerController {
    inner: Arc<Mutex<SchedulerInner>>,
}

struct SchedulerInner {
    paused: bool,
    tasks: Vec<JoinHandle<()>>,
    watchers: Vec<RecommendedWatcher>,
    executions: HashMap<String, ScriptExecutionState>,
}

#[derive(Default)]
struct ScriptExecutionState {
    active: bool,
    queued: Option<QueuedExecution>,
}

#[derive(Clone)]
struct RunIntent {
    script_id: String,
    trigger_kind: RunTriggerKind,
    trigger_label: String,
    payload: Option<Value>,
}

#[derive(Clone)]
struct QueuedExecution {
    run_id: String,
    intent: RunIntent,
}

impl SchedulerController {
    pub fn new(paused: bool) -> Self {
        Self {
            inner: Arc::new(Mutex::new(SchedulerInner {
                paused,
                tasks: Vec::new(),
                watchers: Vec::new(),
                executions: HashMap::new(),
            })),
        }
    }

    pub async fn set_paused(&self, paused: bool) {
        self.inner.lock().await.paused = paused;
    }

    pub async fn scheduler_state(&self) -> SchedulerState {
        let inner = self.inner.lock().await;
        SchedulerState {
            paused: inner.paused,
            active_runs: inner
                .executions
                .values()
                .filter(|state| state.active)
                .count(),
        }
    }

    pub async fn refresh(&self, app: AppHandle, state: AppState) -> Result<()> {
        {
            let mut inner = self.inner.lock().await;
            for task in inner.tasks.drain(..) {
                task.abort();
            }
            inner.watchers.clear();
        }

        let triggers = db::list_enabled_triggers(&state.db.pool).await?;
        for (script_id, script_name, trigger) in triggers {
            self.spawn_trigger(app.clone(), state.clone(), script_id, script_name, trigger)
                .await?;
        }

        Ok(())
    }

    pub async fn request_manual_run(
        &self,
        app: AppHandle,
        state: AppState,
        script_id: String,
    ) -> Result<RunSummary> {
        let script = db::get_script(&state.db.pool, &script_id).await?;
        self.enqueue(
            app,
            state,
            RunIntent {
                script_id,
                trigger_kind: RunTriggerKind::Manual,
                trigger_label: format!("Manual run · {}", script.name),
                payload: None,
            },
            true,
        )
        .await
    }

    pub async fn request_automatic_run(
        &self,
        app: AppHandle,
        state: AppState,
        intent: AutomaticRunIntent,
    ) -> Result<Option<RunSummary>> {
        if self.inner.lock().await.paused {
            return Ok(None);
        }

        Ok(Some(
            self.enqueue(
                app,
                state,
                RunIntent {
                    script_id: intent.script_id,
                    trigger_kind: intent.trigger_kind,
                    trigger_label: intent.trigger_label,
                    payload: intent.payload,
                },
                false,
            )
            .await?,
        ))
    }

    async fn enqueue(
        &self,
        app: AppHandle,
        state: AppState,
        intent: RunIntent,
        _manual: bool,
    ) -> Result<RunSummary> {
        let mut inner = self.inner.lock().await;
        let execution_state = inner
            .executions
            .entry(intent.script_id.clone())
            .or_default();

        if execution_state.active {
            if let Some(queued) = &execution_state.queued {
                let run = db::increment_run_coalesced_count(&state.db.pool, &queued.run_id).await?;
                return Ok(run);
            }

            let queued_run = db::create_run(
                &state.db.pool,
                &intent.script_id,
                intent.trigger_kind,
                &intent.trigger_label,
                RunStatus::Queued,
                None,
            )
            .await?;

            execution_state.queued = Some(QueuedExecution {
                run_id: queued_run.id.clone(),
                intent,
            });
            return Ok(queued_run);
        }

        let running = db::create_run(
            &state.db.pool,
            &intent.script_id,
            intent.trigger_kind,
            &intent.trigger_label,
            RunStatus::Running,
            Some(db::now_iso()),
        )
        .await?;
        execution_state.active = true;
        drop(inner);

        self.spawn_execution_task(
            app,
            state,
            ExecutionRequest {
                run_id: running.id.clone(),
                script_id: running.script_id.clone(),
                trigger_kind: running.trigger_kind,
                trigger_label: running.trigger_label.clone(),
                payload: intent.payload,
            },
        );

        Ok(running)
    }

    fn spawn_execution_task(&self, app: AppHandle, state: AppState, request: ExecutionRequest) {
        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            let script_id = request.script_id.clone();
            let run_id = request.run_id.clone();
            if let Err(error) = runner::execute_run(app.clone(), state.clone(), request).await {
                let _ = db::insert_run_log(
                    &state.db.pool,
                    &run_id,
                    crate::models::RunLogStream::Event,
                    0,
                    &format!("execution error: {error:#}"),
                )
                .await;
                let _ = db::finish_run(
                    &state.db.pool,
                    &run_id,
                    RunStatus::Failure,
                    Some(1),
                    Some(error.to_string()),
                )
                .await;
            }
            controller.on_run_completed(app, state, script_id).await;
        });
    }

    async fn on_run_completed(&self, app: AppHandle, state: AppState, script_id: String) {
        let queued = {
            let mut inner = self.inner.lock().await;
            let execution_state = inner.executions.entry(script_id.clone()).or_default();
            if let Some(queued) = execution_state.queued.take() {
                execution_state.active = true;
                Some(queued)
            } else {
                execution_state.active = false;
                None
            }
        };

        if let Some(queued) = queued {
            if db::mark_run_started(&state.db.pool, &queued.run_id)
                .await
                .is_ok()
            {
                self.spawn_execution_task(
                    app,
                    state,
                    ExecutionRequest {
                        run_id: queued.run_id,
                        script_id: queued.intent.script_id,
                        trigger_kind: queued.intent.trigger_kind,
                        trigger_label: queued.intent.trigger_label,
                        payload: queued.intent.payload,
                    },
                );
            }
        }
    }

    async fn spawn_trigger(
        &self,
        app: AppHandle,
        state: AppState,
        script_id: String,
        script_name: String,
        trigger: TriggerDefinition,
    ) -> Result<()> {
        match trigger.kind {
            TriggerKind::Cron => {
                let expression = trigger
                    .config
                    .get("cron")
                    .and_then(Value::as_str)
                    .context("cron trigger missing cron expression")?
                    .to_string();
                let label = trigger
                    .config
                    .get("label")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("Cron · {}", expression));
                let controller = self.clone();
                let handle = tokio::spawn(async move {
                    loop {
                        let sleep_for = match cron::cron_sleep_duration(&expression) {
                            Ok(duration) => duration,
                            Err(_) => Duration::from_secs(60),
                        };
                        tokio::time::sleep(sleep_for).await;
                        let _ = controller
                            .request_automatic_run(
                                app.clone(),
                                state.clone(),
                                AutomaticRunIntent {
                                    script_id: script_id.clone(),
                                    trigger_kind: RunTriggerKind::Cron,
                                    trigger_label: label.clone(),
                                    payload: None,
                                },
                            )
                            .await;
                    }
                });
                self.inner.lock().await.tasks.push(handle);
            }
            TriggerKind::Uptime | TriggerKind::ApiPoll => {
                let interval = trigger
                    .config
                    .get("intervalSeconds")
                    .and_then(Value::as_u64)
                    .unwrap_or(60);
                let label = trigger
                    .config
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("{:?} · {}", trigger.kind, script_name));
                let controller = self.clone();
                let trigger_kind = if trigger.kind == TriggerKind::Uptime {
                    RunTriggerKind::Uptime
                } else {
                    RunTriggerKind::ApiPoll
                };
                let handle = tokio::spawn(async move {
                    loop {
                        tokio::time::sleep(Duration::from_secs(interval.max(5))).await;
                        let payload = fetch_monitor_payload(&trigger).await.ok();
                        let _ = controller
                            .request_automatic_run(
                                app.clone(),
                                state.clone(),
                                AutomaticRunIntent {
                                    script_id: script_id.clone(),
                                    trigger_kind,
                                    trigger_label: label.clone(),
                                    payload,
                                },
                            )
                            .await;
                    }
                });
                self.inner.lock().await.tasks.push(handle);
            }
            TriggerKind::FileWatch => {
                let path = trigger
                    .config
                    .get("path")
                    .and_then(Value::as_str)
                    .context("file_watch trigger missing path")?
                    .to_string();
                let recursive = trigger
                    .config
                    .get("recursive")
                    .and_then(Value::as_bool)
                    .unwrap_or(true);
                let debounce_ms = trigger
                    .config
                    .get("debounceMs")
                    .and_then(Value::as_u64)
                    .unwrap_or(700);
                let event_types = trigger
                    .config
                    .get("eventTypes")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_else(|| vec![Value::String("modify".to_string())]);
                let label = trigger
                    .config
                    .get("name")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
                    .unwrap_or_else(|| format!("File Watch · {}", path));
                let controller = self.clone();
                let generation = Arc::new(std::sync::atomic::AtomicU64::new(0));
                let watcher = notify::recommended_watcher({
                    let generation = generation.clone();
                    move |res: notify::Result<notify::Event>| {
                        if let Ok(event) = res {
                            if !matches_event_filter(&event.kind, &event_types) {
                                return;
                            }
                            let generation_value =
                                generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                            let controller = controller.clone();
                            let app = app.clone();
                            let state = state.clone();
                            let script_id = script_id.clone();
                            let label = label.clone();
                            let payload = monitors::file_watch_payload(
                                event_kind_label(&event.kind),
                                event
                                    .paths
                                    .iter()
                                    .map(|path| path.to_string_lossy().to_string())
                                    .collect(),
                            );
                            let generation = generation.clone();
                            tauri::async_runtime::spawn(async move {
                                tokio::time::sleep(Duration::from_millis(debounce_ms)).await;
                                if generation.load(std::sync::atomic::Ordering::SeqCst)
                                    == generation_value
                                {
                                    let _ = controller
                                        .request_automatic_run(
                                            app,
                                            state,
                                            AutomaticRunIntent {
                                                script_id,
                                                trigger_kind: RunTriggerKind::FileWatch,
                                                trigger_label: label,
                                                payload: Some(payload),
                                            },
                                        )
                                        .await;
                                }
                            });
                        }
                    }
                })?;
                let mut watcher = watcher;
                watcher.watch(
                    Path::new(&path),
                    if recursive {
                        RecursiveMode::Recursive
                    } else {
                        RecursiveMode::NonRecursive
                    },
                )?;
                self.inner.lock().await.watchers.push(watcher);
            }
        }
        Ok(())
    }
}

#[derive(Clone)]
pub struct AutomaticRunIntent {
    pub script_id: String,
    pub trigger_kind: RunTriggerKind,
    pub trigger_label: String,
    pub payload: Option<Value>,
}

async fn fetch_monitor_payload(trigger: &TriggerDefinition) -> Result<Value> {
    let url = trigger
        .config
        .get("url")
        .and_then(Value::as_str)
        .context("monitor trigger missing url")?;
    let method = trigger
        .config
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("GET");
    let timeout = trigger
        .config
        .get("timeoutSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(15);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout.max(1)))
        .build()?;

    let mut request = match method {
        "HEAD" => client.head(url),
        "POST" => client.post(url),
        "PUT" => client.put(url),
        _ => client.get(url),
    };

    if let Some(headers) = trigger.config.get("headers").and_then(Value::as_object) {
        for (name, value) in headers {
            if let Some(value) = value.as_str() {
                request = request.header(name, value);
            }
        }
    }

    if let Some(body) = trigger.config.get("body") {
        if !body.is_null() {
            request = request.json(body);
        }
    }

    let response = request.send().await?;
    let status = response.status().as_u16();
    let headers = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|value| (name.to_string(), value.to_string()))
        })
        .collect::<HashMap<_, _>>();
    let text = response.text().await.unwrap_or_default();
    let parsed_json = serde_json::from_str::<Value>(&text).ok();

    Ok(json!({
        "url": url,
        "status": status,
        "ok": (200..=299).contains(&status),
        "headers": headers,
        "text": text,
        "json": parsed_json,
    }))
}

fn matches_event_filter(kind: &EventKind, filters: &[Value]) -> bool {
    let wanted = filters.iter().filter_map(Value::as_str).collect::<Vec<_>>();
    if wanted.is_empty() {
        return true;
    }

    match kind {
        EventKind::Create(_) => wanted.contains(&"create"),
        EventKind::Modify(_) => wanted.contains(&"modify"),
        EventKind::Remove(_) => wanted.contains(&"delete"),
        _ => false,
    }
}

fn event_kind_label(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "delete",
        _ => "other",
    }
}

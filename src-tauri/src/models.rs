use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    Cron,
    Uptime,
    FileWatch,
    ApiPoll,
}

impl TriggerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cron => "cron",
            Self::Uptime => "uptime",
            Self::FileWatch => "file_watch",
            Self::ApiPoll => "api_poll",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "cron" => Some(Self::Cron),
            "uptime" => Some(Self::Uptime),
            "file_watch" => Some(Self::FileWatch),
            "api_poll" => Some(Self::ApiPoll),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunTriggerKind {
    Manual,
    Cron,
    Uptime,
    FileWatch,
    ApiPoll,
}

impl RunTriggerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Cron => "cron",
            Self::Uptime => "uptime",
            Self::FileWatch => "file_watch",
            Self::ApiPoll => "api_poll",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "manual" => Some(Self::Manual),
            "cron" => Some(Self::Cron),
            "uptime" => Some(Self::Uptime),
            "file_watch" => Some(Self::FileWatch),
            "api_poll" => Some(Self::ApiPoll),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    Queued,
    Running,
    Success,
    Failure,
    Skipped,
    Canceled,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Success => "success",
            Self::Failure => "failure",
            Self::Skipped => "skipped",
            Self::Canceled => "canceled",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "success" => Some(Self::Success),
            "failure" => Some(Self::Failure),
            "skipped" => Some(Self::Skipped),
            "canceled" => Some(Self::Canceled),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunLogStream {
    Stdout,
    Stderr,
    Event,
}

impl RunLogStream {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::Event => "event",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "stdout" => Some(Self::Stdout),
            "stderr" => Some(Self::Stderr),
            "event" => Some(Self::Event),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotificationChannelKind {
    Slack,
    Discord,
    Native,
    Smtp,
    Http,
}

impl NotificationChannelKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Slack => "slack",
            Self::Discord => "discord",
            Self::Native => "native",
            Self::Smtp => "smtp",
            Self::Http => "http",
        }
    }

    pub fn from_str(value: &str) -> Option<Self> {
        match value {
            "slack" => Some(Self::Slack),
            "discord" => Some(Self::Discord),
            "native" => Some(Self::Native),
            "smtp" => Some(Self::Smtp),
            "http" => Some(Self::Http),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TriggerDefinition {
    pub id: Option<String>,
    pub kind: TriggerKind,
    pub enabled: bool,
    pub config: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptPolicy {
    pub notify_on_failure: bool,
    pub notify_on_success: bool,
    pub max_run_seconds: Option<i64>,
}

impl Default for ScriptPolicy {
    fn default() -> Self {
        Self {
            notify_on_failure: false,
            notify_on_success: false,
            max_run_seconds: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptSummary {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub manual_run_enabled: bool,
    pub last_run_at: Option<String>,
    pub updated_at: String,
    pub trigger_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptDetail {
    pub id: String,
    pub name: String,
    pub description: String,
    pub code: String,
    pub enabled: bool,
    pub manual_run_enabled: bool,
    pub created_at: String,
    pub updated_at: String,
    pub last_run_at: Option<String>,
    pub triggers: Vec<TriggerDefinition>,
    pub policy: ScriptPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptInput {
    pub name: String,
    pub description: String,
    pub code: String,
    pub enabled: bool,
    pub manual_run_enabled: bool,
    pub triggers: Vec<TriggerDefinition>,
    pub policy: ScriptPolicy,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub script_id: String,
    pub script_name: String,
    pub trigger_kind: RunTriggerKind,
    pub trigger_label: String,
    pub status: RunStatus,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration_ms: Option<i64>,
    pub exit_code: Option<i64>,
    pub error_summary: Option<String>,
    pub coalesced_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogLine {
    pub id: i64,
    pub run_id: String,
    pub stream: RunLogStream,
    pub line_no: i64,
    pub content: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub run: RunSummary,
    pub logs: Vec<RunLogLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunListFilter {
    pub script_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChannel {
    pub id: String,
    pub kind: NotificationChannelKind,
    pub name: String,
    pub enabled: bool,
    pub config: Value,
    pub has_secret: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChannelInput {
    pub id: Option<String>,
    pub kind: NotificationChannelKind,
    pub name: String,
    pub enabled: bool,
    pub config: Value,
    pub secret: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeHealth {
    pub bun_path: Option<String>,
    pub bun_version: Option<String>,
    pub bundled_bun_available: bool,
    pub scheduler_paused: bool,
    pub db_path: String,
    pub app_version: String,
    pub updates_configured: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchedulerState {
    pub paused: bool,
    pub active_runs: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub script_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationChannelRef {
    pub kind: NotificationChannelKind,
    pub name: String,
    pub has_secret: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub preview_id: String,
    pub scripts: Vec<ScriptInput>,
    pub notification_channel_refs: Vec<NotificationChannelRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub imported_script_ids: Vec<String>,
    pub created_notification_channel_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPackageV1 {
    pub version: i64,
    pub exported_at: String,
    pub app: String,
    pub scripts: Vec<ScriptInput>,
    pub notification_channel_refs: Vec<NotificationChannelRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifyPayload {
    pub title: Option<String>,
    pub message: String,
    pub level: Option<String>,
    pub channel: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunContextTrigger {
    pub kind: RunTriggerKind,
    pub label: String,
    pub fired_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeRunContext {
    pub script_id: String,
    pub script_name: String,
    pub trigger: RunContextTrigger,
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEventPayload {
    pub run: RunSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunLogEventPayload {
    pub run_id: String,
    pub log: RunLogLine,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSummary {
    pub version: String,
    pub current_version: String,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub channel: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateConfiguration {
    pub app_version: String,
    pub updates_configured: bool,
}

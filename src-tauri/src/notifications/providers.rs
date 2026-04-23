use anyhow::{anyhow, Context, Result};
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use reqwest::header::CONTENT_TYPE;
use reqwest::Client;
use serde_json::{json, Map, Value};
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;

use crate::models::{NotificationChannel, NotificationChannelKind};

const DEFAULT_HTTP_BODY_TEMPLATE: &str = r#"{
  "app": "{{app}}",
  "scriptId": "{{scriptId}}",
  "scriptName": "{{scriptName}}",
  "title": "{{title}}",
  "message": "{{message}}",
  "level": "{{level}}",
  "triggerLabel": "{{triggerLabel}}",
  "timestamp": "{{timestamp}}",
  "channel": "{{channel}}",
  "metadata": "{{metadata}}"
}"#;

#[derive(Debug, Clone)]
pub struct NormalizedNotification {
    pub title: Option<String>,
    pub message: String,
    pub level: String,
    pub script_name: String,
    pub script_id: String,
    pub trigger_label: String,
    pub timestamp: String,
    pub channel: Option<String>,
    pub metadata: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum HttpBodyMode {
    Json,
    Raw,
}

#[derive(Debug, Clone)]
struct RenderedHttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: String,
    body_mode: HttpBodyMode,
}

pub async fn send_notification(
    app: &AppHandle,
    channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<()> {
    match channel.kind {
        NotificationChannelKind::Slack => send_slack(channel, secret, payload).await,
        NotificationChannelKind::Discord => send_discord(channel, secret, payload).await,
        NotificationChannelKind::Native => send_native(app, payload),
        NotificationChannelKind::Smtp => send_smtp(channel, secret, payload).await,
        NotificationChannelKind::Http => send_http(channel, secret, payload).await,
    }
}

async fn send_slack(
    _channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<()> {
    let webhook = secret
        .as_ref()
        .and_then(|value| value.get("webhookUrl"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing Slack webhookUrl"))?;

    Client::new()
        .post(webhook)
        .json(&json!({
            "text": format!("[{}] {}: {}", payload.level.to_uppercase(), payload.script_name, payload.message),
            "blocks": [
                {
                    "type": "section",
                    "text": { "type": "mrkdwn", "text": format!("*{}*\n{}", payload.script_name, payload.message) }
                },
                {
                    "type": "context",
                    "elements": [
                        { "type": "mrkdwn", "text": format!("Trigger: {}", payload.trigger_label) },
                        { "type": "mrkdwn", "text": format!("Level: {}", payload.level) }
                    ]
                }
            ]
        }))
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}

async fn send_discord(
    _channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<()> {
    let webhook = secret
        .as_ref()
        .and_then(|value| value.get("webhookUrl"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing Discord webhookUrl"))?;

    Client::new()
        .post(webhook)
        .json(&json!({
            "content": format!("**{}**\n{}\nTrigger: {}", payload.script_name, payload.message, payload.trigger_label)
        }))
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}

fn send_native(app: &AppHandle, payload: &NormalizedNotification) -> Result<()> {
    app.notification()
        .builder()
        .title(payload.title.as_deref().unwrap_or(&payload.script_name))
        .body(&payload.message)
        .show()?;
    Ok(())
}

async fn send_smtp(
    channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<()> {
    let host = channel
        .config
        .get("host")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing SMTP host"))?;
    let port = channel
        .config
        .get("port")
        .and_then(Value::as_u64)
        .unwrap_or(587) as u16;
    let from = channel
        .config
        .get("from")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing SMTP from"))?;
    let to = channel
        .config
        .get("to")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing SMTP to"))?;
    let username = channel
        .config
        .get("username")
        .and_then(Value::as_str)
        .unwrap_or(from);
    let password = secret
        .as_ref()
        .and_then(|value| value.get("password"))
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing SMTP password"))?;

    let email = Message::builder()
        .from(from.parse().context("invalid SMTP from address")?)
        .to(to.parse().context("invalid SMTP to address")?)
        .subject(
            channel
                .config
                .get("subjectPrefix")
                .and_then(Value::as_str)
                .map(|prefix| format!("{prefix} {}", payload.script_name))
                .unwrap_or_else(|| format!("Superpower OSS: {}", payload.script_name)),
        )
        .body(format!(
            "{}\n\nScript: {}\nTrigger: {}\nTime: {}\nLevel: {}\nChannel: {}\nMetadata: {}",
            payload.message,
            payload.script_name,
            payload.trigger_label,
            payload.timestamp,
            payload.level,
            payload.channel.clone().unwrap_or_else(|| "-".to_string()),
            payload
                .metadata
                .as_ref()
                .map(ToString::to_string)
                .unwrap_or_else(|| "{}".to_string())
        ))?;

    let mailer = AsyncSmtpTransport::<Tokio1Executor>::relay(host)?
        .port(port)
        .credentials(Credentials::new(username.to_string(), password.to_string()))
        .build();
    mailer.send(email).await?;

    Ok(())
}

async fn send_http(
    channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<()> {
    let rendered_request = render_http_request(channel, secret, payload)?;
    let client = Client::new();
    let mut request = match rendered_request.method.as_str() {
        "PUT" => client.put(&rendered_request.url),
        "PATCH" => client.patch(&rendered_request.url),
        _ => client.post(&rendered_request.url),
    };

    let has_content_type = rendered_request
        .headers
        .iter()
        .any(|(key, _)| key.eq_ignore_ascii_case(CONTENT_TYPE.as_str()));

    if !has_content_type {
        request = request.header(
            CONTENT_TYPE,
            match rendered_request.body_mode {
                HttpBodyMode::Json => "application/json",
                HttpBodyMode::Raw => "text/plain; charset=utf-8",
            },
        );
    }

    for (key, value) in rendered_request.headers {
        request = request.header(&key, &value);
    }

    request
        .body(rendered_request.body)
        .send()
        .await?
        .error_for_status()?;

    Ok(())
}

fn render_http_request(
    channel: &NotificationChannel,
    secret: Option<Value>,
    payload: &NormalizedNotification,
) -> Result<RenderedHttpRequest> {
    let variables = notification_variables(payload);
    let secret = secret.unwrap_or(Value::Null);

    let url_template = secret
        .get("url")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow!("missing custom HTTP url"))?;
    let url = render_raw_template(url_template, &variables)?;

    let method = channel
        .config
        .get("method")
        .and_then(Value::as_str)
        .map(|method| method.to_uppercase())
        .filter(|method| matches!(method.as_str(), "POST" | "PUT" | "PATCH"))
        .unwrap_or_else(|| "POST".to_string());
    let body_mode = match channel.config.get("bodyMode").and_then(Value::as_str) {
        Some("raw") => HttpBodyMode::Raw,
        _ => HttpBodyMode::Json,
    };
    let body_template = channel
        .config
        .get("bodyTemplate")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_HTTP_BODY_TEMPLATE);
    let headers = render_http_headers(channel.config.get("headers"), &variables)?;
    let body = match body_mode {
        HttpBodyMode::Json => {
            serde_json::to_string_pretty(&render_json_template(body_template, &variables)?)?
        }
        HttpBodyMode::Raw => render_raw_template(body_template, &variables)?,
    };

    Ok(RenderedHttpRequest {
        method,
        url,
        headers,
        body,
        body_mode,
    })
}

fn render_http_headers(
    headers: Option<&Value>,
    variables: &Map<String, Value>,
) -> Result<Vec<(String, String)>> {
    let Some(headers) = headers else {
        return Ok(Vec::new());
    };

    let Some(header_map) = headers.as_object() else {
        return Err(anyhow!("HTTP headers must be a JSON object"));
    };

    let mut rendered_headers = Vec::with_capacity(header_map.len());
    for (key, value) in header_map {
        let Some(header_value) = value.as_str() else {
            return Err(anyhow!("HTTP header {key} must use a string value"));
        };

        rendered_headers.push((key.clone(), render_raw_template(header_value, variables)?));
    }

    Ok(rendered_headers)
}

fn notification_variables(payload: &NormalizedNotification) -> Map<String, Value> {
    let mut variables = Map::new();
    variables.insert(
        "app".to_string(),
        Value::String("superpower-oss".to_string()),
    );
    variables.insert(
        "scriptId".to_string(),
        Value::String(payload.script_id.clone()),
    );
    variables.insert(
        "scriptName".to_string(),
        Value::String(payload.script_name.clone()),
    );
    variables.insert(
        "title".to_string(),
        payload
            .title
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    variables.insert(
        "message".to_string(),
        Value::String(payload.message.clone()),
    );
    variables.insert("level".to_string(), Value::String(payload.level.clone()));
    variables.insert(
        "triggerLabel".to_string(),
        Value::String(payload.trigger_label.clone()),
    );
    variables.insert(
        "timestamp".to_string(),
        Value::String(payload.timestamp.clone()),
    );
    variables.insert(
        "channel".to_string(),
        payload
            .channel
            .as_ref()
            .map(|value| Value::String(value.clone()))
            .unwrap_or(Value::Null),
    );
    variables.insert(
        "metadata".to_string(),
        payload.metadata.clone().unwrap_or(Value::Null),
    );
    variables
}

fn render_json_template(template: &str, variables: &Map<String, Value>) -> Result<Value> {
    let parsed_template = serde_json::from_str::<Value>(template)
        .map_err(|_| anyhow!("Body template must be valid JSON when JSON mode is selected"))?;
    render_json_value(parsed_template, variables)
}

fn render_json_value(value: Value, variables: &Map<String, Value>) -> Result<Value> {
    match value {
        Value::Array(entries) => Ok(Value::Array(
            entries
                .into_iter()
                .map(|entry| render_json_value(entry, variables))
                .collect::<Result<Vec<_>>>()?,
        )),
        Value::Object(entries) => Ok(Value::Object(
            entries
                .into_iter()
                .map(|(key, entry)| Ok((key, render_json_value(entry, variables)?)))
                .collect::<Result<Map<String, Value>>>()?,
        )),
        Value::String(string_value) => {
            if let Some(placeholder_key) = exact_placeholder(&string_value) {
                return Ok(variables.get(placeholder_key).cloned().ok_or_else(|| {
                    anyhow!("Unknown placeholder \"{{{{{placeholder_key}}}}}\"")
                })?);
            }

            Ok(Value::String(render_raw_template(
                &string_value,
                variables,
            )?))
        }
        other => Ok(other),
    }
}

fn render_raw_template(template: &str, variables: &Map<String, Value>) -> Result<String> {
    let mut rendered = String::new();
    let mut remaining = template;

    while let Some(start) = remaining.find("{{") {
        rendered.push_str(&remaining[..start]);
        let after_open = &remaining[start + 2..];
        let Some(end) = after_open.find("}}") else {
            return Err(anyhow!("Unterminated placeholder in template"));
        };
        let key = after_open[..end].trim();
        if key.is_empty() {
            return Err(anyhow!("Empty placeholder in template"));
        }

        let value = variables
            .get(key)
            .ok_or_else(|| anyhow!("Unknown placeholder \"{{{{{key}}}}}\""))?;
        rendered.push_str(&stringify_template_value(value));
        remaining = &after_open[end + 2..];
    }

    rendered.push_str(remaining);
    Ok(rendered)
}

fn exact_placeholder(value: &str) -> Option<&str> {
    if !value.starts_with("{{") || !value.ends_with("}}") {
        return None;
    }

    let key = value[2..value.len() - 2].trim();
    if key.is_empty() || key.contains('{') || key.contains('}') {
        return None;
    }

    Some(key)
}

fn stringify_template_value(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_notification() -> NormalizedNotification {
        NormalizedNotification {
            title: Some("Superpower OSS test".to_string()),
            message: "Test notification from Superpower OSS".to_string(),
            level: "info".to_string(),
            script_name: "Settings".to_string(),
            script_id: "settings".to_string(),
            trigger_label: "Manual test".to_string(),
            timestamp: "2026-04-23T12:00:00.000Z".to_string(),
            channel: None,
            metadata: Some(json!({ "attempt": 1 })),
        }
    }

    fn sample_http_channel(config: Value) -> NotificationChannel {
        NotificationChannel {
            id: "channel-1".to_string(),
            kind: NotificationChannelKind::Http,
            name: "Webhook".to_string(),
            enabled: true,
            config,
            has_secret: true,
            created_at: "2026-04-23T12:00:00.000Z".to_string(),
            updated_at: "2026-04-23T12:00:00.000Z".to_string(),
        }
    }

    #[test]
    fn renders_json_templates_with_typed_placeholders() {
        let rendered = render_json_template(
            r#"{"message":"{{message}}","metadata":"{{metadata}}","channel":"{{channel}}"}"#,
            &notification_variables(&sample_notification()),
        )
        .expect("json template should render");

        assert_eq!(
            rendered["message"],
            Value::String("Test notification from Superpower OSS".to_string())
        );
        assert_eq!(rendered["metadata"], json!({ "attempt": 1 }));
        assert_eq!(rendered["channel"], Value::Null);
    }

    #[test]
    fn renders_raw_templates_with_stringified_values() {
        let rendered = render_raw_template(
            "POST {{scriptName}} {{metadata}}",
            &notification_variables(&sample_notification()),
        )
        .expect("raw template should render");

        assert_eq!(rendered, r#"POST Settings {"attempt":1}"#);
    }

    #[test]
    fn legacy_http_channels_keep_the_generic_payload_shape() {
        let rendered = render_http_request(
            &sample_http_channel(json!({ "method": "POST" })),
            Some(json!({ "url": "https://example.com/hook" })),
            &sample_notification(),
        )
        .expect("legacy http channel should render");

        assert_eq!(rendered.method, "POST");
        assert_eq!(rendered.url, "https://example.com/hook");
        assert_eq!(rendered.body_mode, HttpBodyMode::Json);
        assert!(rendered.body.contains(r#""scriptId": "settings""#));
        assert!(rendered.body.contains(r#""metadata": {"#));
    }

    #[test]
    fn custom_headers_override_default_content_type() {
        let rendered = render_http_request(
            &sample_http_channel(json!({
                "method": "PATCH",
                "headers": {
                    "Content-Type": "application/vnd.api+json",
                    "X-Script": "{{scriptName}}"
                },
                "bodyMode": "raw",
                "bodyTemplate": "{{message}}"
            })),
            Some(json!({ "url": "https://example.com/{{scriptId}}" })),
            &sample_notification(),
        )
        .expect("custom request should render");

        assert_eq!(rendered.method, "PATCH");
        assert_eq!(rendered.url, "https://example.com/settings");
        assert_eq!(rendered.body, "Test notification from Superpower OSS");
        assert_eq!(rendered.body_mode, HttpBodyMode::Raw);
        assert_eq!(
            rendered.headers,
            vec![
                (
                    "Content-Type".to_string(),
                    "application/vnd.api+json".to_string()
                ),
                ("X-Script".to_string(), "Settings".to_string()),
            ]
        );
    }
}

import type {
  HttpBodyMode,
  HttpConfig,
  HttpMethod,
  HttpSecret,
  NotificationPreviewPayload,
  NotificationSecretRecord,
  WebhookSecret,
} from "../../types/api";

export const HTTP_PREVIEW_TIMESTAMP = "2026-04-23T12:00:00.000Z";

export const HTTP_PREVIEW_PAYLOAD: NotificationPreviewPayload = {
  app: "superpower-oss",
  scriptId: "settings",
  scriptName: "Settings",
  title: "Superpower OSS test",
  message: "Test notification from Superpower OSS",
  level: "info",
  triggerLabel: "Manual test",
  timestamp: HTTP_PREVIEW_TIMESTAMP,
  channel: null,
  metadata: null,
};

export const DEFAULT_HTTP_BODY_TEMPLATE = `{
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
}`;

export const HTTP_TEMPLATE_PRESETS = [
  {
    id: "generic-json",
    label: "Generic JSON webhook",
    bodyMode: "json" as const,
    template: DEFAULT_HTTP_BODY_TEMPLATE,
  },
  {
    id: "slack-style",
    label: "Slack-style webhook payload",
    bodyMode: "json" as const,
    template: `{
  "text": "[{{level}}] {{scriptName}}: {{message}}",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*{{scriptName}}*\\n{{message}}"
      }
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "Trigger: {{triggerLabel}}"
        },
        {
          "type": "mrkdwn",
          "text": "Level: {{level}}"
        }
      ]
    }
  ]
}`,
  },
  {
    id: "discord-style",
    label: "Discord-style webhook payload",
    bodyMode: "json" as const,
    template: `{
  "content": "**{{scriptName}}**\\n{{message}}\\nTrigger: {{triggerLabel}}"
}`,
  },
];

export const HTTP_VARIABLES = [
  { key: "app", description: "The app identifier for outbound notifications." },
  { key: "scriptId", description: "The unique ID of the script that emitted the notification." },
  { key: "scriptName", description: "The display name of the script." },
  { key: "title", description: "Optional notification title, or null if absent." },
  { key: "message", description: "The main notification message." },
  { key: "level", description: "Notification level such as info, success, warn, or error." },
  { key: "triggerLabel", description: "Human-readable trigger label for the run." },
  { key: "timestamp", description: "ISO timestamp for the notification send time." },
  { key: "channel", description: "Optional channel override, or null when not set." },
  { key: "metadata", description: "Optional structured metadata from the notification payload." },
].map((variable) => ({
  ...variable,
  token: `{{${variable.key}}}`,
}));

const PLACEHOLDER_PATTERN = /^{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}$/;

export type RenderedHttpRequestPreview = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  bodyMode: HttpBodyMode;
  renderedBody: string;
  errors: string[];
};

export function getSecretRecord(secret: NotificationSecretRecord): Record<string, unknown> {
  return secret && typeof secret === "object" && !Array.isArray(secret) ? { ...secret } : {};
}

export function getWebhookUrl(secret: NotificationSecretRecord): string {
  return typeof getSecretRecord(secret).webhookUrl === "string" ? String(getSecretRecord(secret).webhookUrl) : "";
}

export function withWebhookUrl(secret: NotificationSecretRecord, webhookUrl: string): WebhookSecret {
  const nextSecret = getSecretRecord(secret);

  if (webhookUrl.trim()) {
    nextSecret.webhookUrl = webhookUrl;
  } else {
    delete nextSecret.webhookUrl;
  }

  return nextSecret;
}

export function getHttpUrl(secret: NotificationSecretRecord): string {
  return typeof getSecretRecord(secret).url === "string" ? String(getSecretRecord(secret).url) : "";
}

export function withHttpUrl(secret: NotificationSecretRecord, url: string): HttpSecret {
  const nextSecret = getSecretRecord(secret);

  if (url.trim()) {
    nextSecret.url = url;
  } else {
    delete nextSecret.url;
  }

  return nextSecret;
}

export function getHttpConfig(config: Record<string, unknown>): Required<HttpConfig> {
  const rawMethod = typeof config.method === "string" ? config.method.toUpperCase() : "POST";
  const method: HttpMethod = rawMethod === "PUT" || rawMethod === "PATCH" ? rawMethod : "POST";
  const bodyMode: HttpBodyMode = config.bodyMode === "raw" ? "raw" : "json";
  const bodyTemplate = typeof config.bodyTemplate === "string" && config.bodyTemplate.trim()
    ? config.bodyTemplate
    : DEFAULT_HTTP_BODY_TEMPLATE;

  return {
    method,
    headers: getHeaderRecord(config.headers),
    bodyMode,
    bodyTemplate,
  };
}

export function getHeaderRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const headerEntries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === "string");
  return Object.fromEntries(headerEntries);
}

export function validateHeaderRecord(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return ["Headers must be a JSON object."];
  }

  for (const [key, headerValue] of Object.entries(value)) {
    if (typeof headerValue !== "string") {
      return [`Header "${key}" must use a string value.`];
    }
  }

  return [];
}

export function renderHttpRequestPreview({
  config,
  secret,
  payload = HTTP_PREVIEW_PAYLOAD,
}: {
  config: Record<string, unknown>;
  secret: NotificationSecretRecord;
  payload?: NotificationPreviewPayload;
}): RenderedHttpRequestPreview {
  const resolvedConfig = getHttpConfig(config);
  const errors: string[] = [];
  const headerValidationErrors = validateHeaderRecord(config.headers ?? resolvedConfig.headers);

  if (headerValidationErrors.length > 0) {
    errors.push(...headerValidationErrors);
  }

  let url = getHttpUrl(secret).trim();
  if (!url) {
    errors.push("Endpoint URL is required.");
  } else {
    try {
      url = renderRawTemplate(url, payload);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unable to render endpoint URL.");
    }
  }

  const renderedHeaders: Record<string, string> = {};
  for (const [key, headerValue] of Object.entries(resolvedConfig.headers)) {
    try {
      renderedHeaders[key] = renderRawTemplate(headerValue, payload);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : `Unable to render header "${key}".`);
    }
  }

  let renderedBody = "";
  if (!resolvedConfig.bodyTemplate.trim()) {
    errors.push("Body template is required.");
  } else if (resolvedConfig.bodyMode === "json") {
    try {
      renderedBody = JSON.stringify(renderJsonTemplate(resolvedConfig.bodyTemplate, payload), null, 2);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unable to render JSON body template.");
    }
  } else {
    try {
      renderedBody = renderRawTemplate(resolvedConfig.bodyTemplate, payload);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Unable to render raw body template.");
    }
  }

  return {
    method: resolvedConfig.method,
    url,
    headers: renderedHeaders,
    bodyMode: resolvedConfig.bodyMode,
    renderedBody,
    errors,
  };
}

export function renderRawTemplate(template: string, payload: NotificationPreviewPayload): string {
  return template.replace(/{{\s*([a-zA-Z][a-zA-Z0-9]*)\s*}}/g, (_, key: string) => {
    const value = payload[key as keyof NotificationPreviewPayload];
    if (value === undefined) {
      throw new Error(`Unknown placeholder "{{${key}}}".`);
    }

    return stringifyTemplateValue(value);
  });
}

export function renderJsonTemplate(template: string, payload: NotificationPreviewPayload): unknown {
  let parsedTemplate: unknown;

  try {
    parsedTemplate = JSON.parse(template);
  } catch {
    throw new Error("Body template must be valid JSON when JSON mode is selected.");
  }

  return renderJsonValue(parsedTemplate, payload);
}

function renderJsonValue(value: unknown, payload: NotificationPreviewPayload): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => renderJsonValue(entry, payload));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, renderJsonValue(entryValue, payload)]),
    );
  }

  if (typeof value !== "string") {
    return value;
  }

  const placeholderMatch = value.match(PLACEHOLDER_PATTERN);
  if (placeholderMatch) {
    const placeholderKey = placeholderMatch[1] as keyof NotificationPreviewPayload;
    if (!(placeholderKey in payload)) {
      throw new Error(`Unknown placeholder "{{${placeholderKey}}}".`);
    }

    return structuredClone(payload[placeholderKey]);
  }

  return renderRawTemplate(value, payload);
}

function stringifyTemplateValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

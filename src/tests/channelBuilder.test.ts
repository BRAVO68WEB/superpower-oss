import { describe, expect, it } from "vitest";

import {
  DEFAULT_HTTP_BODY_TEMPLATE,
  getHttpConfig,
  getWebhookUrl,
  renderHttpRequestPreview,
  renderJsonTemplate,
  renderRawTemplate,
  withWebhookUrl,
} from "../features/settings/channelBuilder";

describe("channelBuilder", () => {
  it("hydrates and preserves webhook secrets", () => {
    const secret = withWebhookUrl({ signingSecret: "keep-me" }, "https://hooks.slack.com/services/demo");

    expect(getWebhookUrl(secret)).toBe("https://hooks.slack.com/services/demo");
    expect(secret).toMatchObject({
      webhookUrl: "https://hooks.slack.com/services/demo",
      signingSecret: "keep-me",
    });
  });

  it("renders JSON templates with typed placeholder values", () => {
    const rendered = renderJsonTemplate(
      '{"message":"{{message}}","metadata":"{{metadata}}","channel":"{{channel}}"}',
      {
        app: "superpower-oss",
        scriptId: "settings",
        scriptName: "Settings",
        title: "Superpower OSS test",
        message: "Test notification from Superpower OSS",
        level: "info",
        triggerLabel: "Manual test",
        timestamp: "2026-04-23T12:00:00.000Z",
        channel: null,
        metadata: { attempt: 1 },
      },
    );

    expect(rendered).toEqual({
      message: "Test notification from Superpower OSS",
      metadata: { attempt: 1 },
      channel: null,
    });
  });

  it("renders raw templates with stringified structured values", () => {
    const rendered = renderRawTemplate("{{scriptName}} {{metadata}}", {
      app: "superpower-oss",
      scriptId: "settings",
      scriptName: "Settings",
      title: "Superpower OSS test",
      message: "Test notification from Superpower OSS",
      level: "info",
      triggerLabel: "Manual test",
      timestamp: "2026-04-23T12:00:00.000Z",
      channel: null,
      metadata: { attempt: 1 },
    });

    expect(rendered).toBe('Settings {"attempt":1}');
  });

  it("hydrates legacy HTTP channels to the generic payload template", () => {
    const config = getHttpConfig({ method: "POST" });
    const preview = renderHttpRequestPreview({
      config: { method: "POST" },
      secret: { url: "https://example.com/hooks" },
    });

    expect(config.bodyTemplate).toBe(DEFAULT_HTTP_BODY_TEMPLATE);
    expect(preview.errors).toEqual([]);
    expect(preview.renderedBody).toContain('"scriptId": "settings"');
    expect(preview.renderedBody).toContain('"metadata": null');
  });

  it("reports invalid header values and blocks preview rendering", () => {
    const preview = renderHttpRequestPreview({
      config: {
        method: "POST",
        headers: {
          Authorization: 123,
        },
      },
      secret: { url: "https://example.com/hooks" },
    });

    expect(preview.errors).toContain('Header "Authorization" must use a string value.');
  });
});

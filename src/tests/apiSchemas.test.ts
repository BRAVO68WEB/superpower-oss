import { describe, expect, it } from "vitest";

import { exampleTemplates } from "../features/scripts/examples";
import { notificationChannelInputSchema, scriptInputSchema } from "../types/api";

describe("scriptInputSchema", () => {
  it("accepts every built-in example template", () => {
    for (const template of exampleTemplates) {
      expect(() => scriptInputSchema.parse(template.script)).not.toThrow();
    }
  });

  it("uses the updated safe demo payload logic for built-in monitor examples", () => {
    const uptimeTemplate = exampleTemplates.find((template) => template.title === "Website Uptime Alert");
    const failedJobTemplate = exampleTemplates.find((template) => template.title === "Failed Job Webhook Relay");

    expect(uptimeTemplate?.script.triggers[0]?.config.url).toBe("https://dns.google");
    expect(uptimeTemplate?.script.code).toContain('const manualPreviewUrl = "https://dns.google"');
    expect(uptimeTemplate?.script.code).toContain("await fetch(manualPreviewUrl)");

    expect(failedJobTemplate?.script.triggers[0]?.config.url).toBe("https://jsonplaceholder.typicode.com/todos/1");
    expect(failedJobTemplate?.script.code).toContain("Manual runs do not include API poll payloads");
  });
});

describe("notificationChannelInputSchema", () => {
  it("accepts an SMTP configuration payload", () => {
    const payload = notificationChannelInputSchema.parse({
      kind: "smtp",
      name: "Ops inbox",
      enabled: true,
      config: {
        host: "smtp.example.com",
        port: 587,
        from: "alerts@example.com",
        to: "ops@example.com",
        username: "alerts@example.com",
        subjectPrefix: "[OPS]",
      },
      secret: {
        password: "super-secret",
      },
    });

    expect(payload.kind).toBe("smtp");
    expect(payload.secret).toMatchObject({ password: "super-secret" });
  });

  it("accepts an HTTP channel payload with preview builder config", () => {
    const payload = notificationChannelInputSchema.parse({
      kind: "http",
      name: "Custom webhook",
      enabled: true,
      config: {
        method: "PATCH",
        headers: {
          Authorization: "Bearer {{metadata}}",
        },
        bodyMode: "raw",
        bodyTemplate: "{{scriptName}} => {{message}}",
      },
      secret: {
        url: "https://example.com/hooks/{{scriptId}}",
      },
    });

    expect(payload.kind).toBe("http");
    expect(payload.config).toMatchObject({
      method: "PATCH",
      bodyMode: "raw",
    });
    expect(payload.secret).toMatchObject({ url: "https://example.com/hooks/{{scriptId}}" });
  });
});

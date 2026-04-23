import type { ScriptInput } from "../../types/api";

const defaultPolicy = {
  notifyOnFailure: false,
  notifyOnSuccess: false,
  maxRunSeconds: null,
} as const;

export const exampleTemplates: Array<{
  title: string;
  description: string;
  summary: string;
  script: ScriptInput;
}> = [
  {
    title: "Daily Revenue Digest",
    description: "Fetch revenue metrics every weekday morning and notify all configured channels.",
    summary: "Weekday alert template with cron scheduling and notification output.",
    script: {
      name: "Daily Revenue Digest",
      description: "Send the latest business metrics every weekday at 08:00.",
      enabled: true,
      manualRunEnabled: true,
      code: `const stats = await fetch("https://api.yourapp.com/stats/today").then((r) => r.json());

await notify({
  title: "Revenue digest",
  level: "info",
  channel: "#metrics",
  message: \`Revenue today: \${stats.revenue} · Active: \${stats.dau}\`,
});`,
      triggers: [
        {
          kind: "cron",
          enabled: true,
          config: {
            label: "Weekdays at 08:00",
            cron: "0 8 * * 1-5",
          },
        },
      ],
      policy: { ...defaultPolicy, notifyOnFailure: true },
    },
  },
  {
    title: "Bitcoin Price Logger",
    description: "Poll the Coinbase spot price and store it in execution logs only.",
    summary: "Logging-only example without notifications.",
    script: {
      name: "Bitcoin Price Logger",
      description: "Log the current BTC price every 15 minutes.",
      enabled: true,
      manualRunEnabled: true,
      code: `const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot");
const { data } = await res.json();

console.log(\`BTC: $\${data.amount}\`);`,
      triggers: [
        {
          kind: "cron",
          enabled: true,
          config: {
            label: "Every 15 minutes",
            cron: "*/15 * * * *",
          },
        },
      ],
      policy: { ...defaultPolicy },
    },
  },
  {
    title: "Website Uptime Alert",
    description: "Check a public site every minute and notify on unhealthy responses.",
    summary: "Healthy uptime demo using a public URL; manual runs perform a live health check preview.",
    script: {
      name: "Website Uptime Alert",
      description: "Monitor a public endpoint and notify when it stops returning a healthy response.",
      enabled: true,
      manualRunEnabled: true,
      code: `const manualPreviewUrl = "https://dns.google";
const payload = runContext.payload as { status?: number; ok?: boolean; url?: string } | null;

const preview = payload ?? await fetch(manualPreviewUrl)
  .then(async (response) => ({
    url: manualPreviewUrl,
    status: response.status,
    ok: response.ok,
  }))
  .catch((error) => ({
    url: manualPreviewUrl,
    status: 0,
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }));

if (!preview.ok) {
  await notify({
    title: "Website issue",
    level: "error",
    message: preview.status
      ? \`\${preview.url} returned status \${preview.status}\`
      : \`Manual uptime preview failed for \${preview.url}\${"error" in preview ? \`: \${preview.error}\` : ""}\`,
  });
} else {
  console.log(\`Uptime OK for \${preview.url} (\${preview.status})\`);
}`,
      triggers: [
        {
          kind: "uptime",
          enabled: true,
          config: {
            name: "Homepage health",
            url: "https://dns.google",
            method: "GET",
            intervalSeconds: 60,
            timeoutSeconds: 15,
          },
        },
      ],
      policy: { ...defaultPolicy, notifyOnFailure: true },
    },
  },
  {
    title: "File Change Watcher",
    description: "Watch a folder and notify whenever files change.",
    summary: "File watcher trigger with debounce-aware payload inspection.",
    script: {
      name: "File Change Watcher",
      description: "Track content changes inside a workspace folder.",
      enabled: true,
      manualRunEnabled: true,
      code: `const payload = runContext.payload as { kind?: string; paths?: string[] } | null;

if (!payload) {
  console.log("Manual runs do not include file watch payloads. Wait for the watcher trigger to fire.");
} else {
  await notify({
    title: "Files changed",
    level: "warn",
    message: \`\${payload.kind ?? "change"}: \${(payload.paths ?? []).join(", ")}\`,
  });
}`,
      triggers: [
        {
          kind: "file_watch",
          enabled: true,
          config: {
            name: "Workspace watcher",
            path: ".",
            recursive: true,
            debounceMs: 1200,
            eventTypes: ["modify", "create", "delete"],
          },
        },
      ],
      policy: { ...defaultPolicy },
    },
  },
  {
    title: "API Threshold Alert",
    description: "Poll an API and alert when a numeric threshold is crossed.",
    summary: "API polling example using structured monitor payloads.",
    script: {
      name: "API Threshold Alert",
      description: "Monitor an API endpoint for threshold violations.",
      enabled: true,
      manualRunEnabled: true,
      code: `const payload = runContext.payload as { json?: { queueDepth?: number } } | null;

if (!payload) {
  console.log("Manual runs do not include API poll payloads. Wait for the trigger to run or point the URL at your own endpoint.");
} else {
  const queueDepth = payload.json?.queueDepth ?? 0;

  if (queueDepth > 50) {
    await notify({
      title: "Queue depth warning",
      level: "warn",
      message: \`Queue depth reached \${queueDepth}\`,
    });
  } else {
    console.log(\`Queue depth stable: \${queueDepth}\`);
  }
}`,
      triggers: [
        {
          kind: "api_poll",
          enabled: true,
          config: {
            name: "Queue depth poller",
            url: "https://example.com/api/queue",
            method: "GET",
            intervalSeconds: 120,
            timeoutSeconds: 20,
            headers: {},
            body: null,
          },
        },
      ],
      policy: { ...defaultPolicy },
    },
  },
  {
    title: "Disk Space Warning",
    description: "Log a disk check every hour and alert when space is low.",
    summary: "Simple recurring maintenance script with console output and notify.",
    script: {
      name: "Disk Space Warning",
      description: "Run a system disk inspection every hour.",
      enabled: true,
      manualRunEnabled: true,
      code: `const usage = 84;

console.log(\`Disk usage: \${usage}%\`);

if (usage > 80) {
  await notify({
    title: "Disk warning",
    level: "warn",
    message: \`Disk usage is \${usage}%\`,
  });
}`,
      triggers: [
        {
          kind: "cron",
          enabled: true,
          config: {
            label: "Hourly",
            cron: "0 * * * *",
          },
        },
      ],
      policy: { ...defaultPolicy },
    },
  },
  {
    title: "Weekday Standup Reminder",
    description: "Post a reminder every weekday morning.",
    summary: "Basic cron reminder template.",
    script: {
      name: "Weekday Standup Reminder",
      description: "Send a reminder before the team standup.",
      enabled: true,
      manualRunEnabled: true,
      code: `await notify({
  title: "Standup reminder",
  message: "Standup starts in 10 minutes. Bring blockers and wins.",
});`,
      triggers: [
        {
          kind: "cron",
          enabled: true,
          config: {
            label: "Weekdays at 09:50",
            cron: "50 9 * * 1-5",
          },
        },
      ],
      policy: { ...defaultPolicy },
    },
  },
  {
    title: "Failed Job Webhook Relay",
    description: "Poll a sample JSON endpoint and relay a failed-job style notification.",
    summary: "Out-of-box API poll demo that simulates failed-job alerts from a stable public payload.",
    script: {
      name: "Failed Job Webhook Relay",
      description: "Check a sample JSON endpoint and relay a failed-job style result.",
      enabled: true,
      manualRunEnabled: true,
      code: `const payload = runContext.payload as { json?: { id?: number; title?: string; completed?: boolean } } | null;

if (!payload) {
  console.log("Manual runs do not include API poll payloads. Wait for the trigger to run to see the demo payload.");
} else {
  const failedJob = payload.json && payload.json.completed === false
    ? { id: payload.json.id ?? "unknown", name: payload.json.title ?? "Untitled job" }
    : null;

  if (failedJob) {
    await notify({
      title: "Job failure detected",
      level: "error",
      message: \`Job \${failedJob.name} (\${failedJob.id}) failed\`,
    });
  } else {
    console.log("No failed job was detected in the sample payload");
  }
}`,
      triggers: [
        {
          kind: "api_poll",
          enabled: true,
          config: {
            name: "Failed jobs poller",
            url: "https://jsonplaceholder.typicode.com/todos/1",
            method: "GET",
            intervalSeconds: 300,
            timeoutSeconds: 20,
            headers: {},
            body: null,
          },
        },
      ],
      policy: { ...defaultPolicy, notifyOnFailure: true },
    },
  },
];

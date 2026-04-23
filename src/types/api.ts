import { z } from "zod";

export const triggerKindSchema = z.enum(["cron", "uptime", "file_watch", "api_poll"]);
export const runTriggerKindSchema = z.enum(["manual", "cron", "uptime", "file_watch", "api_poll"]);
export const runStatusSchema = z.enum([
  "queued",
  "running",
  "success",
  "failure",
  "skipped",
  "canceled",
]);
export const runLogStreamSchema = z.enum(["stdout", "stderr", "event"]);
export const notificationChannelKindSchema = z.enum(["slack", "discord", "native", "smtp", "http"]);
export const httpMethodSchema = z.enum(["POST", "PUT", "PATCH"]);
export const httpBodyModeSchema = z.enum(["json", "raw"]);

export const triggerDefinitionSchema = z.object({
  id: z.string().optional(),
  kind: triggerKindSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
});

export const scriptPolicySchema = z.object({
  notifyOnFailure: z.boolean(),
  notifyOnSuccess: z.boolean(),
  maxRunSeconds: z.number().int().nullable().optional().transform((value) => value ?? null),
});

export const scriptSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  enabled: z.boolean(),
  manualRunEnabled: z.boolean(),
  lastRunAt: z.string().nullable(),
  updatedAt: z.string(),
  triggerCount: z.number(),
});

export const scriptDetailSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  code: z.string(),
  enabled: z.boolean(),
  manualRunEnabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastRunAt: z.string().nullable(),
  triggers: z.array(triggerDefinitionSchema),
  policy: scriptPolicySchema,
});

export const scriptInputSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  code: z.string().min(1),
  enabled: z.boolean(),
  manualRunEnabled: z.boolean(),
  triggers: z.array(triggerDefinitionSchema),
  policy: scriptPolicySchema,
});

export const runSummarySchema = z.object({
  id: z.string(),
  scriptId: z.string(),
  scriptName: z.string(),
  triggerKind: runTriggerKindSchema,
  triggerLabel: z.string(),
  status: runStatusSchema,
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  exitCode: z.number().nullable(),
  errorSummary: z.string().nullable(),
  coalescedCount: z.number(),
});

export const runLogLineSchema = z.object({
  id: z.number(),
  runId: z.string(),
  stream: runLogStreamSchema,
  lineNo: z.number(),
  content: z.string(),
  createdAt: z.string(),
});

export const runDetailSchema = z.object({
  run: runSummarySchema,
  logs: z.array(runLogLineSchema),
});

export const notificationChannelSchema = z.object({
  id: z.string(),
  kind: notificationChannelKindSchema,
  name: z.string(),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  hasSecret: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const notificationChannelInputSchema = z.object({
  id: z.string().optional(),
  kind: notificationChannelKindSchema,
  name: z.string().min(1),
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()),
  secret: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const runtimeHealthSchema = z.object({
  bunPath: z.string().nullable(),
  bunVersion: z.string().nullable(),
  bundledBunAvailable: z.boolean(),
  schedulerPaused: z.boolean(),
  dbPath: z.string(),
  appVersion: z.string(),
  updatesConfigured: z.boolean(),
});

export const schedulerStateSchema = z.object({
  paused: z.boolean(),
  activeRuns: z.number(),
});

export const exportResultSchema = z.object({
  path: z.string(),
  scriptCount: z.number(),
});

export const notificationChannelRefSchema = z.object({
  kind: notificationChannelKindSchema,
  name: z.string(),
  hasSecret: z.boolean(),
});

export const importPreviewSchema = z.object({
  previewId: z.string(),
  scripts: z.array(scriptInputSchema),
  notificationChannelRefs: z.array(notificationChannelRefSchema),
});

export const importResultSchema = z.object({
  importedScriptIds: z.array(z.string()),
  createdNotificationChannelIds: z.array(z.string()),
});

export const runEventPayloadSchema = z.object({
  run: runSummarySchema,
});

export const runLogEventPayloadSchema = z.object({
  runId: z.string(),
  log: runLogLineSchema,
});

export const updateChannelSchema = z.enum(["stable", "beta"]);
export const updateSummarySchema = z.object({
  version: z.string(),
  currentVersion: z.string(),
  notes: z.string().nullable(),
  pubDate: z.string().nullable(),
  channel: updateChannelSchema,
});

export const updateConfigurationSchema = z.object({
  appVersion: z.string(),
  updatesConfigured: z.boolean(),
});

export type TriggerKind = z.infer<typeof triggerKindSchema>;
export type TriggerDefinition = z.infer<typeof triggerDefinitionSchema>;
export type ScriptPolicy = z.infer<typeof scriptPolicySchema>;
export type ScriptSummary = z.infer<typeof scriptSummarySchema>;
export type ScriptDetail = z.infer<typeof scriptDetailSchema>;
export type ScriptInput = z.infer<typeof scriptInputSchema>;
export type RunSummary = z.infer<typeof runSummarySchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type RunLogLine = z.infer<typeof runLogLineSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationChannelInput = z.infer<typeof notificationChannelInputSchema>;
export type RuntimeHealth = z.infer<typeof runtimeHealthSchema>;
export type SchedulerState = z.infer<typeof schedulerStateSchema>;
export type ExportResult = z.infer<typeof exportResultSchema>;
export type NotificationChannelRef = z.infer<typeof notificationChannelRefSchema>;
export type ImportPreview = z.infer<typeof importPreviewSchema>;
export type ImportResult = z.infer<typeof importResultSchema>;
export type RunEventPayload = z.infer<typeof runEventPayloadSchema>;
export type RunLogEventPayload = z.infer<typeof runLogEventPayloadSchema>;
export type HttpMethod = z.infer<typeof httpMethodSchema>;
export type HttpBodyMode = z.infer<typeof httpBodyModeSchema>;
export type UpdateChannel = z.infer<typeof updateChannelSchema>;
export type UpdateSummary = z.infer<typeof updateSummarySchema>;
export type UpdateConfiguration = z.infer<typeof updateConfigurationSchema>;
export type UpdateCheckState = "idle" | "checking" | "available" | "none" | "installing" | "error";
export type NotificationSecretRecord = Record<string, unknown> | null | undefined;
export type WebhookSecret = Record<string, unknown> & { webhookUrl?: string };
export type HttpSecret = Record<string, unknown> & { url?: string };
export type HttpConfig = {
  method?: HttpMethod;
  headers?: Record<string, string>;
  bodyMode?: HttpBodyMode;
  bodyTemplate?: string;
};
export type NotificationPreviewPayload = {
  app: string;
  scriptId: string;
  scriptName: string;
  title: string | null;
  message: string;
  level: string;
  triggerLabel: string;
  timestamp: string;
  channel: string | null;
  metadata: unknown;
};

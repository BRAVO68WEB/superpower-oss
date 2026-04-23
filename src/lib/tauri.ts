import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import {
  exportResultSchema,
  importPreviewSchema,
  importResultSchema,
  notificationChannelInputSchema,
  notificationChannelSchema,
  runDetailSchema,
  runEventPayloadSchema,
  runLogEventPayloadSchema,
  runLogLineSchema,
  runSummarySchema,
  runtimeHealthSchema,
  schedulerStateSchema,
  scriptDetailSchema,
  scriptInputSchema,
  scriptSummarySchema,
  type ImportPreview,
  type NotificationChannelInput,
  type RunEventPayload,
  type RunLogEventPayload,
  type SchedulerState,
  type ScriptInput,
  type UpdateChannel,
} from "../types/api";
import { z } from "zod";
import { updateConfigurationSchema, updateSummarySchema } from "../types/api";

async function call<T>(command: string, args: Record<string, unknown>, schema: { parse: (value: unknown) => T }) {
  const value = await invoke(command, args);
  return schema.parse(value);
}

export function isTauriAvailable() {
  if (typeof window === "undefined") {
    return false;
  }

  const candidate = window as unknown as { __TAURI__?: unknown };
  return Boolean(candidate.__TAURI__);
}

export const api = {
  listScripts: () => call("list_scripts", {}, { parse: (value) => scriptSummarySchema.array().parse(value) }),
  getScript: (scriptId: string) => call("get_script", { scriptId }, scriptDetailSchema),
  createScript: (input: ScriptInput) => call("create_script", { input: scriptInputSchema.parse(input) }, scriptDetailSchema),
  updateScript: (scriptId: string, input: ScriptInput) =>
    call("update_script", { scriptId, input: scriptInputSchema.parse(input) }, scriptDetailSchema),
  deleteScript: async (scriptId: string) => {
    await invoke("delete_script", { scriptId });
  },
  duplicateScript: (scriptId: string) => call("duplicate_script", { scriptId }, scriptDetailSchema),
  runScriptNow: (scriptId: string) => call("run_script_now", { scriptId }, runSummarySchema),
  setScriptEnabled: (scriptId: string, enabled: boolean) =>
    call("set_script_enabled", { scriptId, enabled }, scriptSummarySchema),
  listRuns: () => call("list_runs", { filter: null }, { parse: (value) => runSummarySchema.array().parse(value) }),
  getRun: (runId: string) => call("get_run", { runId }, runDetailSchema),
  getRunLogs: (runId: string) => call("get_run_logs", { runId }, { parse: (value) => runLogLineSchema.array().parse(value) }),
  listNotificationChannels: () =>
    call("list_notification_channels", {}, { parse: (value) => notificationChannelSchema.array().parse(value) }),
  getNotificationChannelSecret: (channelId: string) =>
    call(
      "get_notification_channel_secret",
      { channelId },
      { parse: (value) => z.record(z.string(), z.unknown()).nullable().parse(value) },
    ),
  upsertNotificationChannel: (input: NotificationChannelInput) =>
    call(
      "upsert_notification_channel",
      { input: notificationChannelInputSchema.parse(input) },
      notificationChannelSchema,
    ),
  deleteNotificationChannel: async (channelId: string) => {
    await invoke("delete_notification_channel", { channelId });
  },
  sendTestNotification: async (channelId: string) => {
    await invoke("send_test_notification", { channelId });
  },
  getRuntimeHealth: () => call("get_runtime_health", {}, runtimeHealthSchema),
  getUpdateConfiguration: () => call("get_update_configuration", {}, updateConfigurationSchema),
  checkForUpdates: (channel: UpdateChannel) =>
    call("check_for_updates", { channel }, { parse: (value) => updateSummarySchema.nullable().parse(value) }),
  installUpdate: (channel: UpdateChannel) =>
    call("install_update", { channel }, { parse: (value) => updateSummarySchema.nullable().parse(value) }),
  setPauseScheduling: (paused: boolean) => call("set_pause_scheduling", { paused }, schedulerStateSchema),
  exportScripts: (scriptIds: string[], destinationPath: string) =>
    call("export_scripts", { scriptIds, destinationPath }, exportResultSchema),
  importScripts: (sourcePath: string) => call("import_scripts", { sourcePath }, importPreviewSchema),
  confirmImport: (previewId: string) => call("confirm_import", { previewId }, importResultSchema),
  onRunStarted: (handler: (payload: RunEventPayload) => void) =>
    eventListener("run:started", runEventPayloadSchema, handler),
  onRunLog: (handler: (payload: RunLogEventPayload) => void) =>
    eventListener("run:log", runLogEventPayloadSchema, handler),
  onRunFinished: (handler: (payload: RunEventPayload) => void) =>
    eventListener("run:finished", runEventPayloadSchema, handler),
  onSchedulerStateChanged: (handler: (payload: SchedulerState) => void) =>
    eventListener("scheduler:state_changed", schedulerStateSchema, handler),
};

async function eventListener<T>(
  event: string,
  schema: { parse: (value: unknown) => T },
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauriAvailable()) {
    return () => {};
  }

  return listen(event, (payload) => {
    handler(schema.parse(payload.payload));
  });
}

export type { ImportPreview };

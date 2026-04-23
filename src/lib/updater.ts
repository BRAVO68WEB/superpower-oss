import { api } from "./tauri";
import type { UpdateChannel, UpdateSummary } from "../types/api";

export async function checkForUpdates(channel: UpdateChannel) {
  return api.checkForUpdates(channel);
}

export async function installUpdate(channel: UpdateChannel) {
  return api.installUpdate(channel);
}

export function formatUpdateTimestamp(value: string | null) {
  if (!value) {
    return "Never";
  }

  return new Date(value).toLocaleString();
}

export function summarizeUpdate(update: UpdateSummary | null) {
  if (!update) {
    return "You are on the latest version.";
  }

  return `Version ${update.version} is available on the ${update.channel} channel.`;
}

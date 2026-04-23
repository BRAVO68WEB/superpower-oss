import { create } from "zustand";
import type { UpdateChannel, UpdateCheckState, UpdateSummary } from "../types/api";

export type ActiveView = "home" | "scripts" | "runs" | "settings";
export const LAST_SELECTED_SCRIPT_STORAGE_KEY = "superpower:last-selected-script-id";
export const UPDATE_CHANNEL_STORAGE_KEY = "superpower:update-channel";
export const AUTO_CHECK_UPDATES_STORAGE_KEY = "superpower:auto-check-updates";
export const LAST_UPDATE_CHECK_STORAGE_KEY = "superpower:last-update-check-at";

export function readLastSelectedScriptId() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(LAST_SELECTED_SCRIPT_STORAGE_KEY);
}

export function writeLastSelectedScriptId(scriptId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(LAST_SELECTED_SCRIPT_STORAGE_KEY, scriptId);
}

function readStoredValue(key: string) {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage.getItem(key);
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(key, value);
}

function readUpdateChannel(): UpdateChannel {
  const stored = readStoredValue(UPDATE_CHANNEL_STORAGE_KEY);
  return stored === "beta" ? "beta" : "stable";
}

function readAutoCheckUpdates() {
  const stored = readStoredValue(AUTO_CHECK_UPDATES_STORAGE_KEY);
  return stored !== "false";
}

function readLastUpdateCheckAt() {
  return readStoredValue(LAST_UPDATE_CHECK_STORAGE_KEY);
}

type UiState = {
  activeView: ActiveView;
  scriptCreateRequestId: number;
  selectedScriptId: string | null;
  selectedRunScriptId: string | null;
  selectedRunId: string | null;
  schedulerPaused: boolean;
  updateChannel: UpdateChannel;
  autoCheckForUpdates: boolean;
  lastUpdateCheckAt: string | null;
  availableUpdate: UpdateSummary | null;
  updateStatus: UpdateCheckState;
  updateError: string | null;
  setActiveView: (view: ActiveView) => void;
  requestCreateScript: () => void;
  setSelectedScriptId: (scriptId: string | null) => void;
  setSelectedRunScriptId: (scriptId: string | null) => void;
  setSelectedRunId: (runId: string | null) => void;
  setSchedulerPaused: (paused: boolean) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckForUpdates: (enabled: boolean) => void;
  setLastUpdateCheckAt: (timestamp: string | null) => void;
  setAvailableUpdate: (update: UpdateSummary | null) => void;
  setUpdateStatus: (status: UpdateCheckState) => void;
  setUpdateError: (error: string | null) => void;
};

export const useUiStore = create<UiState>((set) => ({
  activeView: "home",
  scriptCreateRequestId: 0,
  selectedScriptId: readLastSelectedScriptId(),
  selectedRunScriptId: null,
  selectedRunId: null,
  schedulerPaused: false,
  updateChannel: readUpdateChannel(),
  autoCheckForUpdates: readAutoCheckUpdates(),
  lastUpdateCheckAt: readLastUpdateCheckAt(),
  availableUpdate: null,
  updateStatus: "idle",
  updateError: null,
  setActiveView: (activeView) => set({ activeView }),
  requestCreateScript: () => set((state) => ({ activeView: "scripts", scriptCreateRequestId: state.scriptCreateRequestId + 1 })),
  setSelectedScriptId: (selectedScriptId) => set({ selectedScriptId }),
  setSelectedRunScriptId: (selectedRunScriptId) => set({ selectedRunScriptId }),
  setSelectedRunId: (selectedRunId) => set({ selectedRunId }),
  setSchedulerPaused: (schedulerPaused) => set({ schedulerPaused }),
  setUpdateChannel: (updateChannel) => {
    writeStoredValue(UPDATE_CHANNEL_STORAGE_KEY, updateChannel);
    set({ updateChannel });
  },
  setAutoCheckForUpdates: (autoCheckForUpdates) => {
    writeStoredValue(AUTO_CHECK_UPDATES_STORAGE_KEY, String(autoCheckForUpdates));
    set({ autoCheckForUpdates });
  },
  setLastUpdateCheckAt: (lastUpdateCheckAt) => {
    if (lastUpdateCheckAt) {
      writeStoredValue(LAST_UPDATE_CHECK_STORAGE_KEY, lastUpdateCheckAt);
    } else if (typeof window !== "undefined") {
      window.localStorage.removeItem(LAST_UPDATE_CHECK_STORAGE_KEY);
    }
    set({ lastUpdateCheckAt });
  },
  setAvailableUpdate: (availableUpdate) => set({ availableUpdate }),
  setUpdateStatus: (updateStatus) => set({ updateStatus }),
  setUpdateError: (updateError) => set({ updateError }),
}));

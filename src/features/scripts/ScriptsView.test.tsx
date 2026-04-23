// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LAST_SELECTED_SCRIPT_STORAGE_KEY, useUiStore } from "../../store/ui";
import type { ScriptDetail, ScriptSummary } from "../../types/api";
import { ScriptsView } from "./ScriptsView";

const apiMock = vi.hoisted(() => ({
  listScripts: vi.fn(),
  getScript: vi.fn(),
  createScript: vi.fn(),
  updateScript: vi.fn(),
  runScriptNow: vi.fn(),
  duplicateScript: vi.fn(),
  deleteScript: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: apiMock,
}));

vi.mock("react-hot-toast", () => ({
  default: toastMock,
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange }: { value?: string; onChange?: (value: string) => void }) => (
    <textarea
      data-testid="monaco-editor"
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}));

const existingScriptSummary: ScriptSummary = {
  id: "script-1",
  name: "Revenue bot",
  description: "Sends the daily digest",
  enabled: true,
  manualRunEnabled: true,
  lastRunAt: "2026-04-23T08:00:00.000Z",
  updatedAt: "2026-04-23T08:10:00.000Z",
  triggerCount: 1,
};

const existingScriptDetail: ScriptDetail = {
  id: "script-1",
  name: "Revenue bot",
  description: "Sends the daily digest",
  code: 'await notify({ message: "Revenue ready" });',
  enabled: true,
  manualRunEnabled: true,
  createdAt: "2026-04-23T07:00:00.000Z",
  updatedAt: "2026-04-23T08:10:00.000Z",
  lastRunAt: "2026-04-23T08:00:00.000Z",
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
  policy: {
    notifyOnFailure: true,
    notifyOnSuccess: false,
    maxRunSeconds: null,
  },
};

describe("ScriptsView", () => {
  beforeEach(() => {
    apiMock.listScripts.mockResolvedValue([]);
    apiMock.getScript.mockResolvedValue(existingScriptDetail);
    apiMock.createScript.mockResolvedValue(existingScriptDetail);
    apiMock.updateScript.mockResolvedValue(existingScriptDetail);
    apiMock.runScriptNow.mockResolvedValue(undefined);
    apiMock.duplicateScript.mockResolvedValue(existingScriptDetail);
    apiMock.deleteScript.mockResolvedValue(undefined);

    toastMock.success.mockReset();
    toastMock.error.mockReset();
    window.localStorage.clear();

    useUiStore.setState({
      activeView: "scripts",
      selectedScriptId: null,
      selectedRunScriptId: null,
      selectedRunId: null,
      schedulerPaused: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the template gallery while creating a new script", async () => {
    renderScriptsView();

    expect(await screen.findByText("Starter blueprints")).toBeInTheDocument();
  });

  it("restores the remembered script instead of opening create mode", async () => {
    apiMock.listScripts.mockResolvedValue([existingScriptSummary]);
    window.localStorage.setItem(LAST_SELECTED_SCRIPT_STORAGE_KEY, existingScriptSummary.id);

    renderScriptsView();

    expect(screen.queryByText("Starter blueprints")).not.toBeInTheDocument();
    expect(await screen.findByDisplayValue(existingScriptDetail.name)).toBeInTheDocument();
  });

  it("hides templates while editing an existing script", async () => {
    apiMock.listScripts.mockResolvedValue([existingScriptSummary]);
    useUiStore.setState({ selectedScriptId: existingScriptSummary.id });

    renderScriptsView();

    await screen.findByDisplayValue(existingScriptDetail.name);
    expect(screen.queryByText("Starter blueprints")).not.toBeInTheDocument();
  });

  it("shows a success toast after creating a script", async () => {
    renderScriptsView();

    const createButton = await screen.findByRole("button", { name: "Create script" });
    await waitFor(() => expect(createButton).not.toBeDisabled());
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(apiMock.createScript).toHaveBeenCalledTimes(1);
      expect(toastMock.success).toHaveBeenCalledWith("Script created");
    });
  });

  it("shows a success toast after updating a script", async () => {
    apiMock.listScripts.mockResolvedValue([existingScriptSummary]);
    useUiStore.setState({ selectedScriptId: existingScriptSummary.id });

    renderScriptsView();

    fireEvent.click(await screen.findByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(apiMock.updateScript).toHaveBeenCalledTimes(1);
      expect(toastMock.success).toHaveBeenCalledWith("Script updated");
    });
  });

  it("shows an error toast when create fails", async () => {
    apiMock.createScript.mockRejectedValue(new Error("boom"));

    renderScriptsView();

    const createButton = await screen.findByRole("button", { name: "Create script" });
    await waitFor(() => expect(createButton).not.toBeDisabled());
    fireEvent.click(createButton);

    await waitFor(() => {
      expect(toastMock.error).toHaveBeenCalledWith("boom");
    });
  });
});

function renderScriptsView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ScriptsView />
    </QueryClientProvider>,
  );
}

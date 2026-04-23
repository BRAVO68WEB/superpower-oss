// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../store/ui";
import { AppShell } from "./AppShell";

const apiMock = vi.hoisted(() => ({
  getRuntimeHealth: vi.fn(),
  checkForUpdates: vi.fn(),
  onRunStarted: vi.fn(),
  onRunLog: vi.fn(),
  onRunFinished: vi.fn(),
  onSchedulerStateChanged: vi.fn(),
}));

vi.mock("../lib/tauri", () => ({
  api: apiMock,
}));

vi.mock("../lib/toast", () => ({
  showErrorToast: vi.fn(),
  showSuccessToast: vi.fn(),
}));

vi.mock("../features/home/HomeView", () => ({
  HomeView: () => <div>Mock Home View</div>,
}));

vi.mock("../features/scripts/ScriptsView", () => ({
  ScriptsView: () => <div>Mock Scripts View</div>,
}));

vi.mock("../features/runs/RunsView", () => ({
  RunsView: () => <div>Mock Runs View</div>,
}));

vi.mock("../features/settings/SettingsView", () => ({
  SettingsView: () => <div>Mock Settings View</div>,
}));

describe("AppShell", () => {
  beforeEach(() => {
    apiMock.getRuntimeHealth.mockResolvedValue({
      bunPath: "bun",
      bunVersion: "1.2.0",
      bundledBunAvailable: true,
      schedulerPaused: false,
      dbPath: "/tmp/db.sqlite",
      appVersion: "0.1.0",
      updatesConfigured: false,
    });
    apiMock.checkForUpdates.mockResolvedValue(null);
    apiMock.onRunStarted.mockResolvedValue(() => undefined);
    apiMock.onRunLog.mockResolvedValue(() => undefined);
    apiMock.onRunFinished.mockResolvedValue(() => undefined);
    apiMock.onSchedulerStateChanged.mockResolvedValue(() => undefined);

    useUiStore.setState({
      activeView: "home",
      scriptCreateRequestId: 0,
      selectedScriptId: null,
      selectedRunScriptId: null,
      selectedRunId: null,
      schedulerPaused: false,
      availableUpdate: null,
      updateStatus: "idle",
      updateError: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults to the home dashboard", async () => {
    renderAppShell();

    expect(await screen.findByText("Mock Home View")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /home/i })).toHaveClass("active");
  });

  it("switches views from the sidebar", async () => {
    renderAppShell();

    fireEvent.click(await screen.findByRole("button", { name: /scripts/i }));

    expect(await screen.findByText("Mock Scripts View")).toBeInTheDocument();
    expect(useUiStore.getState().activeView).toBe("scripts");
  });
});

function renderAppShell() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>,
  );
}

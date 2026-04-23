// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUiStore } from "../../store/ui";
import { HomeView } from "./HomeView";

const apiMock = vi.hoisted(() => ({
  listScripts: vi.fn(),
  listRuns: vi.fn(),
  listNotificationChannels: vi.fn(),
  getRuntimeHealth: vi.fn(),
  getUpdateConfiguration: vi.fn(),
}));

vi.mock("../../lib/tauri", () => ({
  api: apiMock,
}));

describe("HomeView", () => {
  beforeEach(() => {
    apiMock.listScripts.mockResolvedValue([
      {
        id: "script-1",
        name: "Revenue bot",
        description: "Daily digest",
        enabled: true,
        manualRunEnabled: true,
        lastRunAt: "2026-04-23T08:00:00.000Z",
        updatedAt: "2026-04-23T08:10:00.000Z",
        triggerCount: 1,
      },
      {
        id: "script-2",
        name: "Ops bot",
        description: "Incident summary",
        enabled: false,
        manualRunEnabled: true,
        lastRunAt: null,
        updatedAt: "2026-04-22T08:10:00.000Z",
        triggerCount: 2,
      },
    ]);
    apiMock.listRuns.mockResolvedValue([
      {
        id: "run-1",
        scriptId: "script-1",
        scriptName: "Revenue bot",
        triggerKind: "cron",
        triggerLabel: "Morning run",
        status: "success",
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 3200,
        exitCode: 0,
        errorSummary: null,
        coalescedCount: 0,
      },
    ]);
    apiMock.listNotificationChannels.mockResolvedValue([
      {
        id: "channel-1",
        kind: "native",
        name: "Desktop",
        enabled: true,
        config: {},
        hasSecret: false,
        createdAt: "2026-04-23T08:00:00.000Z",
        updatedAt: "2026-04-23T08:00:00.000Z",
      },
    ]);
    apiMock.getRuntimeHealth.mockResolvedValue({
      bunPath: "bun",
      bunVersion: "1.2.0",
      bundledBunAvailable: true,
      schedulerPaused: false,
      dbPath: "/tmp/db.sqlite",
      appVersion: "0.1.0",
      updatesConfigured: true,
    });
    apiMock.getUpdateConfiguration.mockResolvedValue({
      appVersion: "0.1.0",
      updatesConfigured: true,
    });

    useUiStore.setState({
      activeView: "home",
      scriptCreateRequestId: 0,
      schedulerPaused: false,
      updateChannel: "stable",
      availableUpdate: null,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders KPI cards and recent activity", async () => {
    renderHomeView();

    expect(await screen.findByText("Automation command center")).toBeInTheDocument();
    expect(await screen.findByText("Revenue bot")).toBeInTheDocument();
    expect(screen.getByText("Total scripts")).toBeInTheDocument();
    expect(screen.getByText("1.2.0")).toBeInTheDocument();
  });

  it("shows empty-state guidance when there are no runs", async () => {
    apiMock.listRuns.mockResolvedValue([]);

    renderHomeView();

    expect(await screen.findByText("No runs yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create a script" })).toBeInTheDocument();
  });
});

function renderHomeView() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <HomeView />
    </QueryClientProvider>,
  );
}

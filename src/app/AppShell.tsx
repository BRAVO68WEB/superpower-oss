import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { HomeView } from "../features/home/HomeView";
import { RunsView } from "../features/runs/RunsView";
import { ScriptsView } from "../features/scripts/ScriptsView";
import { SettingsView } from "../features/settings/SettingsView";
import { api } from "../lib/tauri";
import { showErrorToast, showSuccessToast } from "../lib/toast";
import { useUiStore, type ActiveView } from "../store/ui";

const navigation: Array<{ id: ActiveView; label: string; blurb: string }> = [
  { id: "home", label: "Home", blurb: "Overview and activity" },
  { id: "scripts", label: "Scripts", blurb: "Automations and editor" },
  { id: "runs", label: "Runs", blurb: "Execution history and logs" },
  { id: "settings", label: "Settings", blurb: "Runtime and delivery controls" },
];

const viewCopy: Record<ActiveView, { title: string; subtitle: string }> = {
  home: {
    title: "Home",
    subtitle: "Monitor the state of your automation stack at a glance.",
  },
  scripts: {
    title: "Scripts",
    subtitle: "Build, tune, and launch automations from a focused workspace.",
  },
  runs: {
    title: "Runs",
    subtitle: "Investigate recent executions, failures, and runtime output.",
  },
  settings: {
    title: "Settings",
    subtitle: "Manage runtime behavior, release channels, and notification delivery.",
  },
};

export function AppShell() {
  const queryClient = useQueryClient();
  const activeView = useUiStore((state) => state.activeView);
  const setActiveView = useUiStore((state) => state.setActiveView);
  const requestCreateScript = useUiStore((state) => state.requestCreateScript);
  const schedulerPaused = useUiStore((state) => state.schedulerPaused);
  const setSchedulerPaused = useUiStore((state) => state.setSchedulerPaused);
  const updateChannel = useUiStore((state) => state.updateChannel);
  const autoCheckForUpdates = useUiStore((state) => state.autoCheckForUpdates);
  const setLastUpdateCheckAt = useUiStore((state) => state.setLastUpdateCheckAt);
  const availableUpdate = useUiStore((state) => state.availableUpdate);
  const setAvailableUpdate = useUiStore((state) => state.setAvailableUpdate);
  const setUpdateStatus = useUiStore((state) => state.setUpdateStatus);
  const setUpdateError = useUiStore((state) => state.setUpdateError);
  const didRunStartupUpdateCheck = useRef(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const runtimeHealthQuery = useQuery({
    queryKey: ["runtimeHealth"],
    queryFn: api.getRuntimeHealth,
  });

  useEffect(() => {
    if (runtimeHealthQuery.data) {
      setSchedulerPaused(runtimeHealthQuery.data.schedulerPaused);
    }
  }, [runtimeHealthQuery.data, setSchedulerPaused]);

  useEffect(() => {
    if (!runtimeHealthQuery.data?.updatesConfigured || !autoCheckForUpdates || didRunStartupUpdateCheck.current) {
      return;
    }

    didRunStartupUpdateCheck.current = true;
    setUpdateStatus("checking");
    setUpdateError(null);

    void api
      .checkForUpdates(updateChannel)
      .then((update) => {
        setLastUpdateCheckAt(new Date().toISOString());
        setAvailableUpdate(update);
        setUpdateStatus(update ? "available" : "none");
        if (update) {
          showSuccessToast(`Update ${update.version} is available`);
        }
      })
      .catch((error) => {
        setUpdateStatus("error");
        setUpdateError(error instanceof Error ? error.message : "Failed to check for updates");
        showErrorToast(error, "Failed to check for updates");
      });
  }, [
    autoCheckForUpdates,
    runtimeHealthQuery.data?.updatesConfigured,
    setAvailableUpdate,
    setLastUpdateCheckAt,
    setUpdateError,
    setUpdateStatus,
    updateChannel,
  ]);

  useEffect(() => {
    let unlistenRunStarted: (() => void) | undefined;
    let unlistenRunLog: (() => void) | undefined;
    let unlistenRunFinished: (() => void) | undefined;
    let unlistenScheduler: (() => void) | undefined;

    void api.onRunStarted(async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
    }).then((fn) => {
      unlistenRunStarted = fn;
    });

    void api.onRunLog(async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
    }).then((fn) => {
      unlistenRunLog = fn;
    });

    void api.onRunFinished(async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      await queryClient.invalidateQueries({ queryKey: ["scripts"] });
    }).then((fn) => {
      unlistenRunFinished = fn;
    });

    void api.onSchedulerStateChanged((payload) => {
      setSchedulerPaused(payload.paused);
    }).then((fn) => {
      unlistenScheduler = fn;
    });

    return () => {
      unlistenRunStarted?.();
      unlistenRunLog?.();
      unlistenRunFinished?.();
      unlistenScheduler?.();
    };
  }, [queryClient, setSchedulerPaused]);

  const pageCopy = viewCopy[activeView];

  return (
    <div className="dashboard-shell">
      <aside className={`dashboard-sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">SP</div>
          <div>
            <strong>Superpower OSS</strong>
            <p>Tray-first automation</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navigation.map((item) => (
            <button
              key={item.id}
              className={`sidebar-link ${activeView === item.id ? "active" : ""}`}
              onClick={() => {
                setActiveView(item.id);
                setMobileNavOpen(false);
              }}
            >
              <span>{item.label}</span>
              <small>{item.blurb}</small>
            </button>
          ))}
        </nav>

        <div className="sidebar-status">
          <div className="sidebar-status-card">
            <small>Scheduler</small>
            <strong>{schedulerPaused ? "Paused" : "Active"}</strong>
            <span>{runtimeHealthQuery.data?.appVersion ?? "Loading app version"}</span>
          </div>
          <div className="sidebar-status-card">
            <small>Runtime</small>
            <strong>{runtimeHealthQuery.data?.bunVersion ?? "Detecting Bun"}</strong>
            <span>{availableUpdate ? `Update ${availableUpdate.version} ready` : `${updateChannel} channel`}</span>
          </div>
        </div>
      </aside>

      {mobileNavOpen ? <button className="sidebar-backdrop" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} /> : null}

      <div className="dashboard-main">
        <header className="topbar">
          <div className="topbar-copy">
            <button className="menu-toggle" aria-label="Open navigation" onClick={() => setMobileNavOpen((open) => !open)}>
              <span />
              <span />
              <span />
            </button>
            <div>
              <p className="eyebrow">Operations</p>
              <h1>{pageCopy.title}</h1>
              <p>{pageCopy.subtitle}</p>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="topbar-pill">
              <small>Scheduler</small>
              <strong>{schedulerPaused ? "Paused" : "Active"}</strong>
            </div>
            <div className="topbar-pill">
              <small>Bun</small>
              <strong>{runtimeHealthQuery.data?.bunVersion ?? "..."}</strong>
            </div>
            <button className="button button-primary topbar-cta" onClick={() => requestCreateScript()}>
              New script
            </button>
          </div>
        </header>

        <main className="dashboard-surface">
          {activeView === "home" ? <HomeView /> : null}
          {activeView === "scripts" ? <ScriptsView /> : null}
          {activeView === "runs" ? <RunsView /> : null}
          {activeView === "settings" ? <SettingsView /> : null}
        </main>
      </div>
    </div>
  );
}

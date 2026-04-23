import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, type ReactNode } from "react";

import { api } from "../../lib/tauri";
import { useUiStore } from "../../store/ui";
import { groupRunsByScript } from "./runGroups";

export function RunsView() {
  const setActiveView = useUiStore((state) => state.setActiveView);
  const selectedRunScriptId = useUiStore((state) => state.selectedRunScriptId);
  const setSelectedRunScriptId = useUiStore((state) => state.setSelectedRunScriptId);
  const selectedRunId = useUiStore((state) => state.selectedRunId);
  const setSelectedRunId = useUiStore((state) => state.setSelectedRunId);

  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: api.listRuns,
  });

  const runGroups = useMemo(() => groupRunsByScript(runsQuery.data ?? []), [runsQuery.data]);

  useEffect(() => {
    if (runGroups.length === 0) {
      if (selectedRunScriptId !== null) {
        setSelectedRunScriptId(null);
      }
      if (selectedRunId !== null) {
        setSelectedRunId(null);
      }
      return;
    }

    const activeGroup = runGroups.find((group) => group.scriptId === selectedRunScriptId) ?? runGroups[0];

    if (activeGroup.scriptId !== selectedRunScriptId) {
      setSelectedRunScriptId(activeGroup.scriptId);
    }

    const selectedRunStillVisible = activeGroup.runs.some((run) => run.id === selectedRunId);
    const nextRunId = selectedRunStillVisible ? selectedRunId : activeGroup.runs[0]?.id ?? null;

    if (nextRunId !== selectedRunId) {
      setSelectedRunId(nextRunId);
    }
  }, [runGroups, selectedRunId, selectedRunScriptId, setSelectedRunId, setSelectedRunScriptId]);

  const activeGroup = runGroups.find((group) => group.scriptId === selectedRunScriptId) ?? null;
  const latestRunTime = runGroups[0]?.latestRun.startedAt ?? null;
  const failureCount = (runsQuery.data ?? []).filter((run) => run.status === "failure").length;

  const runDetailQuery = useQuery({
    queryKey: ["runs", selectedRunId],
    queryFn: () => api.getRun(selectedRunId ?? ""),
    enabled: Boolean(selectedRunId),
  });

  return (
    <section className="dashboard-page runs-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Monitoring</p>
          <h1>Runs console</h1>
          <p className="section-copy">
            Review grouped execution history, inspect status, and drill into logs without leaving the dashboard.
          </p>
        </div>
      </div>

      <section className="summary-strip">
        <article className="summary-card">
          <small>Groups</small>
          <strong>{runGroups.length}</strong>
        </article>
        <article className="summary-card">
          <small>Latest activity</small>
          <strong>{formatRunMoment(latestRunTime)}</strong>
        </article>
        <article className="summary-card">
          <small>Failures</small>
          <strong>{failureCount}</strong>
        </article>
      </section>

      <section className="runs-workspace">
        <aside className="section-card runs-explorer">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">Explorer</p>
              <h2>Grouped activity</h2>
            </div>
          </div>

          <div className="stack">
            {runGroups.length > 0 ? (
              runGroups.map((group) => {
                const expanded = group.scriptId === selectedRunScriptId;

                return (
                  <article key={group.scriptId} className={`run-group ${expanded ? "selected" : ""}`}>
                    <button className="run-group-summary" onClick={() => setSelectedRunScriptId(group.scriptId)}>
                      <div className="list-item-content">
                        <div className="card-row">
                          <strong>{group.scriptName}</strong>
                          <span className={`status-chip status-${group.latestRun.status}`}>{group.latestRun.status}</span>
                        </div>
                        <div className="meta-row">
                          <small>{group.runs.length} run{group.runs.length === 1 ? "" : "s"}</small>
                          <small>{formatRunMoment(group.latestRun.startedAt)}</small>
                        </div>
                      </div>
                    </button>

                    {expanded ? (
                      <div className="stack stack-tight">
                        {group.runs.map((run) => (
                          <button
                            key={run.id}
                            className={`run-row ${selectedRunId === run.id ? "selected" : ""}`}
                            onClick={() => setSelectedRunId(run.id)}
                          >
                            <div className="list-item-content">
                              <div className="card-row">
                                <strong>{run.triggerLabel}</strong>
                                <span className={`status-chip status-${run.status}`}>{run.status}</span>
                              </div>
                              <div className="meta-row">
                                <small>{run.triggerKind}</small>
                                <small>{formatDuration(run.durationMs)}</small>
                                <small>{formatRunMoment(run.startedAt)}</small>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <div className="empty-state panel-muted">
                <div className="stack">
                  <div>Runs will appear here as soon as a script is executed.</div>
                  <button className="button button-primary" onClick={() => setActiveView("scripts")}>
                    Go to scripts
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        <section className="section-card section-card-strong runs-detail">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">Details</p>
              <h2>{runDetailQuery.data?.run.scriptName ?? activeGroup?.scriptName ?? "Select a run"}</h2>
              <p className="section-copy">Inspect timing, trigger metadata, and the log stream for the selected execution.</p>
            </div>
          </div>

          {runDetailQuery.data ? (
            <div className="stack">
              <div className="metrics-grid metrics-grid-wide">
                <Metric
                  label="Status"
                  value={<span className={`status-chip status-${runDetailQuery.data.run.status}`}>{runDetailQuery.data.run.status}</span>}
                />
                <Metric label="Trigger" value={runDetailQuery.data.run.triggerLabel} />
                <Metric label="Trigger kind" value={runDetailQuery.data.run.triggerKind} />
                <Metric label="Duration" value={formatDuration(runDetailQuery.data.run.durationMs)} />
                <Metric label="Exit code" value={runDetailQuery.data.run.exitCode?.toString() ?? "n/a"} />
                <Metric label="Started" value={formatRunMoment(runDetailQuery.data.run.startedAt)} />
              </div>

              {runDetailQuery.data.run.errorSummary ? (
                <div className="notice notice-danger">{runDetailQuery.data.run.errorSummary}</div>
              ) : null}

              <div className="log-card">
                {runDetailQuery.data.logs.length > 0 ? (
                  runDetailQuery.data.logs.map((log) => (
                    <pre key={log.id} className={`log-line log-${log.stream}`}>
                      <span>{log.stream}</span>
                      <code>{log.content}</code>
                    </pre>
                  ))
                ) : (
                  <div className="empty-state">This run has no logs yet.</div>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-state panel-muted">Select a run to inspect stdout, stderr, and notification events.</div>
          )}
        </section>
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function formatRunMoment(value: string | null) {
  if (!value) {
    return "Waiting";
  }

  return new Date(value).toLocaleString();
}

function formatDuration(value: number | null) {
  if (value === null) {
    return "n/a";
  }

  return `${(value / 1000).toFixed(2)}s`;
}

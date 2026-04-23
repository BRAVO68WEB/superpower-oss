import { useQuery } from "@tanstack/react-query";

import { api } from "../../lib/tauri";
import { useUiStore } from "../../store/ui";

export function HomeView() {
  const setActiveView = useUiStore((state) => state.setActiveView);
  const requestCreateScript = useUiStore((state) => state.requestCreateScript);
  const updateChannel = useUiStore((state) => state.updateChannel);
  const availableUpdate = useUiStore((state) => state.availableUpdate);

  const scriptsQuery = useQuery({
    queryKey: ["scripts"],
    queryFn: api.listScripts,
  });
  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: api.listRuns,
  });
  const channelsQuery = useQuery({
    queryKey: ["notificationChannels"],
    queryFn: api.listNotificationChannels,
  });
  const runtimeQuery = useQuery({
    queryKey: ["runtimeHealth"],
    queryFn: api.getRuntimeHealth,
  });
  const updateConfigQuery = useQuery({
    queryKey: ["updateConfiguration"],
    queryFn: api.getUpdateConfiguration,
  });

  const scripts = scriptsQuery.data ?? [];
  const runs = runsQuery.data ?? [];
  const channels = channelsQuery.data ?? [];
  const recentRuns = [...runs].sort(sortByDateDesc).slice(0, 8);
  const last24Hours = Date.now() - 24 * 60 * 60 * 1000;
  const recentWindowRuns = runs.filter((run) => run.startedAt && new Date(run.startedAt).getTime() >= last24Hours);
  const failedRuns = recentWindowRuns.filter((run) => run.status === "failure").length;
  const enabledScripts = scripts.filter((script) => script.enabled).length;
  const runtimeVersion = runtimeQuery.data?.bunVersion ?? "Unavailable";
  const updateEnabled = updateConfigQuery.data?.updatesConfigured ?? runtimeQuery.data?.updatesConfigured;

  return (
    <section className="dashboard-page home-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Overview</p>
          <h1>Automation command center</h1>
          <p className="section-copy">
            Track script health, recent runs, runtime status, and delivery channels from one dashboard.
          </p>
        </div>
        <div className="page-actions">
          <button className="button button-primary" onClick={() => requestCreateScript()}>
            New script
          </button>
          <button className="button" onClick={() => setActiveView("runs")}>
            View runs
          </button>
        </div>
      </div>

      <section className="stat-grid">
        <StatCard label="Total scripts" value={String(scripts.length)} meta={`${enabledScripts} enabled`} />
        <StatCard label="Enabled scripts" value={String(enabledScripts)} meta={`${Math.max(scripts.length - enabledScripts, 0)} disabled`} />
        <StatCard label="Runs / 24h" value={String(recentWindowRuns.length)} meta="Recent execution volume" />
        <StatCard label="Failures / 24h" value={String(failedRuns)} meta={failedRuns > 0 ? "Needs attention" : "All clear"} tone={failedRuns > 0 ? "danger" : "success"} />
        <StatCard label="Channels" value={String(channels.length)} meta={`${channels.filter((channel) => channel.enabled).length} active`} />
        <StatCard
          label="Scheduler"
          value={runtimeQuery.data?.schedulerPaused ? "Paused" : "Active"}
          meta={`Bun ${runtimeVersion}`}
          tone={runtimeQuery.data?.schedulerPaused ? "warning" : "success"}
        />
      </section>

      <section className="home-overview-grid">
        <section className="section-card section-card-strong">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">Activity</p>
              <h2>Recent runs</h2>
            </div>
            <button className="button button-ghost" onClick={() => setActiveView("runs")}>
              Open runs
            </button>
          </div>

          {recentRuns.length > 0 ? (
            <div className="activity-list">
              {recentRuns.map((run) => (
                <button key={run.id} className="activity-row" onClick={() => setActiveView("runs")}>
                  <div className="activity-main">
                    <strong>{run.scriptName}</strong>
                    <p>
                      {run.triggerLabel} • {run.triggerKind}
                    </p>
                  </div>
                  <div className="activity-meta">
                    <span className={`status-chip status-${run.status}`}>{run.status}</span>
                    <small>{formatTimestamp(run.startedAt)}</small>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state empty-state-large">
              <div className="stack stack-tight">
                <strong>No runs yet</strong>
                <p>Kick off your first automation to populate the activity feed.</p>
                <button className="button button-primary" onClick={() => requestCreateScript()}>
                  Create a script
                </button>
              </div>
            </div>
          )}
        </section>

        <div className="home-side-grid">
          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Runtime</p>
                <h2>System health</h2>
              </div>
            </div>
            <dl className="definition-list">
              <Definition label="Bun version" value={runtimeVersion} />
              <Definition label="Bundled runtime" value={runtimeQuery.data?.bundledBunAvailable ? "Detected" : "Not bundled"} />
              <Definition label="Database" value={runtimeQuery.data?.dbPath ?? "Unknown"} />
              <Definition label="App version" value={runtimeQuery.data?.appVersion ?? "Unknown"} />
            </dl>
          </section>

          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Updates</p>
                <h2>Release status</h2>
              </div>
            </div>
            <dl className="definition-list">
              <Definition label="Channel" value={updateChannel} />
              <Definition label="Updater" value={updateEnabled ? "Configured" : "Disabled"} />
              <Definition label="Available" value={availableUpdate?.version ?? "None"} />
            </dl>
            <div className="section-footer">
              <button className="button button-ghost" onClick={() => setActiveView("settings")}>
                Manage updates
              </button>
            </div>
          </section>

          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Shortcuts</p>
                <h2>Jump to work</h2>
              </div>
            </div>
            <div className="quick-link-grid">
              <button className="quick-link-card" onClick={() => requestCreateScript()}>
                <strong>Create a new script</strong>
                <p>Open the editor in create mode.</p>
              </button>
              <button className="quick-link-card" onClick={() => setActiveView("scripts")}>
                <strong>Manage scripts</strong>
                <p>Review code, triggers, and policies.</p>
              </button>
              <button className="quick-link-card" onClick={() => setActiveView("runs")}>
                <strong>Inspect runs</strong>
                <p>Drill into logs and execution history.</p>
              </button>
              <button className="quick-link-card" onClick={() => setActiveView("settings")}>
                <strong>Configure channels</strong>
                <p>Adjust runtime, updates, and notifications.</p>
              </button>
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function StatCard({
  label,
  value,
  meta,
  tone = "neutral",
}: {
  label: string;
  value: string;
  meta: string;
  tone?: "neutral" | "success" | "danger" | "warning";
}) {
  return (
    <article className={`stat-card stat-card-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <span>{meta}</span>
    </article>
  );
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div className="definition-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Waiting";
  }

  return new Date(value).toLocaleString();
}

function sortByDateDesc(a: { startedAt: string | null }, b: { startedAt: string | null }) {
  return new Date(b.startedAt ?? 0).getTime() - new Date(a.startedAt ?? 0).getTime();
}

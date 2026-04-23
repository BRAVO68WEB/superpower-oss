import { open, save } from "@tauri-apps/plugin-dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";

import { JsonEditorField } from "../../components/JsonEditorField";
import { api } from "../../lib/tauri";
import { showErrorToast, showSuccessToast } from "../../lib/toast";
import { formatUpdateTimestamp } from "../../lib/updater";
import { useUiStore } from "../../store/ui";
import type { HttpBodyMode, NotificationChannel, NotificationChannelInput, UpdateChannel } from "../../types/api";
import {
  DEFAULT_HTTP_BODY_TEMPLATE,
  getHeaderRecord,
  getHttpConfig,
  getHttpUrl,
  getSecretRecord,
  getWebhookUrl,
  HTTP_TEMPLATE_PRESETS,
  HTTP_VARIABLES,
  renderHttpRequestPreview,
  withHttpUrl,
  withWebhookUrl,
} from "./channelBuilder";

const SMTP_FIELDS = [
  { key: "host", label: "SMTP host" },
  { key: "port", label: "Port", numeric: true },
  { key: "from", label: "From address" },
  { key: "to", label: "To address" },
  { key: "username", label: "Username" },
  { key: "subjectPrefix", label: "Subject prefix" },
] as const;

const providerLabels: Record<NotificationChannelInput["kind"], string> = {
  native: "Native desktop",
  slack: "Slack webhook",
  discord: "Discord webhook",
  smtp: "SMTP mail",
  http: "Custom HTTP API",
};

const blankChannel = (kind: NotificationChannelInput["kind"] = "native"): NotificationChannelInput => {
  const config =
    kind === "http"
      ? {
          method: "POST",
          headers: {},
          bodyMode: "json",
          bodyTemplate: DEFAULT_HTTP_BODY_TEMPLATE,
        }
      : {};

  return {
    kind,
    name: providerLabels[kind],
    enabled: true,
    config,
    secret: null,
  };
};

export function SettingsView() {
  const queryClient = useQueryClient();
  const schedulerPaused = useUiStore((state) => state.schedulerPaused);
  const setSchedulerPaused = useUiStore((state) => state.setSchedulerPaused);
  const updateChannel = useUiStore((state) => state.updateChannel);
  const setUpdateChannel = useUiStore((state) => state.setUpdateChannel);
  const autoCheckForUpdates = useUiStore((state) => state.autoCheckForUpdates);
  const setAutoCheckForUpdates = useUiStore((state) => state.setAutoCheckForUpdates);
  const lastUpdateCheckAt = useUiStore((state) => state.lastUpdateCheckAt);
  const setLastUpdateCheckAt = useUiStore((state) => state.setLastUpdateCheckAt);
  const availableUpdate = useUiStore((state) => state.availableUpdate);
  const setAvailableUpdate = useUiStore((state) => state.setAvailableUpdate);
  const updateStatus = useUiStore((state) => state.updateStatus);
  const setUpdateStatus = useUiStore((state) => state.setUpdateStatus);
  const updateError = useUiStore((state) => state.updateError);
  const setUpdateError = useUiStore((state) => state.setUpdateError);
  const [channelDraft, setChannelDraft] = useState<NotificationChannelInput>(blankChannel);
  const [editingSecretChannelId, setEditingSecretChannelId] = useState<string | null>(null);
  const httpBodyTemplateRef = useRef<HTMLTextAreaElement | null>(null);

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

  const editingChannel = channelsQuery.data?.find((channel) => channel.id === channelDraft.id) ?? null;
  const editingSecretLoading = editingSecretChannelId === channelDraft.id;

  const saveChannelMutation = useMutation({
    mutationFn: async () => api.upsertNotificationChannel(channelDraft),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["notificationChannels"] });
      setChannelDraft(blankChannel());
      setEditingSecretChannelId(null);
      showSuccessToast("Channel saved");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to save channel");
    },
  });

  const pauseMutation = useMutation({
    mutationFn: async (paused: boolean) => api.setPauseScheduling(paused),
    onSuccess: async (state) => {
      setSchedulerPaused(state.paused);
      await queryClient.invalidateQueries({ queryKey: ["runtimeHealth"] });
      showSuccessToast(state.paused ? "Scheduler paused" : "Scheduler resumed");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to update scheduler state");
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: async (channelId: string) => {
      await api.sendTestNotification(channelId);
      return channelId;
    },
    onSuccess: () => {
      showSuccessToast("Test notification sent");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to send test notification");
    },
  });

  const deleteChannelMutation = useMutation({
    mutationFn: async (channelId: string) => {
      await api.deleteNotificationChannel(channelId);
      return channelId;
    },
    onSuccess: async (channelId) => {
      await queryClient.invalidateQueries({ queryKey: ["notificationChannels"] });
      if (channelDraft.id === channelId) {
        setChannelDraft(blankChannel());
        setEditingSecretChannelId(null);
      }
      showSuccessToast("Channel deleted");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to delete channel");
    },
  });

  const checkUpdatesMutation = useMutation({
    mutationFn: async (channel: UpdateChannel) => api.checkForUpdates(channel),
    onMutate: () => {
      setUpdateStatus("checking");
      setUpdateError(null);
    },
    onSuccess: (update) => {
      const checkedAt = new Date().toISOString();
      setLastUpdateCheckAt(checkedAt);
      setAvailableUpdate(update);
      setUpdateStatus(update ? "available" : "none");
      if (update) {
        showSuccessToast(`Update ${update.version} is available`);
      } else {
        showSuccessToast("You are on the latest version");
      }
    },
    onError: (error) => {
      setUpdateStatus("error");
      setUpdateError(error instanceof Error ? error.message : "Failed to check for updates");
      showErrorToast(error, "Failed to check for updates");
    },
  });

  const installUpdateMutation = useMutation({
    mutationFn: async (channel: UpdateChannel) => api.installUpdate(channel),
    onMutate: () => {
      setUpdateStatus("installing");
      setUpdateError(null);
    },
    onSuccess: (update) => {
      setUpdateStatus("idle");
      if (update) {
        setAvailableUpdate(update);
        showSuccessToast("Update installed. Restart the app if it does not relaunch automatically.");
      } else {
        setAvailableUpdate(null);
        showSuccessToast("No newer update is available.");
      }
    },
    onError: (error) => {
      setUpdateStatus("error");
      setUpdateError(error instanceof Error ? error.message : "Failed to install update");
      showErrorToast(error, "Failed to install update");
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const path = await open({
        filters: [{ name: "Superpower JSON", extensions: ["json"] }],
        multiple: false,
      });

      if (!path || Array.isArray(path)) {
        return null;
      }

      const preview = await api.importScripts(path);
      return api.confirmImport(preview.previewId);
    },
    onSuccess: async (result) => {
      if (!result) {
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["scripts"] }),
        queryClient.invalidateQueries({ queryKey: ["notificationChannels"] }),
      ]);
      showSuccessToast(`Imported ${result.importedScriptIds.length} script${result.importedScriptIds.length === 1 ? "" : "s"}`);
    },
    onError: (error) => {
      showErrorToast(error, "Failed to import package");
    },
  });

  const exportMutation = useMutation({
    mutationFn: async () => {
      const scripts = await api.listScripts();
      const path = await save({
        defaultPath: "superpower-export.json",
        filters: [{ name: "Superpower JSON", extensions: ["json"] }],
      });

      if (!path) {
        return null;
      }

      return api.exportScripts(
        scripts.map((script) => script.id),
        path,
      );
    },
    onSuccess: (result) => {
      if (!result) {
        return;
      }

      showSuccessToast(`Exported ${result.scriptCount} script${result.scriptCount === 1 ? "" : "s"}`);
    },
    onError: (error) => {
      showErrorToast(error, "Failed to export package");
    },
  });

  const smtpFields = useMemo(
    () =>
      SMTP_FIELDS.map((field) => ({
        ...field,
        value: channelDraft.config[field.key],
      })),
    [channelDraft.config],
  );
  const httpConfig = useMemo(() => getHttpConfig(channelDraft.config), [channelDraft.config]);
  const httpPreview = useMemo(
    () =>
      channelDraft.kind === "http"
        ? renderHttpRequestPreview({
            config: channelDraft.config,
            secret: channelDraft.secret,
          })
        : null,
    [channelDraft.config, channelDraft.kind, channelDraft.secret],
  );
  const validationErrors = useMemo(
    () => validateChannelDraft(channelDraft, httpPreview?.errors ?? [], editingSecretLoading),
    [channelDraft, editingSecretLoading, httpPreview?.errors],
  );
  const saveDisabled = saveChannelMutation.isPending || editingSecretLoading || validationErrors.length > 0;

  async function editChannel(channel: NotificationChannel) {
    setChannelDraft(toChannelDraft(channel));
    setEditingSecretChannelId(channel.id);

    try {
      const secret = await api.getNotificationChannelSecret(channel.id);
      setChannelDraft((current) => (current.id === channel.id ? { ...current, secret } : current));
    } catch (error) {
      showErrorToast(error, "Failed to load stored secret");
    } finally {
      setEditingSecretChannelId((current) => (current === channel.id ? null : current));
    }
  }

  function updateDraft(patch: Partial<NotificationChannelInput>) {
    setChannelDraft((current) => ({ ...current, ...patch }));
  }

  function updateDraftConfig(patch: Record<string, unknown>) {
    setChannelDraft((current) => ({
      ...current,
      config: {
        ...current.config,
        ...patch,
      },
    }));
  }

  function applyHttpPreset(presetId: string) {
    const preset = HTTP_TEMPLATE_PRESETS.find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    updateDraftConfig({
      bodyMode: preset.bodyMode,
      bodyTemplate: preset.template,
    });
  }

  function insertHttpToken(token: string) {
    const currentTemplate = httpConfig.bodyTemplate;
    const textarea = httpBodyTemplateRef.current;
    const insertionStart = textarea?.selectionStart ?? currentTemplate.length;
    const insertionEnd = textarea?.selectionEnd ?? currentTemplate.length;
    const nextTemplate = `${currentTemplate.slice(0, insertionStart)}${token}${currentTemplate.slice(insertionEnd)}`;
    const nextCursor = insertionStart + token.length;

    updateDraftConfig({ bodyTemplate: nextTemplate });

    requestAnimationFrame(() => {
      if (!httpBodyTemplateRef.current) {
        return;
      }

      httpBodyTemplateRef.current.focus();
      httpBodyTemplateRef.current.setSelectionRange(nextCursor, nextCursor);
    });
  }

  async function copyHttpToken(token: string) {
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard access is unavailable");
      }

      await navigator.clipboard.writeText(token);
      showSuccessToast(`Copied ${token}`);
    } catch (error) {
      showErrorToast(error, "Failed to copy token");
    }
  }

  return (
    <section className="dashboard-page settings-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>System settings</h1>
          <p className="section-copy">
            Manage runtime health, release behavior, imports, and notification delivery from a single admin page.
          </p>
        </div>
      </div>

      <section className="settings-layout">
        <div className="settings-main-column">
          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Runtime</p>
                <h2>Scheduler health</h2>
                <p className="section-copy">Monitor the local Bun runtime and pause scheduled execution when needed.</p>
              </div>
            </div>
            <div className="metrics-grid">
              <Metric label="Bun path" value={runtimeQuery.data?.bunPath ?? "bun"} />
              <Metric label="Bun version" value={runtimeQuery.data?.bunVersion ?? "Unavailable"} />
              <Metric label="Bundled Bun" value={runtimeQuery.data?.bundledBunAvailable ? "Detected" : "Not bundled"} />
              <Metric label="Database" value={runtimeQuery.data?.dbPath ?? "Unknown"} />
              <Metric label="App version" value={runtimeQuery.data?.appVersion ?? "Unknown"} />
            </div>
            <div className="toggle-row">
              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={schedulerPaused}
                  disabled={pauseMutation.isPending}
                  onChange={(event) => pauseMutation.mutate(event.target.checked)}
                />
                {pauseMutation.isPending ? "Updating scheduler..." : "Pause scheduling"}
              </label>
            </div>
          </section>

          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Updates</p>
                <h2>Release channel</h2>
                <p className="section-copy">
                  Check GitHub Releases for stable and beta builds, then install updates from the channel you choose.
                </p>
              </div>
            </div>

            <div className="stack">
              <div className="metrics-grid">
                <Metric label="Current version" value={updateConfigQuery.data?.appVersion ?? runtimeQuery.data?.appVersion ?? "Unknown"} />
                <Metric
                  label="Updater"
                  value={(updateConfigQuery.data?.updatesConfigured ?? runtimeQuery.data?.updatesConfigured) ? "Configured" : "Disabled"}
                />
                <Metric label="Last checked" value={formatUpdateTimestamp(lastUpdateCheckAt)} />
              </div>

              <div className="field-grid">
                <label className="field">
                  <span>Channel</span>
                  <select value={updateChannel} onChange={(event) => setUpdateChannel(event.target.value as UpdateChannel)}>
                    <option value="stable">Stable</option>
                    <option value="beta">Beta</option>
                  </select>
                </label>

                <label className="toggle-inline card-toggle">
                  <input
                    type="checkbox"
                    checked={autoCheckForUpdates}
                    onChange={(event) => setAutoCheckForUpdates(event.target.checked)}
                  />
                  Check for updates on startup
                </label>
              </div>

              {updateConfigQuery.data?.updatesConfigured ?? runtimeQuery.data?.updatesConfigured ? (
                <>
                  {availableUpdate ? (
                    <div className="template-card">
                      <strong>Update {availableUpdate.version} is available</strong>
                      <p>{availableUpdate.notes ?? "Release notes were not included in the updater feed."}</p>
                      <small>
                        Published {availableUpdate.pubDate ? new Date(availableUpdate.pubDate).toLocaleString() : "Unknown"}
                      </small>
                    </div>
                  ) : (
                    <div className="helper-text">No update has been announced for the selected channel yet.</div>
                  )}

                  {updateError ? <div className="notice notice-danger">{updateError}</div> : null}

                  <div className="button-row">
                    <button
                      className="button"
                      disabled={checkUpdatesMutation.isPending || installUpdateMutation.isPending}
                      onClick={() => checkUpdatesMutation.mutate(updateChannel)}
                    >
                      {checkUpdatesMutation.isPending || updateStatus === "checking" ? "Checking..." : "Check for updates"}
                    </button>
                    <button
                      className="button button-primary"
                      disabled={!availableUpdate || installUpdateMutation.isPending || checkUpdatesMutation.isPending}
                      onClick={() => installUpdateMutation.mutate(updateChannel)}
                    >
                      {installUpdateMutation.isPending || updateStatus === "installing" ? "Installing..." : "Download and install"}
                    </button>
                  </div>
                </>
              ) : (
                <div className="helper-text">
                  Updater is not configured for this build yet. Set the GitHub repository slug and updater public key at build time.
                </div>
              )}
            </div>
          </section>

          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Import / Export</p>
                <h2>Share scripts locally</h2>
                <p className="section-copy">
                  Export scripts with their non-secret metadata or import an existing package from disk.
                </p>
              </div>
            </div>
            <div className="button-row">
              <button className="button" disabled={importMutation.isPending || exportMutation.isPending} onClick={() => importMutation.mutate()}>
                {importMutation.isPending ? "Importing..." : "Import package"}
              </button>
              <button className="button" disabled={importMutation.isPending || exportMutation.isPending} onClick={() => exportMutation.mutate()}>
                {exportMutation.isPending ? "Exporting..." : "Export package"}
              </button>
            </div>
            <p className="helper-text">
              Exports include scripts, triggers, policies, and non-secret channel references. Credentials stay in your OS
              keychain.
            </p>
          </section>
        </div>

        <div className="settings-side-column">
          <section className="section-card">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">Channels</p>
                <h2>Notification providers</h2>
                <p className="section-copy">Edit destinations, verify credentials, and keep delivery channels tidy.</p>
              </div>
              <button className="button" onClick={() => setChannelDraft(blankChannel())}>
                New channel
              </button>
            </div>

            <div className="stack">
              {(channelsQuery.data ?? []).length > 0 ? (
                (channelsQuery.data ?? []).map((channel) => (
                  <article key={channel.id} className={`template-card ${channelDraft.id === channel.id ? "template-card-active" : ""}`}>
                    <div className="card-row">
                      <div>
                        <strong>{channel.name}</strong>
                        <p>{providerLabels[channel.kind]}</p>
                      </div>
                      <span className={`status-chip ${channel.enabled ? "active" : "muted"}`}>
                        {channel.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <small>{channel.hasSecret ? "Secret stored in keychain" : "No secret stored yet"}</small>
                    <div className="button-row">
                      <button
                        className="button"
                        disabled={testNotificationMutation.isPending || deleteChannelMutation.isPending}
                        onClick={() => testNotificationMutation.mutate(channel.id)}
                      >
                        {testNotificationMutation.isPending && testNotificationMutation.variables === channel.id
                          ? "Sending..."
                          : "Send test"}
                      </button>
                      <button className="button" onClick={() => void editChannel(channel)}>
                        {editingSecretChannelId === channel.id ? "Loading..." : "Edit"}
                      </button>
                      <button
                        className="button button-danger"
                        disabled={deleteChannelMutation.isPending || testNotificationMutation.isPending}
                        onClick={() => deleteChannelMutation.mutate(channel.id)}
                      >
                        {deleteChannelMutation.isPending && deleteChannelMutation.variables === channel.id
                          ? "Deleting..."
                          : "Delete"}
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state panel-muted">No channels configured yet. Add one to fan out notifications.</div>
              )}
            </div>
          </section>

          <section className="section-card section-card-strong">
            <div className="section-card-header">
              <div>
                <p className="eyebrow">{editingChannel ? "Edit channel" : "Create channel"}</p>
                <h2>{editingChannel ? editingChannel.name : "Channel settings"}</h2>
                <p className="section-copy">
                  Configure transport-specific fields, enable delivery, and store any secrets safely.
                </p>
              </div>
            </div>

            <div className="stack">
              <label className="field">
                <span>Provider</span>
                <select
                  value={channelDraft.kind}
                  onChange={(event) => {
                    const nextKind = event.target.value as NotificationChannelInput["kind"];
                    setChannelDraft(blankChannel(nextKind));
                    setEditingSecretChannelId(null);
                  }}
                >
                  <option value="native">OS native notification</option>
                  <option value="slack">Slack webhook</option>
                  <option value="discord">Discord webhook</option>
                  <option value="smtp">SMTP mail</option>
                  <option value="http">Custom HTTP API</option>
                </select>
              </label>

              <label className="field">
                <span>Name</span>
                <input value={channelDraft.name} onChange={(event) => updateDraft({ name: event.target.value })} />
              </label>

              <label className="toggle-inline">
                <input
                  type="checkbox"
                  checked={channelDraft.enabled}
                  onChange={(event) => updateDraft({ enabled: event.target.checked })}
                />
                Enabled
              </label>

              {editingSecretLoading ? <div className="helper-text">Loading stored secret from the OS keychain...</div> : null}

              {(channelDraft.kind === "slack" || channelDraft.kind === "discord") && (
                <>
                  <label className="field">
                    <span>Webhook URL</span>
                    <input
                      placeholder="https://hooks.slack.com/services/..."
                      value={getWebhookUrl(channelDraft.secret)}
                      onChange={(event) => updateDraft({ secret: withWebhookUrl(channelDraft.secret, event.target.value) })}
                    />
                    <small className="helper-text">Stored in your OS keychain and used only for outbound delivery.</small>
                  </label>

                  <details className="advanced-editor">
                    <summary>Advanced secret JSON</summary>
                    <JsonEditorField
                      label="Advanced secret JSON"
                      value={getSecretRecord(channelDraft.secret)}
                      fallback={{}}
                      onValidChange={(value) => updateDraft({ secret: value as Record<string, unknown> })}
                    />
                  </details>
                </>
              )}

              {channelDraft.kind === "smtp" &&
                smtpFields.map((field) => (
                  <label key={field.key} className="field">
                    <span>{field.label}</span>
                    <input
                      value={String(field.value ?? "")}
                      onChange={(event) =>
                        updateDraftConfig({
                          [field.key]: "numeric" in field && field.numeric ? Number(event.target.value) : event.target.value,
                        })
                      }
                    />
                  </label>
                ))}

              {channelDraft.kind === "smtp" ? (
                <JsonEditorField
                  label="Secret JSON"
                  value={channelDraft.secret ?? {}}
                  fallback={{}}
                  onValidChange={(value) => updateDraft({ secret: value as Record<string, unknown> })}
                />
              ) : null}

              {channelDraft.kind === "http" && (
                <>
                  <label className="field">
                    <span>Endpoint URL</span>
                    <input
                      placeholder="https://example.com/webhooks/alerts"
                      value={getHttpUrl(channelDraft.secret)}
                      onChange={(event) => updateDraft({ secret: withHttpUrl(channelDraft.secret, event.target.value) })}
                    />
                    <small className="helper-text">
                      Stored in your OS keychain so the request destination stays out of exports.
                    </small>
                  </label>

                  <div className="field-grid">
                    <label className="field">
                      <span>Method</span>
                      <select value={httpConfig.method} onChange={(event) => updateDraftConfig({ method: event.target.value })}>
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="PATCH">PATCH</option>
                      </select>
                    </label>

                    <div className="field">
                      <span>Body mode</span>
                      <div className="segmented-control">
                        {(["json", "raw"] as HttpBodyMode[]).map((mode) => (
                          <button
                            key={mode}
                            type="button"
                            className={`button segmented-button ${httpConfig.bodyMode === mode ? "button-primary" : ""}`}
                            onClick={() => updateDraftConfig({ bodyMode: mode })}
                          >
                            {mode === "json" ? "JSON" : "Raw"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <JsonEditorField
                    label="Headers JSON"
                    value={channelDraft.config.headers ?? {}}
                    fallback={{}}
                    rows={5}
                    onValidChange={(value) => updateDraftConfig({ headers: value as Record<string, unknown> })}
                  />

                  <div className="stack stack-tight http-builder-panel">
                    <div className="section-card-header">
                      <div>
                        <h2>Body template</h2>
                        <p className="helper-text">
                          Use placeholders in URL, headers, and body to customize outbound webhooks.
                        </p>
                      </div>
                      <div className="button-row">
                        {HTTP_TEMPLATE_PRESETS.map((preset) => (
                          <button key={preset.id} type="button" className="button" onClick={() => applyHttpPreset(preset.id)}>
                            {preset.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="field">
                      <span>Body template</span>
                      <textarea
                        ref={httpBodyTemplateRef}
                        rows={12}
                        value={httpConfig.bodyTemplate}
                        onChange={(event) => updateDraftConfig({ bodyTemplate: event.target.value })}
                      />
                      <small className="helper-text">
                        JSON mode keeps structured values typed. Raw mode interpolates everything into plain text.
                      </small>
                    </label>
                  </div>

                  <div className="http-builder-grid">
                    <section className="template-card">
                      <div className="section-card-header">
                        <div>
                          <strong>Template variables</strong>
                          <p>Insert or copy the placeholders available to URL, headers, and body templates.</p>
                        </div>
                      </div>
                      <div className="stack stack-tight">
                        {HTTP_VARIABLES.map((variable) => (
                          <div key={variable.key} className="variable-row">
                            <div>
                              <code>{variable.token}</code>
                              <p>{variable.description}</p>
                            </div>
                            <div className="button-row">
                              <button type="button" className="button" onClick={() => insertHttpToken(variable.token)}>
                                Insert
                              </button>
                              <button type="button" className="button" onClick={() => void copyHttpToken(variable.token)}>
                                Copy
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <section className="template-card">
                      <div className="section-card-header">
                        <div>
                          <strong>Rendered request preview</strong>
                          <p>Preview uses the same sample payload as “Send test” for stable, repeatable output.</p>
                        </div>
                        <span className="status-chip">{httpPreview?.bodyMode.toUpperCase()}</span>
                      </div>
                      {httpPreview?.errors.length ? (
                        <div className="notice notice-danger">
                          {httpPreview.errors.map((error) => (
                            <div key={error}>{error}</div>
                          ))}
                        </div>
                      ) : null}
                      <div className="stack stack-tight">
                        <label className="field">
                          <span>URL</span>
                          <pre className="preview-block">{httpPreview?.url ?? ""}</pre>
                        </label>
                        <label className="field">
                          <span>Method</span>
                          <pre className="preview-block">{httpPreview?.method ?? httpConfig.method}</pre>
                        </label>
                        <label className="field">
                          <span>Headers</span>
                          <pre className="preview-block">
                            {JSON.stringify(httpPreview?.headers ?? getHeaderRecord(channelDraft.config.headers), null, 2)}
                          </pre>
                        </label>
                        <label className="field">
                          <span>Body</span>
                          <pre className="preview-block">{httpPreview?.renderedBody ?? ""}</pre>
                        </label>
                      </div>
                    </section>
                  </div>

                  <details className="advanced-editor">
                    <summary>Advanced secret JSON</summary>
                    <JsonEditorField
                      label="Advanced secret JSON"
                      value={getSecretRecord(channelDraft.secret)}
                      fallback={{}}
                      onValidChange={(value) => updateDraft({ secret: value as Record<string, unknown> })}
                    />
                  </details>
                </>
              )}

              {validationErrors.length > 0 ? (
                <div className="notice notice-danger">
                  {validationErrors.map((error) => (
                    <div key={error}>{error}</div>
                  ))}
                </div>
              ) : null}

              <div className="button-row">
                <button className="button button-primary" disabled={saveDisabled} onClick={() => saveChannelMutation.mutate()}>
                  {saveChannelMutation.isPending ? "Saving..." : "Save channel"}
                </button>
                <button
                  className="button"
                  onClick={() => {
                    setChannelDraft(blankChannel());
                    setEditingSecretChannelId(null);
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function validateChannelDraft(draft: NotificationChannelInput, httpErrors: string[], editingSecretLoading: boolean): string[] {
  const errors = new Set<string>();

  if (!draft.name.trim()) {
    errors.add("Channel name is required.");
  }

  if (editingSecretLoading) {
    errors.add("Stored secret is still loading.");
  }

  if (draft.kind === "slack" || draft.kind === "discord") {
    if (!getWebhookUrl(draft.secret).trim()) {
      errors.add("Webhook URL is required.");
    }
  }

  if (draft.kind === "http") {
    if (!getHttpUrl(draft.secret).trim()) {
      errors.add("Endpoint URL is required.");
    }

    for (const error of httpErrors) {
      errors.add(error);
    }
  }

  return [...errors];
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function toChannelDraft(channel: NotificationChannel): NotificationChannelInput {
  const nextDraft = blankChannel(channel.kind);

  return {
    id: channel.id,
    kind: channel.kind,
    name: channel.name,
    enabled: channel.enabled,
    config: {
      ...nextDraft.config,
      ...channel.config,
    },
    secret: null,
  };
}

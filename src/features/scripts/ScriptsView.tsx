import Editor from "@monaco-editor/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDeferredValue, useEffect, useMemo, useState } from "react";

import { JsonEditorField } from "../../components/JsonEditorField";
import { api } from "../../lib/tauri";
import { showErrorToast, showSuccessToast } from "../../lib/toast";
import { readLastSelectedScriptId, useUiStore, writeLastSelectedScriptId } from "../../store/ui";
import type { ScriptDetail, ScriptInput, TriggerDefinition, TriggerKind, ScriptSummary } from "../../types/api";
import { exampleTemplates } from "./examples";
import { configureScriptMonaco } from "./monacoSetup";

const emptyScript = (): ScriptInput => ({
  name: "Untitled Script",
  description: "",
  code: `console.log("Hello from Superpower OSS");`,
  enabled: true,
  manualRunEnabled: true,
  triggers: [
    {
      kind: "cron",
      enabled: true,
      config: {
        label: "Every hour",
        cron: "0 * * * *",
      },
    },
  ],
  policy: {
    notifyOnFailure: false,
    notifyOnSuccess: false,
    maxRunSeconds: null,
  },
});

export function ScriptsView() {
  const queryClient = useQueryClient();
  const selectedScriptId = useUiStore((state) => state.selectedScriptId);
  const scriptCreateRequestId = useUiStore((state) => state.scriptCreateRequestId);
  const setSelectedScriptId = useUiStore((state) => state.setSelectedScriptId);

  const scriptsQuery = useQuery({
    queryKey: ["scripts"],
    queryFn: api.listScripts,
  });
  const scriptQuery = useQuery({
    queryKey: ["scripts", selectedScriptId],
    queryFn: () => api.getScript(selectedScriptId ?? ""),
    enabled: Boolean(selectedScriptId),
  });

  const [draft, setDraft] = useState<ScriptInput>(emptyScript);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isExplicitCreateMode, setIsExplicitCreateMode] = useState(false);
  const deferredSearchQuery = useDeferredValue(searchQuery);

  useEffect(() => {
    if (!scriptQuery.data) {
      return;
    }

    setIsExplicitCreateMode(false);
    setEditingId(scriptQuery.data.id);
    setDraft(toScriptInput(scriptQuery.data));
  }, [scriptQuery.data]);

  useEffect(() => {
    if (scriptCreateRequestId === 0) {
      return;
    }

    startCreateMode();
  }, [scriptCreateRequestId]);

  useEffect(() => {
    if (scriptsQuery.isLoading || isExplicitCreateMode) {
      return;
    }

    const scripts = scriptsQuery.data ?? [];

    if (scripts.length === 0) {
      if (selectedScriptId !== null) {
        setSelectedScriptId(null);
      }
      if (editingId !== null) {
        setEditingId(null);
        setDraft(emptyScript());
      }
      return;
    }

    if (selectedScriptId && scripts.some((script) => script.id === selectedScriptId)) {
      return;
    }

    const rememberedScriptId = readLastSelectedScriptId();
    const nextScriptId = scripts.find((script) => script.id === rememberedScriptId)?.id ?? scripts[0]?.id ?? null;

    if (nextScriptId) {
      setSelectedScriptId(nextScriptId);
      writeLastSelectedScriptId(nextScriptId);
    }
  }, [editingId, isExplicitCreateMode, scriptsQuery.data, scriptsQuery.isLoading, selectedScriptId, setSelectedScriptId]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editingId) {
        return api.updateScript(editingId, draft);
      }

      return api.createScript(draft);
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["scripts"] });
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      setIsExplicitCreateMode(false);
      setSelectedScriptId(saved.id);
      setEditingId(saved.id);
      writeLastSelectedScriptId(saved.id);
      showSuccessToast(editingId ? "Script updated" : "Script created");
    },
    onError: (error) => {
      showErrorToast(error, editingId ? "Failed to update script" : "Failed to create script");
    },
  });

  const runMutation = useMutation({
    mutationFn: async (scriptId: string) => api.runScriptNow(scriptId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      showSuccessToast("Run started");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to start run");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (scriptId: string) => api.duplicateScript(scriptId),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["scripts"] });
      setIsExplicitCreateMode(false);
      setSelectedScriptId(saved.id);
      setEditingId(saved.id);
      writeLastSelectedScriptId(saved.id);
      showSuccessToast("Script duplicated");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to duplicate script");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (scriptId: string) => api.deleteScript(scriptId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["scripts"] });
      await queryClient.invalidateQueries({ queryKey: ["runs"] });
      setIsExplicitCreateMode(false);
      setSelectedScriptId(null);
      setEditingId(null);
      setDraft(emptyScript());
      showSuccessToast("Script deleted");
    },
    onError: (error) => {
      showErrorToast(error, "Failed to delete script");
    },
  });

  const templates = useMemo(() => exampleTemplates, []);
  const filteredScripts = useMemo(
    () => filterScripts(scriptsQuery.data ?? [], deferredSearchQuery),
    [deferredSearchQuery, scriptsQuery.data],
  );

  const hasScripts = (scriptsQuery.data?.length ?? 0) > 0;
  const isRestoringSelection =
    !isExplicitCreateMode &&
    (scriptsQuery.isLoading || (hasScripts && selectedScriptId === null && editingId === null));
  const isCreateMode = !isRestoringSelection && (isExplicitCreateMode || (!hasScripts && selectedScriptId === null));
  const isSaveDisabled = saveMutation.isPending || !draft.name.trim() || !draft.code.trim();
  const isActionDisabled =
    saveMutation.isPending || runMutation.isPending || duplicateMutation.isPending || deleteMutation.isPending;
  const activeScriptSummary =
    scriptsQuery.data?.find((script) => script.id === editingId) ??
    scriptsQuery.data?.find((script) => script.id === selectedScriptId) ??
    null;
  const currentLastRunAt = scriptQuery.data?.lastRunAt ?? activeScriptSummary?.lastRunAt ?? null;

  function startCreateMode() {
    setIsExplicitCreateMode(true);
    setSelectedScriptId(null);
    setEditingId(null);
    setDraft(emptyScript());
  }

  return (
    <section className="dashboard-page scripts-page">
      <div className="page-header">
        <div>
          <p className="eyebrow">Automation</p>
          <h1>{isCreateMode ? "Create script" : "Scripts workspace"}</h1>
          <p className="section-copy">
            Manage script metadata, edit Bun code, and tune scheduling without leaving the dashboard.
          </p>
        </div>
        <div className="page-actions">
          {editingId ? (
            <>
              <button className="button" disabled={isActionDisabled} onClick={() => duplicateMutation.mutate(editingId)}>
                {duplicateMutation.isPending ? "Duplicating..." : "Duplicate"}
              </button>
              <button className="button" disabled={isActionDisabled} onClick={() => runMutation.mutate(editingId)}>
                {runMutation.isPending ? "Starting..." : "Run now"}
              </button>
              <button
                className="button button-danger"
                disabled={isActionDisabled}
                onClick={() => deleteMutation.mutate(editingId)}
              >
                {deleteMutation.isPending ? "Deleting..." : "Delete"}
              </button>
            </>
          ) : null}
          <button className="button" disabled={isActionDisabled} onClick={() => startCreateMode()}>
            New script
          </button>
          <button
            className="button button-primary"
            disabled={isRestoringSelection || isSaveDisabled}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Saving..." : editingId ? "Save changes" : "Create script"}
          </button>
        </div>
      </div>

      <section className="scripts-workspace">
        <aside className="section-card catalog-rail">
          <div className="section-card-header">
            <div>
              <p className="eyebrow">Catalog</p>
              <h2>Your automations</h2>
            </div>
            <span className="status-chip">{scriptsQuery.data?.length ?? 0} total</span>
          </div>

          <div className="stack stack-tight">
            <label className="field">
              <span>Search</span>
              <input
                placeholder="Filter by name or description"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>

            <div className="catalog-summary">
              <div>
                <small>Enabled</small>
                <strong>{(scriptsQuery.data ?? []).filter((script) => script.enabled).length}</strong>
              </div>
              <div>
                <small>Recent runs</small>
                <strong>{(scriptsQuery.data ?? []).filter((script) => script.lastRunAt).length}</strong>
              </div>
            </div>
          </div>

          <div className="stack script-list">
            {filteredScripts.length > 0 ? (
              filteredScripts.map((script) => (
                <button
                  key={script.id}
                  className={`list-item list-item-script ${selectedScriptId === script.id ? "selected" : ""}`}
                  onClick={() => {
                    setIsExplicitCreateMode(false);
                    setSelectedScriptId(script.id);
                    writeLastSelectedScriptId(script.id);
                  }}
                >
                  <div className="list-item-content">
                    <div className="card-row">
                      <strong>{script.name}</strong>
                      <span className={`status-chip ${script.enabled ? "active" : "muted"}`}>
                        {script.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p>{script.description || "No description yet."}</p>
                    <div className="meta-row">
                      <small>{script.triggerCount} trigger{script.triggerCount === 1 ? "" : "s"}</small>
                      <small>{formatLastRun(script.lastRunAt)}</small>
                    </div>
                  </div>
                </button>
              ))
            ) : (
              <div className="empty-state panel-muted">
                {searchQuery ? "No scripts match that search." : "Create your first automation to start scheduling runs."}
              </div>
            )}
          </div>

          {isCreateMode ? (
            <details className="advanced-editor" open>
              <summary>Starter blueprints</summary>
              <p className="section-copy">Use a built-in example to bootstrap a monitor, poller, or alert flow.</p>
              <div className="stack">
                {templates.map((template) => (
                  <article key={template.title} className="template-card">
                    <div className="stack stack-tight">
                      <div>
                        <strong>{template.title}</strong>
                        <p>{template.description}</p>
                      </div>
                      <small>{template.summary}</small>
                    </div>
                    <button
                      className="button"
                      onClick={() => {
                        setIsExplicitCreateMode(true);
                        setSelectedScriptId(null);
                        setEditingId(null);
                        setDraft(structuredClone(template.script));
                      }}
                    >
                      Use template
                    </button>
                  </article>
                ))}
              </div>
            </details>
          ) : null}
        </aside>

        <div className="scripts-editor-column">
          <section className="summary-strip">
            <article className="summary-card">
              <small>Status</small>
              <strong>{draft.enabled ? "Enabled" : "Disabled"}</strong>
            </article>
            <article className="summary-card">
              <small>Tray access</small>
              <strong>{draft.manualRunEnabled ? "Visible" : "Hidden"}</strong>
            </article>
            <article className="summary-card">
              <small>Triggers</small>
              <strong>{draft.triggers.length}</strong>
            </article>
            <article className="summary-card">
              <small>Last run</small>
              <strong>{formatLastRun(currentLastRunAt)}</strong>
            </article>
          </section>

          <section className="scripts-editor-grid">
            <section className="section-card section-card-strong editor-card">
              <div className="section-card-header">
                <div>
                  <p className="eyebrow">Workspace</p>
                  <h2>{isRestoringSelection ? "Loading workspace" : editingId ? draft.name || "Edit script" : "Create script"}</h2>
                  <p className="section-copy">
                    {isRestoringSelection
                      ? "Restoring your last script selection."
                      : "Use the editor for runtime logic and the side panels for metadata, policies, and triggers."}
                  </p>
                </div>
              </div>

              {isRestoringSelection ? (
                <div className="empty-state panel-muted">Loading your last script…</div>
              ) : (
                <>
                  <div className="editor-toolbar">
                    <div>
                      <p className="eyebrow">Bun runtime</p>
                      <strong>Script body</strong>
                    </div>
                    <small className="helper-text">`notify()` and `runContext` are typed inside the editor.</small>
                  </div>
                  <Editor
                    beforeMount={configureScriptMonaco}
                    path={editingId ? `file:///scripts/${editingId}.mts` : "file:///scripts/untitled.mts"}
                    language="typescript"
                    theme="vs-dark"
                    height="580px"
                    value={draft.code}
                    loading={<div className="editor-loading">Loading editor…</div>}
                    onChange={(value) => setDraft({ ...draft, code: value ?? "" })}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 14,
                      lineHeight: 22,
                      padding: { top: 16, bottom: 16 },
                      wordWrap: "on",
                      scrollBeyondLastLine: false,
                      tabSize: 2,
                      automaticLayout: true,
                      quickSuggestions: true,
                      suggestOnTriggerCharacters: true,
                    }}
                  />
                </>
              )}
            </section>

            <div className="scripts-side-stack">
              <section className="section-card">
                <div className="section-card-header">
                  <div>
                    <p className="eyebrow">Configuration</p>
                    <h2>Metadata and runtime</h2>
                  </div>
                </div>
                <div className="stack">
                  <div className="field-grid">
                    <label className="field field-span">
                      <span>Name</span>
                      <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                    </label>
                    <label className="field field-span">
                      <span>Description</span>
                      <textarea
                        rows={3}
                        value={draft.description}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      />
                    </label>
                  </div>
                  <div className="toggle-row">
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                      />
                      Enabled
                    </label>
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={draft.manualRunEnabled}
                        onChange={(event) => setDraft({ ...draft, manualRunEnabled: event.target.checked })}
                      />
                      Show in tray menu
                    </label>
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={draft.policy.notifyOnFailure}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            policy: { ...draft.policy, notifyOnFailure: event.target.checked },
                          })
                        }
                      />
                      Notify on failure
                    </label>
                    <label className="toggle-inline">
                      <input
                        type="checkbox"
                        checked={draft.policy.notifyOnSuccess}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            policy: { ...draft.policy, notifyOnSuccess: event.target.checked },
                          })
                        }
                      />
                      Notify on success
                    </label>
                  </div>
                </div>
              </section>

              <section className="section-card">
                <div className="section-card-header">
                  <div>
                    <p className="eyebrow">Triggers</p>
                    <h2>Schedule and monitors</h2>
                  </div>
                  <button
                    className="button"
                    disabled={isActionDisabled}
                    onClick={() => {
                      setDraft({
                        ...draft,
                        triggers: [
                          ...draft.triggers,
                          {
                            kind: "cron",
                            enabled: true,
                            config: { label: "New cron trigger", cron: "0 * * * *" },
                          },
                        ],
                      });
                    }}
                  >
                    Add trigger
                  </button>
                </div>
                <div className="stack">
                  {draft.triggers.length > 0 ? (
                    draft.triggers.map((trigger, index) => (
                      <TriggerEditor
                        key={`${trigger.kind}-${index}`}
                        trigger={trigger}
                        onChange={(next) =>
                          setDraft({
                            ...draft,
                            triggers: draft.triggers.map((item, itemIndex) => (itemIndex === index ? next : item)),
                          })
                        }
                        onDelete={() =>
                          setDraft({
                            ...draft,
                            triggers: draft.triggers.filter((_, itemIndex) => itemIndex !== index),
                          })
                        }
                      />
                    ))
                  ) : (
                    <div className="empty-state">Add at least one trigger to schedule this script automatically.</div>
                  )}
                </div>
              </section>
            </div>
          </section>
        </div>
      </section>
    </section>
  );
}

function TriggerEditor({
  trigger,
  onChange,
  onDelete,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
  onDelete: () => void;
}) {
  const kind = trigger.kind;

  return (
    <article className="trigger-card">
      <div className="trigger-card-header">
        <label className="field">
          <span>Trigger type</span>
          <select value={kind} onChange={(event) => onChange(defaultTrigger(event.target.value as TriggerKind))}>
            <option value="cron">Cron</option>
            <option value="uptime">Uptime</option>
            <option value="file_watch">File watcher</option>
            <option value="api_poll">API poll</option>
          </select>
        </label>
        <label className="toggle-inline">
          <input
            type="checkbox"
            checked={trigger.enabled}
            onChange={(event) => onChange({ ...trigger, enabled: event.target.checked })}
          />
          Enabled
        </label>
        <button className="button button-danger" onClick={onDelete}>
          Remove
        </button>
      </div>
      {kind === "cron" ? <CronFields trigger={trigger} onChange={onChange} /> : null}
      {kind === "uptime" ? <UptimeFields trigger={trigger} onChange={onChange} /> : null}
      {kind === "file_watch" ? <FileWatchFields trigger={trigger} onChange={onChange} /> : null}
      {kind === "api_poll" ? <ApiPollFields trigger={trigger} onChange={onChange} /> : null}
    </article>
  );
}

function CronFields({
  trigger,
  onChange,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
}) {
  return (
    <div className="trigger-grid">
      <TextField
        label="Label"
        value={stringValue(trigger.config.label, "Hourly")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, label: value } })}
      />
      <TextField
        label="Cron"
        value={stringValue(trigger.config.cron, "0 * * * *")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, cron: value } })}
      />
    </div>
  );
}

function UptimeFields({
  trigger,
  onChange,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
}) {
  return (
    <div className="trigger-grid">
      <TextField
        label="Name"
        value={stringValue(trigger.config.name, "Website health")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, name: value } })}
      />
      <TextField
        label="URL"
        value={stringValue(trigger.config.url, "https://example.com")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, url: value } })}
      />
      <SelectField
        label="Method"
        value={stringValue(trigger.config.method, "GET")}
        options={["GET", "HEAD"]}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, method: value } })}
      />
      <NumberField
        label="Interval seconds"
        value={numberValue(trigger.config.intervalSeconds, 60)}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, intervalSeconds: value } })}
      />
      <NumberField
        label="Timeout seconds"
        value={numberValue(trigger.config.timeoutSeconds, 15)}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, timeoutSeconds: value } })}
      />
    </div>
  );
}

function FileWatchFields({
  trigger,
  onChange,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
}) {
  const eventTypes = Array.isArray(trigger.config.eventTypes)
    ? (trigger.config.eventTypes as string[])
    : ["modify"];

  return (
    <div className="trigger-grid">
      <TextField
        label="Name"
        value={stringValue(trigger.config.name, "Workspace watcher")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, name: value } })}
      />
      <TextField
        label="Path"
        value={stringValue(trigger.config.path, ".")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, path: value } })}
      />
      <NumberField
        label="Debounce ms"
        value={numberValue(trigger.config.debounceMs, 1200)}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, debounceMs: value } })}
      />
      <label className="toggle-inline">
        <input
          type="checkbox"
          checked={booleanValue(trigger.config.recursive, true)}
          onChange={(event) => onChange({ ...trigger, config: { ...trigger.config, recursive: event.target.checked } })}
        />
        Recursive
      </label>
      <label className="field field-span">
        <span>Event types</span>
        <div className="checkbox-row">
          {["create", "modify", "delete"].map((eventType) => (
            <label key={eventType}>
              <input
                type="checkbox"
                checked={eventTypes.includes(eventType)}
                onChange={(event) =>
                  onChange({
                    ...trigger,
                    config: {
                      ...trigger.config,
                      eventTypes: event.target.checked
                        ? [...eventTypes, eventType]
                        : eventTypes.filter((value) => value !== eventType),
                    },
                  })
                }
              />
              {eventType}
            </label>
          ))}
        </div>
      </label>
    </div>
  );
}

function ApiPollFields({
  trigger,
  onChange,
}: {
  trigger: TriggerDefinition;
  onChange: (trigger: TriggerDefinition) => void;
}) {
  return (
    <div className="trigger-grid">
      <TextField
        label="Name"
        value={stringValue(trigger.config.name, "API poll")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, name: value } })}
      />
      <TextField
        label="URL"
        value={stringValue(trigger.config.url, "https://example.com/api")}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, url: value } })}
      />
      <SelectField
        label="Method"
        value={stringValue(trigger.config.method, "GET")}
        options={["GET", "POST", "PUT"]}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, method: value } })}
      />
      <NumberField
        label="Interval seconds"
        value={numberValue(trigger.config.intervalSeconds, 120)}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, intervalSeconds: value } })}
      />
      <NumberField
        label="Timeout seconds"
        value={numberValue(trigger.config.timeoutSeconds, 20)}
        onChange={(value) => onChange({ ...trigger, config: { ...trigger.config, timeoutSeconds: value } })}
      />
      <JsonEditorField
        label="Headers JSON"
        rows={3}
        value={trigger.config.headers ?? {}}
        fallback={{}}
        onValidChange={(value) =>
          onChange({
            ...trigger,
            config: {
              ...trigger.config,
              headers: value,
            },
          })
        }
      />
      <JsonEditorField
        label="Body JSON"
        rows={3}
        value={trigger.config.body ?? null}
        fallback={null}
        onValidChange={(value) =>
          onChange({
            ...trigger,
            config: {
              ...trigger.config,
              body: value,
            },
          })
        }
      />
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="number" value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function defaultTrigger(kind: TriggerKind): TriggerDefinition {
  switch (kind) {
    case "cron":
      return { kind, enabled: true, config: { label: "Every hour", cron: "0 * * * *" } };
    case "uptime":
      return {
        kind,
        enabled: true,
        config: {
          name: "Website health",
          url: "https://dns.google",
          method: "GET",
          intervalSeconds: 60,
          timeoutSeconds: 15,
        },
      };
    case "file_watch":
      return {
        kind,
        enabled: true,
        config: { name: "Workspace watcher", path: ".", recursive: true, debounceMs: 1000, eventTypes: ["modify"] },
      };
    case "api_poll":
      return {
        kind,
        enabled: true,
        config: {
          name: "API poll",
          url: "https://example.com/api",
          method: "GET",
          intervalSeconds: 120,
          timeoutSeconds: 20,
          headers: {},
          body: null,
        },
      };
  }
}

function filterScripts(scripts: ScriptSummary[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return scripts;
  }

  return scripts.filter((script) => {
    const haystack = `${script.name} ${script.description}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function formatLastRun(lastRunAt: string | null) {
  if (!lastRunAt) {
    return "Never run";
  }

  return `Last run ${new Date(lastRunAt).toLocaleString()}`;
}

function toScriptInput(script: ScriptDetail): ScriptInput {
  return {
    name: script.name,
    description: script.description,
    code: script.code,
    enabled: script.enabled,
    manualRunEnabled: script.manualRunEnabled,
    triggers: script.triggers.map((trigger) => ({ ...trigger, id: undefined })),
    policy: script.policy,
  };
}

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

import type { Monaco } from "@monaco-editor/react";

let runtimeLibDisposable: { dispose: () => void } | null = null;

export function buildRuntimeTypeDeclarations() {
  return `type NotifyLevel = "info" | "success" | "warn" | "error";

interface NotifyInput {
  title?: string;
  message: string;
  level?: NotifyLevel;
  channel?: string;
  metadata?: unknown;
}

declare function notify(input: NotifyInput): Promise<void>;

interface RunContextTrigger {
  kind: "manual" | "cron" | "uptime" | "file_watch" | "api_poll";
  label: string;
  firedAt: string;
}

interface RunContext {
  scriptId: string;
  scriptName: string;
  trigger: RunContextTrigger;
  payload?: unknown;
}

declare const runContext: RunContext;
`;
}

export function configureScriptMonaco(monaco: Monaco) {
  const { ModuleKind, ModuleResolutionKind, ScriptTarget } = monaco.languages.typescript;

  monaco.languages.typescript.typescriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
    diagnosticCodesToIgnore: [1375, 1378],
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions({
    allowNonTsExtensions: true,
    module: ModuleKind.ES2022,
    moduleResolution: ModuleResolutionKind.NodeJs,
    moduleDetection: 3,
    target: ScriptTarget.ES2022,
    strict: true,
  });

  runtimeLibDisposable?.dispose();
  runtimeLibDisposable = monaco.languages.typescript.typescriptDefaults.addExtraLib(
    buildRuntimeTypeDeclarations(),
    "file:///superpower-runtime.d.ts",
  );
}

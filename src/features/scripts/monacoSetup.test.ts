import { describe, expect, it } from "vitest";

import { buildRuntimeTypeDeclarations } from "./monacoSetup";

describe("buildRuntimeTypeDeclarations", () => {
  it("declares the runtime helper globals and notify payload shape", () => {
    const declarations = buildRuntimeTypeDeclarations();

    expect(declarations).toContain('type NotifyLevel = "info" | "success" | "warn" | "error";');
    expect(declarations).toContain("message: string;");
    expect(declarations).toContain("declare function notify(input: NotifyInput): Promise<void>;");
    expect(declarations).toContain('kind: "manual" | "cron" | "uptime" | "file_watch" | "api_poll";');
    expect(declarations).toContain("declare const runContext: RunContext;");
  });
});

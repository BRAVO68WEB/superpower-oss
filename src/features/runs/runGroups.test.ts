import { describe, expect, it } from "vitest";

import type { RunSummary } from "../../types/api";
import { getRunSortValue, groupRunsByScript } from "./runGroups";

const runs: RunSummary[] = [
  {
    id: "run-1",
    scriptId: "script-a",
    scriptName: "Revenue Digest",
    triggerKind: "cron",
    triggerLabel: "08:00",
    status: "success",
    startedAt: "2026-04-23T08:00:00.000Z",
    finishedAt: "2026-04-23T08:00:05.000Z",
    durationMs: 5000,
    exitCode: 0,
    errorSummary: null,
    coalescedCount: 0,
  },
  {
    id: "run-2",
    scriptId: "script-b",
    scriptName: "Queue Monitor",
    triggerKind: "api_poll",
    triggerLabel: "Queue depth poller",
    status: "failure",
    startedAt: "2026-04-23T09:00:00.000Z",
    finishedAt: "2026-04-23T09:00:03.000Z",
    durationMs: 3000,
    exitCode: 1,
    errorSummary: "Queue threshold breached",
    coalescedCount: 0,
  },
  {
    id: "run-3",
    scriptId: "script-a",
    scriptName: "Revenue Digest",
    triggerKind: "manual",
    triggerLabel: "Manual run",
    status: "running",
    startedAt: "2026-04-23T10:00:00.000Z",
    finishedAt: null,
    durationMs: null,
    exitCode: null,
    errorSummary: null,
    coalescedCount: 0,
  },
];

describe("groupRunsByScript", () => {
  it("groups flat run history by script and sorts groups by latest run", () => {
    const groups = groupRunsByScript(runs);

    expect(groups).toHaveLength(2);
    expect(groups[0]?.scriptId).toBe("script-a");
    expect(groups[0]?.runs.map((run) => run.id)).toEqual(["run-3", "run-1"]);
    expect(groups[1]?.scriptId).toBe("script-b");
  });
});

describe("getRunSortValue", () => {
  it("returns zero for runs with no timestamps", () => {
    expect(
      getRunSortValue({
        ...runs[0],
        id: "run-4",
        startedAt: null,
        finishedAt: null,
      }),
    ).toBe(0);
  });
});

import type { RunSummary } from "../../types/api";

export type RunGroup = {
  scriptId: string;
  scriptName: string;
  latestRun: RunSummary;
  runs: RunSummary[];
};

export function groupRunsByScript(runs: RunSummary[]) {
  const grouped = new Map<string, RunSummary[]>();

  for (const run of runs) {
    const existing = grouped.get(run.scriptId);
    if (existing) {
      existing.push(run);
      continue;
    }

    grouped.set(run.scriptId, [run]);
  }

  return [...grouped.entries()]
    .map(([scriptId, scriptRuns]) => {
      const runsForScript = [...scriptRuns].sort((left, right) => getRunSortValue(right) - getRunSortValue(left));

      return {
        scriptId,
        scriptName: runsForScript[0]?.scriptName ?? "Untitled script",
        latestRun: runsForScript[0],
        runs: runsForScript,
      } satisfies RunGroup;
    })
    .sort((left, right) => getRunSortValue(right.latestRun) - getRunSortValue(left.latestRun));
}

export function getRunSortValue(run: RunSummary) {
  const timestamp = run.startedAt ?? run.finishedAt ?? null;

  if (!timestamp) {
    return 0;
  }

  return Date.parse(timestamp) || 0;
}

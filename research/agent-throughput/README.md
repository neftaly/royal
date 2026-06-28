# Agent Throughput Research

Date: 2026-06-28

## Scope

This research area measures whether running more agents in parallel actually
increases landed, green work. It stays under `research/agent-throughput` and
does not change app code, package exports, build config, or CI wiring.

The first pass uses local git history only. It is intended to expose merge and
CI repair pressure, not to assign blame for individual commits.

## Marshal Protocol

Use [worker-protocol.md](worker-protocol.md) as the reusable marshal protocol
for worker saturation, task classes, commit policy, batch merges, handoff gates,
WIP examples, and periodic API/decomplection reviews.

The marshal loop is:

1. Inspect recent churn and active failures.
2. Fill 70-85% of worker slots, reserving 2-4 slots for CI, integration, and
   blocking audits.
3. Assign safe parallel research/docs and package-local work freely when scopes
   are disjoint.
4. Serialize high-churn paths, root/shared config, generated examples, public
   package exports, and coupled API breaks.
5. Use read-only scouts to unblock unclear ownership before opening edit slots.
6. Batch coupled API changes through an integration worker, then publish the new
   boundary and remaining failures.
7. Run the pre-handoff checks for each task class before merge or handoff.
8. Re-run the analyzer and decomplection/blocking review after each material
   merge batch.

## What We Measure

- Commit-to-green time: how long a feature commit waits before the branch is
  green again. Local git history cannot see CI timestamps by itself, so paste CI
  rows into a sidecar file when available.
- CI failure/fix churn: follow-up commits whose subjects look like `Fix`,
  `test`, `typecheck`, `lint`, `build`, or similar repair work.
- Path overlap: top-level scopes and exact files touched by multiple recent
  commits.
- Shared-worktree dirty-state risk: lockfiles, root configs, package-boundary
  tests, generated examples, and other broad files that are easy to dirty while
  another worker is mid-flight.
- Breadth value versus merge cost: whether spreading work over many packages or
  apps keeps worker slots saturated, or just creates more serialized repair and
  conflict work.

## Analyzer

Run the local analyzer:

```sh
node research/agent-throughput/analyze-throughput.mjs
```

Write JSON for repeatable comparison:

```sh
node research/agent-throughput/analyze-throughput.mjs --format json --out research/agent-throughput/reports/latest.json
```

Useful knobs:

```sh
node research/agent-throughput/analyze-throughput.mjs --max-count 75
node research/agent-throughput/analyze-throughput.mjs --since 2026-06-01
node research/agent-throughput/analyze-throughput.mjs --ci-json /tmp/ci-runs.json --format json
```

`--ci-json` is optional and never fetched from the network. Keep it manually
pasteable. The expected shape is an array of rows like:

```json
[
  {
    "sha": "abc1234",
    "status": "success",
    "startedAt": "2026-06-28T01:00:00Z",
    "completedAt": "2026-06-28T01:12:00Z"
  }
]
```

When CI rows are present, the report includes rough commit-to-green minutes by
matching each commit hash to the pasted status data. Without that file, CI is
reported as unavailable and the analyzer relies on local repair-pattern signals.

## Process Experiments To Try Next

- Per-worker temp worktrees: give each worker a temporary worktree for risky
  or broad changes, then merge back after local gates pass. Measure whether
  dirty-state interruptions drop.
- Pre-handoff typecheck gates: require `pnpm typecheck` or the smallest
  package-local equivalent before handing off shared files. Measure fix commits
  per feature commit.
- CI split: separate fast type/package-boundary checks from slower browser or
  renderer checks so repair commits identify the failing lane sooner.
- High-churn path serialization: serialize changes to lockfiles, root config,
  package-boundary tests, generated examples, and public package exports.
- Claims only for shared paths: keep claims lightweight for shared or churny
  paths, while allowing disjoint research and app areas to proceed without a
  central gate.

## How To Read The Report

Treat `parallelizableScopes` as candidate lanes for independent workers and
`serializedScopes` as paths that need explicit sequencing. A scope is not bad
because it is busy; it becomes risky when repeated touches, exact-file overlap,
and fix-after-feature commits line up in the same window.

Use `slotPolicy` as the current marshal stance inside the standing protocol:
the target remains 70-85% busy slots with 2-4 reserved emergency slots, while
recent churn determines whether to run near the lower or upper end of that band.

The first checked-in report is a baseline from current local history. Re-run
the analyzer after changing worker rules and compare:

- fix-like commits per feature-like commit
- commits touching serialized scopes
- repeated exact-file touches
- root/shared files touched by multiple commits
- optional commit-to-green minutes when CI rows are pasted

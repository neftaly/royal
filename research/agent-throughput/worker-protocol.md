# Worker Protocol

This protocol gives the marshal a reusable loop for keeping workers saturated
without turning coordination into a central bottleneck.

## Slot Policy

- Keep 70-85% of worker slots busy during normal operation.
- Reserve 2-4 slots for CI failures, integration emergencies, merge repair, and
  short read-only audits.
- Prefer a lower busy target when recent churn is concentrated in shared files,
  public package APIs, root config, lockfiles, or integration tests.
- Prefer a higher busy target only when open work is split across disjoint
  package-local or research/docs scopes.

## Task Classes

- Safe parallel research/docs: isolated notes, reports, and docs that do not
  change package exports, generated examples, or app behavior.
- Package-local workers: changes contained to one package or app and its local
  tests, with no root config, lockfile, or public cross-package API changes.
- High-churn serialized scopes: lockfiles, root package/config, shared test
  harnesses, generated catalogs, public package exports, routing tables, and any
  path touched repeatedly in the current window.
- Read-only scouts: agents that inspect history, failures, logs, or code paths
  and report findings without editing.
- Integration workers: agents assigned to merge, test, resolve coupled failures,
  or repair CI after a batch lands.

## Write And Commit Rules

- Workers may commit directly when the task is isolated, green, and does not
  touch a serialized scope or shared public API.
- Workers should leave changes uncommitted when the marshal needs to inspect or
  combine adjacent edits, when checks are still running, or when the work is a
  small handoff inside an already claimed scope.
- Workers should use branches or temporary worktrees for broad changes, coupled
  API breaks, risky refactors, generated output, dependency changes, or anything
  likely to block another worker through dirty state.
- Read-only scouts do not commit. They hand off concrete findings with paths,
  commands, and blocker status.

## Batch Merge Pattern

Use batch merges for coupled API breaks instead of letting workers race the same
interface.

1. The marshal names the API boundary, expected break, owning batch branch, and
   serialized files.
2. Workers implement package-local adaptations on branches or temp worktrees.
3. The integration worker merges the batch branch, resolves the shared API once,
   and runs the broadest necessary package or repo checks.
4. Follow-up workers only start after the integration worker publishes the new
   boundary and remaining failures.

## Pre-Handoff Checks

- Safe parallel research/docs: `git diff --check` and any doc-specific renderer
  or analyzer touched by the task.
- Package-local workers: focused unit/type/build checks for the package or app,
  plus `git diff --check`.
- High-churn serialized scopes: exact-path review, focused checks, repo-level
  smoke/type/build gate where practical, and marshal approval before merge.
- Read-only scouts: no write checks; include inspected commit range, files, and
  commands in the handoff.
- Integration workers: merge status, full relevant CI-equivalent gates, dirty
  tree review, and explicit list of remaining failures or deferred risks.

## WIP Examples

- Examples must point to real routes only.
- WIP links are allowed only when they reference a concrete artifact or route
  that exists in the branch, report, preview, or checked-in output.
- Do not add placeholder example links, imaginary routes, or future-only
  artifacts to unblock a handoff.

## Review Cadence

- At least once per active marshal block, run an API/decomplection review:
  identify accidental coupling, repeated local workarounds, stale aliases, and
  unclear ownership around touched code.
- Run a blocking audit after each merge batch and whenever worker occupancy
  drops below the target band: list blocked workers, blocked files, missing
  decisions, failing checks, and the next integration slot owner.
- Re-run the throughput analyzer after material coordination changes, compare
  churny scopes and repair commits, and adjust serialized scopes before opening
  more worker slots.

# Rejected key-set usage marking

Date: 2026-09-13. Experiment reverted; no final renderer change or commit.

The frame-preparation pass reconstructs each demanded page key to mark its
resident atlas slot as recently used. An experiment iterated the workspace's
existing key Set instead. It removed five lines and required no new cache or
iteration-order assumption: this pass only writes the same frame timestamp to
the matching slots.

## Isolated result

The benchmark extracts the actual before/after loops and numeric/string key
helper. Eighteen timestamp comparisons pass. Four warmed alternating rounds use
a fixed 16 MiB V8 nursery and prepared workspaces.

| Pages / row offset | Before CPU | Set CPU | Before / Set GC events |
|---|---:|---:|---:|
| 0 / 0 | 14.14 ms | 24.69 ms | 0 / 0 |
| 1 / 0 | 45.09 ms | 29.05 ms | 12 / 0 |
| 21 / 0 | 66.35 ms | 47.12 ms | 0 / 0 |
| 256 / 0 | 120.06 ms | 99.97 ms | 0 / 0 |
| 21 / 1000 | 68.05 ms | 49.25 ms | 8 / 0 |
| 21 / 65536 | 234.78 ms | 39.85 ms | 60 / 0 |

CPU values are per-round medians; iteration counts vary by page count. The last
two rows exercise large packed numeric keys and the string fallback. Empty
workspaces become slower; all nonempty isolated cases improve.

## Renderer result and decision

Headless Intel Iris Xe / ANGLE Vulkan, 16 authored textures sharing an atlas,
600 warmed moving-camera frames:

| Profiled metric | Before | Set iteration |
|---|---:|---:|
| Total sampled allocation | 17,838,340 B | 20,708,584 B |
| Frame-preparation attribution | No samples | 1,770,020 B |
| Submission median / p95 | 0.6 / 0.9 ms | 0.5 / 0.9 ms |
| GC events / time | 14 / 8.353 ms | 16 / 9.418 ms |

The browser result changes the decision. The changed frame-preparation method
gains substantial sampled allocation even though the isolated loop improves.
The profiles do not establish the exact compiler mechanism, but demonstrate why
the small-loop result is insufficient. This candidate is not retained for a
GC-churn task.

Complete final VT snapshots match. Screenshots differ at 218 pixels by at most
one channel value, within the variation previously observed between repeated
baseline captures. All 108 runtime/growth/demand tests, root type checking, lint,
44 GPU source cases and packed consumer checks pass for the candidate. Its browser
bundle nevertheless exceeds existing lazy/deployed limits by 14/10 gzip bytes.
No size allowance was added.

Review checked equality of workspace key membership across collection/truncation
and that iteration cannot mutate demand. The second pass inspected whole-browser
allocation attribution rather than accepting the direct benchmark. The runtime
was restored byte-for-byte to its preceding checkpoint, then rebuilt. All 108
tests and existing bundle limits pass again; syntax/whitespace checks pass.

Evidence: [direct comparison](usage-keys-comparison.json),
[benchmark script](compare-usage-keys.mjs), [before](usage-keys-before.json),
[rejected candidate](usage-keys-after.json), [mapped before](usage-keys-profile-before.json),
[mapped candidate](usage-keys-profile-after.json),
[source cases](usage-keys-source-regression.json), [rejected patch](usage-keys.patch),
[source hashes](usage-keys-sources.json). The hash report's `after` identifies the
rejected candidate; current runtime matches `before`. Reproducing the isolated
comparison uses saved source files via `VT_BASELINE_FILE` and `VT_CANDIDATE_FILE`.

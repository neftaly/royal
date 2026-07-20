# Failures and diagnostics

## Failure taxonomy

Royal distinguishes:

- **author error**: invalid public descriptor/options; throw synchronously at
  the public boundary;
- **content error**: malformed or unsupported required asset semantics; settle
  the exact asset as `error`;
- **component degradation**: renderable asset with one or more failed images;
  settle as `degraded` and retain per-image reasons;
- **resource denial**: capacity policy rejected work; defer, fall back, or
  settle the affected resource without corrupting unrelated content or
  relabeling a successful asset decode as a content failure;
- **renderer interruption**: context lost/restoring; expose lifecycle and
  reconstruct;
- **scheduled-frame failure**: capture and notify observers because there is no
  synchronous caller;
- **explicit-call failure**: throw synchronously from the imperative call;
- **XR acquisition/runtime failure**: update the XR lifecycle owner and release
  only resources actually acquired.

Catch-all fallback MUST NOT collapse these classes into a silent grey object or
an endless loading state.

## Synchronous boundaries

Public constructors and option resolvers reject wrong types, unknown fields,
non-finite values, illegal ranges, and contradictory options synchronously.
They SHOULD use `TypeError` for shape/type failures and `RangeError` for numeric
ranges. Messages identify the Royal operation and field.

`render`, `renderViews`, `pick`, and `flushInvalidated` report failures caused
by that explicit invocation synchronously. A scheduled RAF has no caller, so
its failures go to the render-failure observer and lifecycle where applicable.

## Progressive failure behavior

One failed texture does not make prepared geometry disappear. One failed VT
page falls back to an ancestor/ordinary/neutral representation and uses bounded
retry policy. One failed optional material feature may use valid core glTF
semantics if present. A failed required codec or extension fails the asset.

Failures are terminal until a meaningful wake condition changes: content
version, resource capacity, capability/context generation, explicit retry
policy, or renewed demand after backoff. Royal MUST NOT retry permanent parse or
validation failures every frame.

## Diagnostic audiences

Product UI uses focused lifecycle and asset/texture status APIs. Profiling and
integration tools use cold root diagnostics. Internal per-frame details remain
private unless a bounded aggregate answers a concrete operational question.

Diagnostics are observation, never control state. Application behavior MUST
NOT need to poll a large diagnostic snapshot to drive loading, retries, camera
fit, variants, or renderer lifecycle.

## Snapshot rules

Public snapshots MUST be detached from mutable renderer-owned state and exposed
through TypeScript `readonly` contracts. Runtime freezing is not required and
MUST NOT be added solely to restate the type contract. Reading a snapshot MUST
NOT mutate the renderer, allocate GPU resources, start work, or subscribe.
Focused asset reads SHOULD avoid building the full diagnostics payload.

Observer subscriptions validate callbacks, immediately publish the current
snapshot where documented, return idempotent unsubscribe functions, and never
retain a disposed root through stale closures.

Monotonic counters never decrease within a root generation unless explicitly
described as current usage. Current usage, high-water marks, cumulative counts,
and timing samples MUST be named distinctly.

## Bounded message log

Operational messages have stable semantic `key`, human-readable `message`, and
deduplicated `occurrences`. The log has fixed capacity and a dropped-occurrence
count. Repeated frame conditions update an existing occurrence rather than
allocating a new string and entry each frame.

Messages MUST NOT contain full remote payloads, secrets, unbounded URLs/data
URIs, or per-instance spam. A diagnostic key identifies the condition, not a
timestamp or frame number.

## Timing and memory

Load timing separates fetch, decode/codec, scene preparation, image settlement,
and upload queue wait where available. A duration records completed samples;
pending jobs are counts, not fabricated zero-duration samples.

Memory diagnostics distinguish decoded CPU bytes, persistent GPU bytes,
transient peak bytes, upload traffic, and quarantine debt. A number is either
measured/charged or explicitly approximate. Deployed gzip size is never called
runtime memory.

## Security boundary

Diagnostics and error formatting treat source strings and remote messages as
data. They MUST NOT inject HTML or execute source content. Royal does not claim
that browser-decoding an SVG sanitizes it; applications requiring hostile SVG
isolation must establish that boundary before Royal.

Network failures preserve useful status without exposing response bodies by
default. Cancellation caused by scene/root supersession is not reported as a
content failure unless it reveals a real invariant violation.

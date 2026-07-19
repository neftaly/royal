# Runtime lifecycle

## Owners

The host owns the HTML canvas. A renderer root owns its WebGL2 context request,
all resources created in that context, scheduling, retained scene bindings,
preparation subscriptions, and diagnostics. `Canvas` owns the renderer root it
creates. An XR runtime owns its acquired session and borrows the root's context.

Every mutable subsystem MUST have one identifiable owner, an idempotent release
operation, generation/reset semantics, and bounded observation. Ownership MUST
NOT depend on garbage collection timing.

## Root states

The backend context lifecycle is:

```text
             context lost             restoration begins
active ----------------------> lost ----------------------> restoring
  ^                              |                            |
  |                              | restoration succeeds       |
  +------------------------------+----------------------------+
  |
  +---------------- no transition after dispose

active/lost/restoring -------------------------------> disposed
```

The React-facing lifecycle projects these states to `available`, `unavailable`,
`failed`, or `disposed` and exposes monotonic generation, interruption, and
recovery counters. A captured restoration failure MUST be distinguishable from
ordinary temporary unavailability.

`dispose()` MUST be idempotent. After disposal, the root MUST schedule no work,
call no observers because of stale asynchronous completion, and create no GPU
resources. Operations that cannot have useful disposed semantics SHOULD fail
synchronously and consistently.

## Scene commits

`render(scene)` commits a complete latest scene; it is not an append operation.
The root MUST retain enough normalized state to draw that scene again after
resize, resource completion, or context restoration without requiring another
React commit.

A newer scene commit supersedes older scene intent atomically. Work belonging
only to the old scene MUST lose its root claim, but content shared with the new
scene MAY continue through the content owner. Stale completions MUST NOT publish
into the new scene merely because they share a source URL.

## Invalidation and clocks

The root is the sole render-demand coalescer. Descriptor/controller commits,
resize, resource completion, VT residency, render-object mutation, and explicit
`invalidate()` submit demand to that coalescer.

In ordinary canvas mode:

- multiple demands before submission MUST coalesce into at most one scheduled
  frame;
- a settled scene with no active frame subscriber MUST own no RAF or timer;
- `useFrame` MAY keep the frame clock active, but the callback alone does not
  imply a redraw unless it invalidates or mutates an invalidating controller;
- removing the last continuous subscriber MUST allow the root to settle after
  already-demanded work.

`flushInvalidated()` renders already-queued demand on the caller's current
frame. It MUST NOT invent new demand and MUST obey root lifecycle safety.

An external clock token, used by XR, suspends the ordinary default-framebuffer
clock. Exactly one owner MAY hold that scheduling authority. Releasing it is
idempotent and returns authority to ordinary scheduling without duplicating a
pending frame.

## Asynchronous work

Fetch, decode, codec, raster, and preparation completion MUST cross an explicit
asynchronous boundary, including cache hits. Completion MUST NOT re-enter React
reconciliation, scene commit, or frame planning inline.

Each consumer claim is distinct from a content-keyed prepared entry. Work MAY
be deduplicated across claims, but cancellation releases only the caller's
claim. In-flight work with no valid claim SHOULD be aborted when doing so does
not corrupt a shared cache transaction.

Every root-bound callback carries or closes over a generation token. A stale
generation MAY finish independently owned cache work, but MUST NOT invalidate,
publish into, allocate for, or retain the superseded root.

The root's asynchronous-preparation owner admits each claimed asset lifecycle
against one immutable root-wide limit. Admission starts available work
immediately, preserves FIFO order for queued work, removes an aborted queued
claim before it starts, and releases an active slot before settling the
consumer-facing promise. Disposal rejects queued work and prevents later active
completion from publishing root diagnostics.

Every submitted canvas or XR transaction begins one upload-admission frame.
Deferred texture publication keeps its decoded-source claim and schedules a
later frame; it does not regress focused readiness, masquerade as persistent
GPU denial, busy-loop outside submitted frames, or fork canvas/XR behavior.

One root owns at most one active explicit prefiltered-environment identity.
Replacing it aborts the old root claim, and a stale fetch or parse completion
cannot publish. Parsed bytes are retained as the reconstruction recipe while
that identity remains active. Asset readiness and focused subscriptions are
independent of GPU admission; renderer invalidation publishes the ready GPU
representation, or its deterministic studio fallback, through the same surface
path.

## Context loss and restoration

On `webglcontextlost`, Royal MUST prevent browser default teardown behavior as
required for restoration, stop GL submission, cancel or quarantine
generation-bound uploads, and publish lifecycle state. CPU content MAY remain
retained within its budget.

Restoration creates a new allocation generation. No handle from the previous
generation is valid. Royal MUST reconstruct current required resources from
canonical recipes/state, select a current frame, and only then submit. It MUST
NOT rely on a stale frame packet or wait for an unrelated app mutation.

Resources that failed to delete before loss may remain diagnostically charged
as quarantine debt until context recreation, but MUST never be reused.

## React mount behavior

Development Strict Mode may mount, release, and remount effects. Canvas and
control cleanup MUST therefore be complete and idempotent. An abandoned mount
MUST leave no listener, RAF, session callback, renderer root, observer, or
resource claim alive.

Each React root publication belongs to the exact canvas element generation that
created it. During immutable-option replacement or development hot refresh,
context, callbacks, rendering, and external refs MUST expose `null` rather than
an older disposed root until the new generation is live.

Hooks that observe external renderer state MUST use stable subscription
semantics and detached TypeScript-readonly snapshots. Runtime freezing is not
part of the contract. Observer callbacks that are documented as immediate MUST
synchronously receive the current snapshot on subscription, then receive later
transitions without polling.

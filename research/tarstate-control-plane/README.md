# Tarstate Control Plane For Royal

Date: 2026-06-28

## Scope

This is a research design note. It does not change renderer packages, package
exports, examples, or CI. The intended future implementation surface is
`@royal/tarstate-lens` plus small observer hooks owned by renderer adapters.

Tarstate should be a cheap control plane for Royal, not the renderer's internal
data model. The renderer keeps rendering; Tarstate keeps queryable facts,
commands, probes, diagnostics, and user control state.

## Tarstate Extraction-Readiness Lane

This lane keeps Royal as a consumer of the standalone `@tarstate/core` package.
The core package lives in the sibling Tarstate repo as a renderer-agnostic
data/query library; Royal control-plane schemas and adapters belong in
`@royal/tarstate-lens`.

Current boundary intent:

- `@tarstate/core` imports no `@royal/*`, no app packages, no renderer packages,
  and no source-path package internals.
- Tarstate API consumers import through package exports such as
  `@tarstate/core`, `@tarstate/core/query`, and `@royal/tarstate-lens`, not
  `packages/*/src/*` paths.
- Renderer packages stay independent from `@tarstate/core` and
  `@royal/tarstate-lens` in both imports and manifests.
- `@royal/tarstate-lens` may depend on `@tarstate/core`, but it remains the
  Royal-owned integration layer.

Do not reintroduce Tarstate core or the Tarstate demo app into Royal for this
lane. A future external release is justified only when all of these criteria are
met:

1. Stable API: the root and taxonomy subpath exports have stopped changing in
   ordinary Royal work.
2. Independent consumers: non-Royal consumers need Tarstate without renderer,
   React, app, or Royal lens code.
3. Release cadence: Tarstate needs versioning and releases independent of
   Royal's renderer/app cadence.
4. Package export smoke: focused tests exercise every public `@tarstate/core`
   import path through package exports.
5. Lens ownership: `@royal/tarstate-lens` stays Royal-owned unless its schemas,
   queries, and command abstractions become generic enough for non-Royal users.

## Readiness Fixture

`fixtures/control-plane-snapshot.json` is a tiny machine-checked contract for the
first control-plane prototype. It records bounded relation policies, sample
renderer event rows, command kinds, and the exact blocker for an examples route.

Run:

```sh
node research/tarstate-control-plane/validate-control-plane-fixture.mjs
```

This is still not ready for a real example route. The missing runtime piece is a
private renderer/react event sink that emits the fixture's `RoyalControlEvent`
shape and consumes validated command rows outside draw submission. The next
prototype step is to replay this fixture into tarstate-lens rows and render a
read-only inspector from those rows.

## Model

Keep the three layers separate:

| Layer | Owns | Does not own |
| --- | --- | --- |
| `@royal/renderer-core` | Author-facing render descriptors: `RenderRoot`, `RenderPass`, cameras, lights, meshes, materials, text, glTF asset references, stable author ids when added. | Tarstate schemas, query evaluation, WebGL caches, GPU handles, backend diagnostics policy. |
| `@royal/renderer-webgl` | Runtime backend state: WebGL context, programs, GPU buffers, textures, geometry/glTF/text caches, visibility packet buffers, culling loops, draw submission. | Required Tarstate dependency, full app scene graph source of truth, query execution inside draw loops. |
| `@royal/tarstate-lens` | Control-plane schema, snapshots, queries, command rows, diagnostics, relation views over renderer/app events. | GPU resources, mandatory rendering model, private caches, hot per-frame typed-array ownership. |

The lens observes and controls through a narrow adapter contract:

1. App or React adapter creates a Tarstate control store.
2. Royal renderer receives normal `RenderRoot` descriptors.
3. Renderer adapter emits sampled snapshots/events after lifecycle points:
   root created, scene accepted, pass rendered, asset status changed,
   pointer/pick changed, benchmark probe completed.
4. App writes command rows such as select, focus, set debug mode, request probe,
   or set budget.
5. The adapter consumes commands outside draw submission and translates allowed
   commands into renderer/app actions.

The draw loop must never wait on Tarstate queries. A missing, stale, or slow
control-plane snapshot may hide diagnostics, but it must not affect whether
Royal can render the current scene.

## Control-Plane Tables

Use bounded relation tables keyed by stable ids. Prefer replaceable snapshot
rows and short event rings over unbounded logs.

### Identity And Topology

| Relation | Key | Rows |
| --- | --- | --- |
| `renderRoots` | `rootId` | One row per renderer root or app scope: canvas kind, backend kind, lifecycle state, current scene revision. |
| `renderPasses` | `rootId`, `passId` | Pass descriptor facts: order, camera id, clear policy, viewport size, last frame sequence. |
| `renderNodes` | `rootId`, `nodeId` | Stable author/control identity: parent pass, node kind, asset id, bounds availability, labels for tools. |
| `nodeRelations` | `rootId`, `fromNodeId`, `relation`, `toNodeId` | Optional relation graph for ownership, follows, selected-by, asset-of, or generated-from links. |

`renderNodes` is not a mandatory complete scene graph. It is the public/control
projection of render descriptors that need identity for tools, diagnostics, and
selection. The authoritative descriptor remains the `RenderRoot` passed to the
renderer.

### Capabilities And Diagnostics

| Relation | Key | Rows |
| --- | --- | --- |
| `rendererCapabilities` | `rootId`, `capability` | WebGL/WebGL2/WebGPU/support facts from `collectRendererCapabilityRows`. |
| `rendererLimits` | `rootId`, `name`, `scope` | Texture size, texture units, uniform/vector limits, compressed format support. |
| `diagnostics` | `rootId`, `diagnosticId` | Bounded diagnostics: code, severity, relation, field/key, message, sequence, frame id. |
| `contextEvents` | `rootId`, `eventId` | Context lost/restored, resize, DPR change, backend fallback, resource pressure. |

Diagnostics should explain control and fallback decisions without leaking
browser or renderer handles. Rows may include string ids and numeric limits, but
not `WebGLRenderingContext`, `WebGLBuffer`, `WebGLTexture`, DOM nodes, or cache
objects.

### Input, Pick, Hover, Selection

| Relation | Key | Rows |
| --- | --- | --- |
| `inputPointers` | `rootId`, `pointerId` | Current pointer/device state: position, buttons, modifier bits, last sample sequence. |
| `pickSamples` | `rootId`, `sampleId` | Small ring of sampled pick events: x/y, pass id, target id, hit kind, sequence. |
| `hoverStates` | `rootId`, `scope` | Current hovered target and source pointer. Replace row, do not append forever. |
| `selectionStates` | `rootId`, `selectionId` | Current selected node/asset ids, selection mode, owner scope, sequence. |
| `controlStates` | `rootId`, `name` | Debug overlays, inspection mode, paused probes, renderer budget choices. |

Selection and hover are control state, not renderer-internal state. The adapter
may use them to render overlays or update app state, but backend draw code
should not query Tarstate to decide ordinary draw submissions.

### Assets And Loading

| Relation | Key | Rows |
| --- | --- | --- |
| `assets` | `rootId`, `assetId` | Asset identity: src or manifest id, kind, owner node id, revision/hash when known. |
| `assetLoads` | `rootId`, `assetId` | Load status: queued/loading/ready/failed/stale, bytes loaded, selected variant, sequence. |
| `assetDiagnostics` | `rootId`, `diagnosticId` | Decode, bounds, variant, CORS, fallback, and stale-manifest messages. |

The control plane may expose asset status and manifest identity. It must not own
decoded images, parsed glTF runtime objects, typed geometry buffers, or WebGL
texture lifetimes.

### Renderer Stats And Probes

| Relation | Key | Rows |
| --- | --- | --- |
| `visibilityStats` | `rootId`, `passId`, `frameBucket` | Packet count, visible count, culled count, cull ms, bounds-source counts. |
| `virtualTextureStats` | `rootId`, `assetId`, `frameBucket` | Requested pages, hits, misses, uploads, evictions, dirty entries, fallback samples. |
| `benchmarkProbes` | `rootId`, `probeId` | Probe config: kind, enabled, sample rate, target relation, status. |
| `benchmarkSamples` | `rootId`, `probeId`, `sampleId` | Aggregated timings: frame bucket, min/p50/p95/max, count, dropped samples. |

`frameBucket` should usually be a rounded time window or fixed sequence bucket,
not every frame forever. For a debug HUD, keep the last N buckets. For CI or
manual research, export explicit probe artifacts outside the runtime store.

### Commands

| Relation | Key | Rows |
| --- | --- | --- |
| `commands` | `rootId`, `commandId` | Intent rows: kind, target id, payload kind, issued sequence, owner. |
| `commandResults` | `rootId`, `resultId` | Result rows: command id, accepted/rejected/dropped/failed, message, sequence. |

Initial command kinds:

- `selectNode`, `clearSelection`, `focusNode`, `setHoverSource`
- `setControlState`, `setDebugOverlay`, `setProbeEnabled`
- `requestCapabilityProbe`, `requestBenchmarkProbe`
- `setRendererBudget` for bounded debug/runtime budgets such as upload pages
  per frame, sample rate, or maximum diagnostic rows

Commands are requests, not direct handle calls. The adapter validates them,
applies policy, then emits `commandResults` and diagnostics.

## What Must Not Go There

Do not put these in Tarstate:

- `WebGLBuffer`, `WebGLTexture`, `WebGLProgram`, `WebGLRenderingContext`,
  `GPUDevice`, `GPUBuffer`, or browser resource handles.
- Geometry, text, glTF, material, or texture cache objects.
- Full typed visibility packet buffers as normal relation rows.
- The complete scene graph as the mandatory source of truth for rendering.
- Per-frame hot-loop rows for every packet, draw, page, glyph, triangle, or
  input sample unless explicitly sampled and bounded.
- Internal sort keys, dirty flags, upload staging data, shader binding state,
  or backend-private cache keys unless converted to coarse diagnostics.
- Queries whose result is required by the draw loop.

## Cheapness Model

Cheap means bounded, replaceable, and off the critical path.

- Bounded rows: every relation has a budget. Examples: last 256 diagnostics,
  last 128 pick samples, last 120 frame buckets, current row per root/pass/node.
- Append/replace policy: identity, status, control, hover, selection, and budget
  rows are replaced. Diagnostics and samples append into capped rings.
- Frequency limits: capability rows emit at startup or context change; asset
  rows emit on status transitions; stats emit every 250 ms by default or when a
  probe asks for a higher rate.
- Stable ids: `rootId`, `passId`, `nodeId`, `assetId`, `selectionId`, and
  `probeId` come from app ids, descriptor ids, manifest ids, or deterministic
  hashes. Dense array indexes are allowed only as sampled details.
- Transfer path: renderer workers may post compact snapshot messages with
  transfer lists. High-frequency counters can use `SharedArrayBuffer` when the
  app has cross-origin isolation, but Tarstate snapshots should still read
  sampled aggregates.
- No query dependency in draw: renderer code can emit to a sink and poll
  already-validated commands between frames. It cannot call `evaluate(...)` to
  decide draw submission.

Default budgets for a first implementation:

```ts
export const defaultRoyalControlPlaneBudget = {
  diagnostics: 256,
  pickSamples: 128,
  pointerSamples: 64,
  frameStatBuckets: 120,
  benchmarkSamples: 240,
  commandResults: 128,
  statsPeriodMs: 250,
} as const;
```

## API Sketch

Keep renderer packages independent by defining the Tarstate schema in
`@royal/tarstate-lens`, and defining a small renderer-neutral event sink type
that renderer adapters may accept without importing Tarstate.

```ts
// @royal/renderer-core or a tiny shared type package, no Tarstate import.
export type RoyalControlEvent =
  | { kind: 'root:created'; rootId: string; backend: 'webgl' | 'webgpu' }
  | { kind: 'scene:accepted'; rootId: string; sceneRevision: number }
  | { kind: 'pass:stats'; rootId: string; passId: string; stats: VisibilityStats }
  | { kind: 'asset:load'; rootId: string; assetId: string; status: AssetLoadStatus }
  | { kind: 'pick:sample'; rootId: string; sample: PickSample };

export type RoyalControlSink = {
  readonly emit: (event: RoyalControlEvent) => void;
  readonly pollCommands?: (rootId: string) => readonly RoyalControlCommand[];
};
```

```ts
// @royal/tarstate-lens
export const royalControlPlaneSchema = defineSchema({
  renderRoots: relation<RenderRootRow>({ key: 'rootId', fields: rootFields }),
  renderPasses: relation<RenderPassRow>({ key: ['rootId', 'passId'], fields: passFields }),
  renderNodes: relation<RenderNodeRow>({ key: ['rootId', 'nodeId'], fields: nodeFields }),
  rendererCapabilities: relation<CapabilityRow>({ key: ['rootId', 'capability'], fields: capabilityFields }),
  diagnostics: relation<DiagnosticRow>({ key: ['rootId', 'diagnosticId'], ephemeral: true, fields: diagnosticFields }),
  hoverStates: relation<HoverStateRow>({ key: ['rootId', 'scope'], ephemeral: true, fields: hoverFields }),
  selectionStates: relation<SelectionStateRow>({ key: ['rootId', 'selectionId'], ephemeral: true, fields: selectionFields }),
  assetLoads: relation<AssetLoadRow>({ key: ['rootId', 'assetId'], ephemeral: true, fields: assetLoadFields }),
  visibilityStats: relation<VisibilityStatsRow>({ key: ['rootId', 'passId', 'frameBucket'], ephemeral: true, fields: visibilityFields }),
  virtualTextureStats: relation<VirtualTextureStatsRow>({ key: ['rootId', 'assetId', 'frameBucket'], ephemeral: true, fields: vtFields }),
  commands: relation<CommandRow>({ key: ['rootId', 'commandId'], ephemeral: true, fields: commandFields }),
  commandResults: relation<CommandResultRow>({ key: ['rootId', 'resultId'], ephemeral: true, fields: resultFields }),
});
```

```tsx
// Non-current pseudocode sketch: controlSink, stable descriptor ids, and
// selection commands are proposed control-plane APIs, not public exports yet.
/** @jsxImportSource @royal/react */
import { createRoyalControlPlane, royalControlQueries } from '@royal/tarstate-lens/control-plane';
import { createRendererRoot } from '@royal/react';
import { boxGeometry, standardMaterial } from '@royal/renderer-core';

const control = createRoyalControlPlane({ rootId: 'main-canvas' });
const royal = createRendererRoot(canvas, {
  context: { antialias: true },
  controlSink: control.sink,
});
const heroMaterial = standardMaterial({
  color: [1, 0, 0, 1],
});

royal.render(
  <scene>
    <pass camera={camera}>
      <mesh
        id="hero-cube"
        geometry={boxGeometry({ size: [1, 1, 1] })}
        material={heroMaterial}
      />
    </pass>
  </scene>
);

control.dispatch({ kind: 'selectNode', commandId: 'cmd-1', rootId: 'main-canvas', nodeId: 'hero-cube' });

const selected = await control.query(royalControlQueries.selectedNodes('main-canvas'));
```

The React adapter can subscribe to the Tarstate store for inspector panels,
debug overlays, and controls. It still renders Royal through normal descriptors.

## Boundary Checks

Implementation patches should keep tests enforcing directionality:

1. Keep `tests/package-boundaries.test.ts` checking that renderer package source
   files and manifests do not import or depend on `@tarstate/core`,
   `@royal/tarstate-lens`, or any package whose name includes `tarstate`.
2. Keep `@royal/tarstate-lens` allowed to import `@tarstate/core`. If it needs
   Royal types, prefer event/control DTOs from `@royal/renderer-core`; avoid
   importing `@royal/renderer-webgl`.
3. Keep `@tarstate/core` free of Royal, app, renderer, and source-path package
   internal imports.
4. Add a smoke test that creates a renderer root with no control sink, proving
   the renderer works when the control plane is absent.
5. Add a lens test that feeds synthetic control events into the store and
   verifies capped diagnostics, replace-style hover/selection rows, and command
   result rows.

Recommended test helper shape:

```ts
const tarstatePackages = new Set(['@tarstate/core', '@royal/tarstate-lens']);
const rendererRoots = new Set(['packages/renderer-core', 'packages/renderer-webgl']);

expect(importViolations.filter(({ root, specifier }) =>
  rendererRoots.has(root) &&
  (tarstatePackages.has(externalPackageName(specifier) ?? '') || specifier.includes('tarstate'))
)).toEqual([]);
```

## Recommended Implementation Patches

Land this in small independent patches:

1. `@royal/tarstate-lens`: add `control-plane` schema, bounded in-memory store,
   command/result helpers, and queries for selected nodes, diagnostics by
   severity, asset load summary, and latest visibility stats.
2. `@royal/renderer-core`: add optional stable descriptor ids where they are
   missing, plus renderer-neutral `RoyalControlEvent`, `RoyalControlCommand`,
   and `RoyalControlSink` types if a shared type location is acceptable.
3. `@royal/renderer-webgl`: accept an optional control sink on root creation;
   emit lifecycle/capability/asset/stat events outside hot loops; poll commands
   only between frames or at explicit lifecycle points.
4. `@royal/react`: thread `controlSink` through `createRendererRoot` options and expose
   a React hook/example for an inspector panel backed by Tarstate queries.
5. `tests/package-boundaries.test.ts`: add the import and manifest guards above.

Decomplection for those patches: keep descriptors, backend runtime state, and
control-plane rows as separate ownership areas. The adapter may translate
between them; none of the three should become a hidden global source of truth
for the others.

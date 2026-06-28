# Royal Dynamic Impostors Research

Date: 2026-06-28

## Scope

This prototype stays under `research/dynamic-impostors`. It does not add
renderer APIs, app routes, package exports, build config, or live GPU code.

The goal is to pressure the asset, texture residency, visibility, and LOD
contracts needed for big forest rendering before Royal commits to a runtime
impostor API. The first slice is intentionally offline/static-fixture only:
prebaked atlases, deterministic forest placement, and a Node harness that can
run without a GPU.

## First Prototype

The first prototype models a forest asset bundle with:

- Offline-generated impostor atlases for tree species and LOD bands.
- Source mesh references for trunk, branch, leaf, and collision assets.
- A forest manifest with cell bounds, deterministic placement, atlas refs,
  octahedral and billboard metadata, switch thresholds, and debug counters.
- Virtual-texture/page-residency hooks that name pages, budgets, and
  prefetch priorities without requiring a renderer implementation.
- A CPU-only harness that selects mesh, octahedral impostor, billboard, or
  culled representation for many tree instances and reports the pressure.

Run:

```sh
node research/dynamic-impostors/forest-lod-bench.mjs
```

Run the repeatable gate:

```sh
node research/dynamic-impostors/forest-lod-bench.mjs --check
```

The check mode exits nonzero when deterministic pressure metrics exceed the
checked thresholds. It intentionally gates on counts and estimates derived from
the fixture, not local wall-clock timings, so the result is stable enough for a
CI-like repeatability check.

Small deterministic overrides are available for focused experiments:

```sh
node research/dynamic-impostors/forest-lod-bench.mjs --frames 24 --trees 4000 --seed 1234
```

The harness prints deterministic JSON with:

- Mesh, octahedral impostor, billboard, and culled instance counts.
- Estimated draw calls and triangle pressure.
- Atlas layer and page demand.
- Physical page residency, misses, uploads, evictions, and estimated upload ms.
- LOD switch churn, debug-counter rows, and update cost estimates.

Metric notes:

- `counts` describe selected representations for a frame. `meshTotal` is the
  near/mid mesh work that remains after impostor selection.
- `estimatedDrawCalls` and `estimatedTriangles` are renderer-pressure estimates,
  not GPU measurements.
- `pageResidency.hitRatio`, `pageMisses`, `pageUploads`, and `pageEvictions`
  model virtual-texture residency pressure against the fixture budgets.
- `lodSwitches.any` tracks representation churn between frames; high values
  point at threshold or hysteresis pressure.
- `updateCost.estimatedTextureUploadMs` is budget math from upload bytes and
  page overhead. `lodSelectionMs`, `residencySchedulingMs`, and `cpuTotalMs`
  include local CPU timing and are useful for spotting regressions during local
  work, but they are not part of `--check`.

This is deliberately independent from Royal runtime types. The manifest uses
stable asset-like strings and plain JSON so renderer work can later map the
same facts into internal texture resources, virtual-texture pages, visibility
packets, and culling APIs without exposing those backend choices to app code.

## Manifest Shape

`fixtures/sample-forest-impostor-manifest.json` is a concrete sample for a
mixed conifer/broadleaf forest:

- `sourceMeshes`: mesh, material, collision, and authoring source refs.
- `impostorAtlases`: texture refs, page layout, octahedral directions,
  billboard frame policy, alpha/depth/normal metadata, and memory hints.
- `forestCells`: world bounds, instance count, species mix, placement seed,
  culling cluster size, and residency prefetch policy.
- `lodPolicy`: distance and projected-height thresholds with hysteresis.
- `virtualTextureHooks`: page size, physical slot budget, upload budget,
  fallback policy, priority rows, and page-table debug names.
- `debugMetrics`: counters the future renderer should expose when this moves
  from a static fixture into runtime diagnostics.

The manifest intentionally names texture pages and atlas layers without
defining WebGL/WebGPU resource handles. It should create pressure on texture
resource identity, residency accounting, and visibility packet ownership while
remaining portable.

## Build Order

### 1. Offline Atlas Fixtures

Start with exported atlas metadata and deterministic forest placement. The
fixture should answer what the renderer would need to know before any GPU path
exists: source mesh bounds, impostor atlas layout, page groups, memory budget,
camera-facing strategy, and thresholds.

Decomplection: keep mesh identity, impostor atlas identity, and runtime page
residency separate. Do not treat an impostor atlas as a mesh LOD level or a
virtual-texture implementation detail.

### 2. CPU LOD And Residency Harness

Use the Node harness to tune threshold policy and debug counters. It should
remain deterministic, fast, and runnable in CI-like environments. The first
model is intentionally simple: circular view distance, screen-height LOD
selection, fixed page budget, LRU page cache, and per-frame upload cap.

Decomplection: LOD selection should produce renderer-independent demand rows.
Residency scheduling should consume those rows and report pressure, not know
about tree placement internals.

### 3. Renderer Integration Later

After visibility packets, texture resources, and virtual texturing have firmer
internal seams, a runtime experiment can map this manifest into backend-private
resources:

- Mesh instances become normal visibility packets.
- Impostor instances become instanced quad or octahedral draw packets.
- Atlas pages become texture-resource residency requests.
- Debug counters become renderer diagnostics.

Do not add public `dynamicImpostor`, `forest`, or `virtualTexture` nodes for
this research slice.

### 4. Live Regeneration Later

Live impostor regeneration is explicitly out of scope for this step. Later work
can add a worker/offscreen render pipeline that regenerates directions,
lighting variants, seasonal variants, or damaged-state variants as source
assets change. That future system should reuse the same manifest concepts:
source mesh refs, atlas keys, page residency, thresholds, and debug metrics.

## Acceptance Notes

The static prototype is useful if it can answer these questions without a GPU:

- How many trees remain real mesh instances near the camera?
- Which impostor atlas pages are demanded by a moving camera?
- How much upload budget would be consumed by a cold forest pan?
- How much LOD churn appears near thresholds?
- Which debug counters are needed to explain quality and residency failures?

The fixture is intentionally tiny compared with production forests. Its value
is the contract pressure, not visual output.

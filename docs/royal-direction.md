# Royal Direction

Royal is a renderer toolkit for building rich canvas/WebGL experiences from small, typed, DOM-free primitives. It should make scene authoring pleasant, rendering predictable, and performance work measurable. The repo should stay focused on Royal-owned renderer APIs and examples; generic state libraries, standalone apps, and one-off research fixtures belong outside the main package path.

## What Royal Should Be

Royal should be:

- A small scene descriptor API in `@royal/renderer-core`.
- A thin React/JSX authoring layer in `@royal/react`.
- Renderer implementations that own backend details, starting with WebGL.
- Product examples that use public APIs only.
- A place where performance-sensitive features are benchmarked before they become defaults.
- A canvas-first UI/text/rendering system, not a DOM facade.

Royal should not be:

- A host repo for Tarstate, Expo apps, or unrelated demos.
- A collection of lab probes wired directly into public examples.
- A renderer that needs Tarstate, React, browser DOM controls, or HTML menus to draw.
- A place where compatibility fallbacks silently become product behavior.

## Layer Boundaries

`@royal/renderer-core` owns renderer-neutral descriptors, asset refs, materials, text/layout primitives, diagnostics shapes, and public authoring helpers. It should not import DOM, React, WebGL, WebGPU, or Tarstate.

`@royal/react` owns JSX and host integration. It should stay thin: convert JSX to renderer descriptors, mount roots, pass through options, and avoid becoming an application framework.

`@royal/renderer-webgl` owns GL resources, shaders, caches, upload scheduling, visibility culling, and backend-specific performance work. It should not expose internal testing APIs to examples.

Examples demonstrate intended product APIs. They should use JSX, avoid hidden DOM bridges, avoid renderer internals, and stay small enough to explain the API at a glance.

Research can exist, but it must not become a second product surface. When research moves on, delete the old path or move it out of Royal.

## External Dependencies

Tarstate is standalone. Royal may consume `@tarstate/core` only through explicit package dependencies where there is a real Royal-owned integration. Royal should not modify Tarstate or assume a sibling checkout.

`@royal/tarstate-lens` is currently best understood as a control-plane prototype. Its useful lessons are stable ids, row-shaped diagnostics/facts, optional control events, and interaction state contracts. The package should not become a required renderer layer.

The Expo hello app is standalone. Royal should not carry app examples that are not directly about Royal renderer APIs.

## Control Plane Direction

Royal should harvest control-plane ideas without coupling renderers to Tarstate:

- Add explicit `rootId`, `passId`, and `nodeId` where stable identity matters.
- Prefer explicit ids first and deterministic containment fallback second.
- Define a small renderer-neutral diagnostic/event shape in core.
- Add an optional control sink that renderers can emit to without importing Tarstate.
- Keep draw submission independent from queries or relation stores.
- Keep event rows bounded and low-frequency; hot loops stay in renderer-owned data structures.

Once those primitives exist, delete duplicated projection code from `@royal/tarstate-lens`. If no real consumer remains, remove the package.

## Text And UI Direction

Text handling should become its own renderer-neutral module before we expand canvas UI:

- Font metrics, shaping, wrapping, layout, caret geometry, hit testing, and selection rects belong together.
- Editing commands, composition, clipboard command preparation, and canvas context-menu hit testing should be deterministic primitives, not example-local code.
- Clipboard integration should use native clipboard events and explicit browser ports. Hidden DOM editors, internal clipboards, and HTML fallback menus are regressions.
- Form controls should build on the text primitives and stay canvas-native.

The near-term goal is to shrink the text example by moving reusable layout/editing logic into a library module while keeping renderer-specific drawing in the renderer packages.

## Virtual Texturing Direction

Virtual texturing should become a public material/asset feature only when it is seamless:

- A caller should describe a large texture once.
- The renderer should load coarse detail first and refine automatically as screen-space footprint changes.
- Zooming, panning, and oblique viewing must stay smooth.
- Near/front texels on an oblique surface should request higher detail than far/back texels when the VT implementation supports it.
- Texture upload, page selection, worker scheduling, and cache eviction must be benchmarked.

The current public examples should not pretend to demonstrate automatic VT if the public descriptor path does not support it yet. They can demonstrate the intended texture descriptor boundary and visual inspection controls, while tests guard against low-level VT imports in product examples.

## Performance Direction

Performance work should be benchmark-led and used to decomplect:

- Startup and first render.
- Texture load and upload hitches.
- Zoom/pan/rotate smoothness.
- Text editing latency, selection, caret hit testing, and paste.
- Visibility culling, picking, and large scene traversal.
- Build and examples browser smoke.

Benchmarks should answer whether a path belongs in the hot renderer, a worker, an optional control sink, or a research package. A benchmark that reveals an unused or slow path should usually lead to deletion or a smaller API.

## Current Priorities

1. Finish extracting non-renderer apps and generic packages from Royal.
2. Extract text/editing primitives into a focused module.
3. Design the public VT descriptor and benchmark the automatic refinement path before making VT default.
4. Harvest control-plane primitives from `@royal/tarstate-lens`, then delete duplicated lens code.
5. Keep examples small, public-API-only, and canvas-first.
6. Remove stale research routes, artifacts, and compatibility shims when their lesson has moved into core APIs.

## Cleanup Queue

Ready now:

- Split `renderer-core` text internals behind the same public API: types, font loading, shaping, layout, and mesh generation should stop living in one large file.
- Decompose the text example into app-local scene, editor state, context menu, clipboard, and probe helpers before promoting generic pieces into a text package.
- Deduplicate text probe normalization in the examples browser smoke script before changing the probe shape.
- Remove unused public testing/lab exports when no repo consumer imports those subpaths.
- Rename or demote examples that are placeholders rather than real implementations, especially where the current public API cannot demonstrate the promised feature.

Planning, not yet implementation:

- Do not build a full Tarstate-backed control plane until text/UI, VT, examples, and renderer API boundaries are cleaner.
- Do not make VT always-on until the descriptor API, page selection, worker scheduling, and smooth zoom benchmarks prove it is stable.
- Do not turn WebGPU probes into a public renderer API until the package boundary is explicit.

## Decision Rules

Keep code when it is on a product API path, covered by focused tests, and has an owner.

Move code when it is useful but not Royal-specific.

Delete code when it exists only to support an old demo, a superseded prototype, or an internal path that product examples should not use.

Add abstraction only when it removes real duplication or makes a hot path simpler.

Make defaults only after the behavior is stable, fast, and benchmarked.

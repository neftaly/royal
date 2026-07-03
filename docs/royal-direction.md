# Royal Direction

Royal is a DOM-free renderer and interaction primitive toolkit for interfaces that need both game-style scenes and UI-library semantics. The useful question is not whether Royal is a 2D UI library or a 3D simulation/game engine. It is what renderer primitives let those two worlds meet without either one becoming a pile of special cases.

A 3D simulation or game owns world state, time, cameras, materials, physics, and spatial placement. A 2D UI library owns semantics: controls, text, forms, layout, focus, input, accessibility, and predictable user intent. Royal's direction is the layer where those meet: small typed primitives that can describe interactive surfaces in a flat canvas, on a touch screen, or in spatial XR without making the DOM, React, WebGL, WebGPU, or Tarstate the source of truth.

Royal is not an OS, compositor, XR runtime, browser engine, accessibility platform, app descriptor schema, placement contract, or game engine. The long-term framing is narrower: Royal should grow renderer primitives for renderable, inspectable, accessible interface scenes that can be backed by different renderers. The repo should stay focused on Royal-owned renderer and interaction APIs; generic state libraries, standalone apps, descriptor schemas, placement contracts, event-row contracts, and one-off research fixtures belong outside the main package path.

## 3D Scenes And 2D UI

A 3D scene primitive answers: where is it, what shape is it, how is it lit, what camera sees it, and how expensive is it to render?

A UI primitive answers: what does it mean, how does focus reach it, what input activates it, what text/editing model owns it, what accessibility state describes it, and what layout contract positions it?

Royal should not collapse one into the other. Meshes, cameras, materials, textures, and spatial transforms belong beside buttons, text fields, focus scopes, pick targets, layout boxes, and accessibility metadata. The shared contract is a scene graph with stable identity, geometry, semantics, input routing, and renderer-neutral diagnostics.

## What Royal Should Be

Royal should be:

- A small renderer primitive vocabulary in `@royal/renderer-core`.
- A thin React/JSX authoring layer in `@royal/react`.
- Renderer implementations that own backend details, starting with WebGL.
- Product examples that use public APIs only.
- A place where performance-sensitive features are benchmarked before they become defaults.
- A canvas-first UI/text/rendering system, not a DOM facade.
- A primitive layer for touch and spatial interfaces, not only a WebGL drawing API.
- A scene graph that can carry render geometry and renderer-neutral UI semantics.
- Renderer-neutral input, focus, picking, text, layout, refs, imperative escape hatches, XR, instancing, and performance contracts.

Royal should not be:

- A host repo for Tarstate, Expo apps, or unrelated demos.
- A collection of lab probes wired directly into public examples.
- A renderer that needs Tarstate, React, browser DOM controls, or HTML menus to draw.
- A place where compatibility fallbacks silently become product behavior.
- A conventional DOM UI kit painted onto a WebGL canvas.
- A game engine that forces every app to adopt a simulation loop as its source of truth.
- A complete OS, compositor, browser DOM replacement, XR runtime, accessibility platform, or physics/gameplay engine.
- A UI system whose semantics only exist in examples or hidden DOM controls.
- A renderer backend whose private resources leak into author-facing primitives.
- A home for app-level surface descriptors, placement schemas, product panels, or event-row contracts.

## OS-Grade Primitive Direction

Royal's useful endpoint is not "draw 3D" or "rebuild HTML in canvas". It is a primitive set for application surfaces that may be touched, clicked, keyboard-driven, inspected, or placed in space.

Core primitive areas:

- Scene graph: stable roots, passes, nodes, transforms, containment, bounds, and author ids.
- UI semantics: roles, labels, disabled/read-only state, value state, selection state, and activation contracts.
- Input: pointer/touch, keyboard, composition, clipboard commands, controller/ray input later, and deterministic reducer-style state changes.
- Focus: focus scopes, tab/arrow traversal, active/hovered/pressed state, and focus commands independent of DOM focus internals.
- Text/forms: shaping, layout, caret geometry, hit testing, selection rects, editing commands, IME, clipboard, and form-control state.
- Picking: explicit hit regions, ray/screen-space samples, visible-shape oracles, and debug rows separate from render bounds.
- Layout: 2D layout boxes, measured text, scroll/clip regions, and a path to spatial placement without assuming every node is a DOM rectangle.
- Spatial placement: transforms, anchors, billboards/panels, world/screen/local coordinate spaces, and camera/pass relationships.
- Control plane: bounded facts, diagnostics, probes, commands, and stable ids; never renderer hot-loop ownership.
- Accessibility: renderer-neutral metadata that a host can project to platform accessibility, without promising Royal owns the platform API.
- Refs and imperative escape hatches: stable handles for focused mutation, picking probes, and renderer lifecycle control without exposing backend internals.
- XR, instancing, and performance: backend-neutral primitives and measurements that let renderers optimize without importing app concepts.
- Render backend boundary: core describes intent; WebGL/WebGPU choose buffers, shaders, culling, upload policy, and capability fallbacks.

This is why text and UI work matters as much as VT or WebGL performance. A spatial OS still needs caret placement, selection, copy/paste, labels, forms, accessible names, and predictable focus. A touch-screen canvas still benefits from cameras, transforms, depth, assets, and spatial picking. Royal should keep those concepts aligned.

## Layer Boundaries

`@royal/renderer-core` owns renderer-neutral primitives: scene graph nodes, cameras, geometry, materials, textures, asset refs, text/layout primitives, UI semantics, picking, XR-facing inputs, instancing/performance-oriented contracts, refs, imperative escape hatches, diagnostics shapes, and public authoring helpers. It should not import DOM, React, WebGL, WebGPU, Tarstate, Patchpit, or Opshop.

App-level surface descriptors belong outside Royal. Descriptor schemas for product panels, placement, app surfaces, event rows, and app/control-plane routing belong in Patchpit/Opshop, which can project those app contracts into Royal renderer primitives.

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

1. Keep `renderer-core` as the stable primitive vocabulary: scene graph, identity, materials, text/layout, input/focus/picking contracts, diagnostics, and backend-neutral events.
2. Extract text/editing/form primitives before expanding canvas UI claims.
3. Define picking and focus as first-class contracts, including explicit hit regions and bounded probe rows.
4. Design the public VT descriptor and benchmark the automatic refinement path before making VT default.
5. Harvest control-plane primitives from `@royal/tarstate-lens`, then delete duplicated lens code.
6. Keep spatial/XR language directional until coordinate spaces, input rays, anchors, and accessibility projection are designed.
7. Keep examples small, public-API-only, and canvas-first.

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

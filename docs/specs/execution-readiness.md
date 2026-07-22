# Replacement execution record

Status: accepted replacement roadmap executed; release evidence retained

Implementation began after the four gates below were accepted. This document
now records the start criteria and the evidence still required before the
replacement can be called release-ready; it is not a second current backlog.

## Current roadmap completion audit

This audit is intentionally stricter than feature presence. A row is complete
only when its current implementation, consumer surface, automated oracles, and
required physical evidence agree.

| Roadmap requirement | Current evidence | Completion result |
| --- | --- | --- |
| Baseline PBR and static glTF fidelity | Core metallic-roughness, lights, IBL, normal/emissive/occlusion/specular/transmission/volume lowering, official asset manifest, pixel/decode gates, and required-extension failures pass the replacement suite. Exact clean build `77a79eab` settles all 69 Sponza images on physical iPad and retains the final canvas after 60/60 camera-motion samples; the accepted Quest XR build retains a stereo SVG/direct-surface capture. | Complete for the accepted static profile. |
| Authored LOD, variants and instances | Dense stereo-aware LOD selection, readiness fallback, variants, repeated occurrences, GPU-authored instances, explicit bulk instances, and shared picking identity have deterministic, fuzz, integration, and browser evidence. | Complete for the accepted static profile; lowest-LOD-first transport remains an explicit non-blocking optimization. |
| Canvas and WebXR | One clock/frame transaction, ordered views, lifecycle/failure properties and synthetic stereo evidence exist. Exact clean build `278cbdc7` enters one physical Quest 2 session at its configured 90 Hz, renders two ordered 2880x1584 stereo views, completes 180/180 samples at 11.27 ms average / 14.34 ms p95 with 1.00 ms Royal-callback p95, retains a stereo pixel capture, and explicitly exits. | Accepted 60 Hz floor and lifecycle proof complete; the supported 120 Hz mode remains an optimization target rather than a release claim. |
| VT2, SVG and ETC2 KTX2 | Authored/automatic VT share demand/publication/resource paths; near-plane and close-ground properties, GS SVG preferred/fallback behavior, and direct offline ETC2 upload/selection have focused and browser evidence. Exact clean build `77a79eab` retains 10 close-ground VT pages on physical Safari with no pending or failed work, then reaches distance 0.1 on Quest and grows from 5 to 11 resident pages with no pending/failure. The earlier accepted Quest build retains the immersive physical-headset capture. | Complete for the accepted profile; Basis transcoding remains an explicit non-claim. |
| React-first consumer DX | Packed consumer composition covers scenes, focused observation, controls, picking proxies, document scenes, variants, instances, borrowed prepared geometry, stable host glTF resource reads, XR and imperative root ownership. Public constructors validate unknown fields and declarations name identity, units, byte ownership, and lifecycle. | Local compile/runtime/package proof complete. |
| Performance, GC and deployed bytes | Retained packets/state, allocation-focused cores, exact resource accounting, upload governors, CPU/GPU traces and bundle attribution exist. Current local gates report 114.8 kB initial and 252.2 kB total deployed JavaScript gzip; Royal itself accounts for 55.5 kB initial and 192.9 kB across the complete optional graph. The selected-scene range slice removes 21.96 MB from the measured Bistro wine-scene geometry transfer; selected material-image ranges remove unrelated embedded-image demand without another interpretation path. Exact Quest XR meets the accepted 60 Hz floor; its configured 90 Hz session does not meet a sustained 11.11 ms p95 claim. | CPU/GC is not the present heavy-scene limit. Sponza misses a sustained physical-iPad p95 claim; Bistro and A Beautiful Game remain texture/fragment-bound below the desired device floor. Offline GPU-compressed content is the strongest accepted route, not a renderer quality shortcut. |
| Validation, commit and release proof | The complete local replacement suite, glTF manifest, types, lint, builds, package entrypoints, VT benchmark build, bundle ceilings and all-route rendered-pixel smoke are repeatable gates. Headless CI pins Chrome-for-Testing 149, matching the accepted Quest browser major, and uses explicit SwiftShader only as a deterministic behavior oracle; upgrades are deliberate full-matrix changes. Hardware and performance claims require the retained iPad/Quest evidence. Physical evidence is retained for exact-build iPad Sponza/VT/all Bistro scenes and Quest XR/close-ground VT, with matching source identities and device telemetry. | Complete for the accepted roadmap. Remaining performance limitations are measured product constraints, not missing proof. |

The accepted unsupported/deferred rows—animation, skins, morphs, physics,
interactivity and speculative optional WebGL features—do not block this roadmap.
They also cannot be counted as implemented merely because the architecture can
represent them later.

## Gate 1: consumer contract — accepted

The [consumer API contract](consumer-api.md) defines the primary React tasks,
entrypoints, descriptor vocabulary, observation placement, picking/events, and
imperative escape hatch. Slice 0 may change current exports to satisfy it; later
slices must not redesign the API merely to accommodate an internal owner.

Ready when packed compile-only examples cover every primary task, editor-visible
declarations state units/defaults/lifecycle, and remaining API questions are
recorded rather than silently delegated to implementation.

## Gate 2: replacement completeness — in conformance review

The replacement is eligible to supersede the current renderer when these
first-class behaviors conform:

| Required before replacement | Not required for replacement |
| --- | --- |
| React Canvas, controls, focused observation, picking events and imperative root | Built-in glTF animation, skins, morph targets or animation pointer |
| Static `.gltf`/`.glb`, validated buffers/accessors, progressive asset/image lifecycle | Physics, collision, interactivity, audio or application runtime |
| Core metallic-roughness plus the accepted static material extension profile | Browser-side mesh simplification, meshlets or GPU-driven scene architecture |
| Ordinary raster, offline ETC2 KTX2, self-contained SVG and the specified orientation/color/alpha behavior | IES lights, node visibility or other deferred optional glTF extensions |
| Authored and automatic VT with close-view, near-plane, ground-plane, stereo and fallback behavior | Float64 accessors, video/procedural textures or path tracing |
| Repeated nodes, GPU-authored instances, explicit bulk instances, variants and `MSFT_lod` | Optional WebGL accelerations without measured target-device value |
| Exact shared-path picking, including alpha-mask silhouette behavior | Transparent blended per-texel picking |
| Canvas and WebXR lifecycle, multi-view demand, context loss/restoration and disposal | A public render graph, shader plugin system, ECS or second backend abstraction |
| Resource admission, neutral progressive fallbacks, diagnostics, lazy entrypoints and bundle budgets | Legacy compatibility flags, aliases or a legacy fallback renderer |
| Safari 17/A10-class and Quest 2 correctness with accepted physical performance evidence | Parity with obsolete private counters, module layout or implementation-shaped tests |

The conformance ledger, not raw legacy test count, determines completion.
Deferred and out-of-scope rows remain explicit unsupported behavior.

## Gate 3: reproducible baselines — accepted

Before the implementation branches diverge, capture the current renderer as a
difference baseline. Each workload records:

- Royal commit and packed/build entrypoints;
- asset URI plus immutable version/hash and server compression/range/cache
  behavior;
- browser/device/OS, capabilities, resolution, DPR/render scale and refresh;
- cold and warm network/load timelines and readiness transitions;
- main-thread long tasks, worker decode, upload, CPU/GC/GPU frame timing;
- retained and peak CPU/GPU/transient/upload measurements;
- camera path or fixed poses, screenshots/pixel captures and console messages;
- XR session, visibility, passthrough/thermal conditions where applicable.

Minimum workload set:

- minimal direct primitive and minimal embedded glTF;
- Damaged Helmet and material/texture compatibility assets;
- Ghostscript Tiger SVG and VT close-view stress;
- picking proxy and alpha-mask silhouette cases;
- instancing, variants, authored LOD and multi-view/XR scenes;
- Sponza and A Beautiful Game for broad scene/material behavior;
- the web-tier Bistro workload for large-scene DX, loading, memory, texture
  settlement, responsiveness and camera-dependent frame performance.

Bistro's version-pinned web tier is an explicit large example workload, not
package runtime content: it is copied only into the examples deployment and is
excluded from every published Royal package. The harness emits a stable
machine-readable report Royal can compare.

The old baseline is not automatically correct. Each comparison classifies a
difference as intended spec correction, old bug, new bug, acceptable quality
change, or unresolved oracle conflict.

## Gate 4: first-slice contract — accepted

The first implementation slice is deliberately smaller than feature rendering.
It establishes:

- final public package entrypoints with compile-only consumer fixtures;
- explicit context/root lifecycle and idempotent disposal;
- one demand and clock authority, including an external-clock token;
- ordered view input and a complete clear-frame intent;
- one pure GL state transition model and one imperative state owner;
- one GL lane/resource generation with context loss/restoration;
- cold bounded lifecycle/frame observation;
- a CSS-sized clear-only Canvas and lower-level root example.

It does not parse glTF, create material/geometry systems, start workers, or add
temporary feature stubs that return plausible content. Unsupported render nodes
fail clearly. The slice is accepted with lifecycle/failure properties, minimal
GL-call evidence, context-loss browser coverage, packed consumer builds, idle
settlement, bundle attribution, and physical context/canvas smoke tests.

The next slice introduces one canonical visible and pickable surface through
both direct and minimal-glTF input. This sequencing prevents geometry, picking,
glTF, XR, and VT from defining competing roots or executors.

## Bistro acceptance role

The Bistro workload is a release-scale adversarial consumer, not a special-case
optimization target. Royal MUST NOT branch on its URL, asset names, camera, or
example flag. It is valuable because it simultaneously pressures:

- consumer asset/status/diagnostic ergonomics;
- request concurrency and progressive geometry/image publication;
- codec and texture upload scheduling;
- peak decoded/transient/persistent memory;
- main-thread responsiveness and worker amortization;
- culling, material/state transitions, fragment load and camera-dependent FPS;
- failure visibility when textures never settle.

Improvements must generalize to the canonical paths and be verified on at least
one smaller analytic workload. Bistro does not replace target-device tests and
does not justify widening Royal into an asset pipeline or game engine.

## Start decision — satisfied

Execution started after:

1. the current specification set and rewrite strategy are committed;
2. the consumer contract has no blocking open choice;
3. the baseline capture schema is implemented and the critical old-renderer
   baselines are stored or reproducibly obtainable;
4. the isolated branch/worktree and first-slice acceptance commands are named;
5. any simultaneous work is limited to spec-stable fixtures, evidence, or leaf
   modules with explicit ownership.

The remaining physical-device gap is tracked in the conformance ledger. Current
reports must carry an exact source/build identity; stale Safari or Quest pages
are not admissible evidence. The Bistro workload remains an adversarial
consumer and is not a prerequisite for continuing implementation.

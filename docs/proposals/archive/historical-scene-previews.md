# Historical scene previews with two renderer roots

Status: closed Royal design decision (2026-09-08). Keep the consumer
implementation; no new Royal API is accepted. Reconsider only when the
measurements below demonstrate a renderer-side bottleneck.

## Decision

Probability should keep using a second `@royal/react` `Canvas` for the History preview. Create at most one History root, only while the preview is visible, keep it at DPR 1, cap its CSS pixel dimensions, give it an explicit product-measured `persistentGpuByteBudget`, and dispose it when the History surface closes. Failure to create or restore this optional context is an unavailable-preview state; it must not disturb the live root or disable restore.

Do not add a Royal abstraction that claims two canvas roots can share WebGL memory. Each HTML canvas owns a distinct WebGL context, and WebGL buffers, textures, programs, vertex arrays, framebuffers, and other GPU objects belong to that context. Ordinary WebGL2 exposes no cross-context share group. Two roots must therefore upload and retain separate GPU copies even when they render the same model.

The roots may share work before GPU upload:

- the application's model session and historical document projection;
- immutable source bytes held by a host asset provider;
- browser HTTP-cache entries and content-addressed object storage; and
- in a future explicit Royal pool, parsed glTF data and immutable canonical CPU geometry.

That can improve latency and CPU memory, but it does not remove the second root's GPU cost. Do not build the pool until measurements show duplicated Royal preparation is the remaining material problem.

## Historical assets are independent of the live scene

A historical scene is not limited to assets currently claimed by the live root. It may contain:

- a model or card that was later removed from the game;
- a different version of a model that is still present;
- cards or textures introduced and then deleted; or
- assets that were never visible in the current game state.

The History root must receive the exact scene and exact asset identities for the selected historical heads. For glTF, Royal already distinguishes `src`, `version`, and `sceneIndex`. The consumer's asset provider must remain able to resolve those historical identities even when the current game no longer references them.

Royal cannot recover an asset that has been physically deleted from its backing store. Probability must retain immutable historical bytes, use content-addressed storage, or define an honest missing-asset presentation. Reusing a mutable URL for different historical content is invalid even if a browser cache happens to contain an older response.

External glTF buffers and textures loaded through `gltfResourceReader` inherit the root asset's version. Direct image textures need equally stable URLs or self-contained data sources. Add a general texture-reader/version seam only if a real historical direct-texture case cannot use those existing identities.

## Consumer ownership

The consumer should:

1. Reuse the live model session and already-prepared document projection when they cover the selected historical heads.
2. Open a historical session only when the selected version needs releases or assets absent from the live session.
3. Coalesce scrubber changes so intermediate historical states do not mount or prepare renderer work.
4. Keep the last completed preview visible while the next selection prepares, using the preload-and-handoff boundary below rather than assuming a scene commit retains old pixels.
5. Pass the History canvas the selected scene and all exact asset claims required for that version.
6. Dispose superseded historical sessions and the History root deterministically.

The restore action must remain independent of preview readiness. A missing or failed preview must not prevent the user from selecting or restoring a historical version.

### Last-good preview handoff

Selection, preparation, and presentation are three different states. Update the selected version and its textual facts immediately, but leave the History root's currently presented scene installed while the settled candidate prepares.

For glTF candidates, retain the current scene's claims and add the candidate's exact `gltfAssetClaims`. Observe those exact identities. When they reach an accepted completed state, atomically install the candidate scene and its complete retained claims; moving one identity from a non-visual claim into the scene reuses its prepared geometry and decoded material images. An error should publish the honest unavailable-preview state while leaving the last successful presentation installed.

This boundary prepares no GPU surfaces or textures before the scene handoff. It prevents repeated source reads, parsing, and image decoding, but the new scene still performs its context-local GPU admission and upload. Probability must decide whether a completed `degraded` glTF is an acceptable missing-texture preview or a failed exact preview.

Direct image textures do not currently have an equivalent non-visual preload claim. Therefore the stronger last-good guarantee applies only when every changing visual dependency can be preclaimed, or when Probability deliberately accepts Royal's documented progressive/fallback presentation after handoff. Do not add a general texture preload API until an actual historical direct-texture case demonstrates the need.

## Why not a live-root snapshot API now

A one-shot offscreen snapshot on the live root is the smallest plausible route that could avoid a second context's duplicate GPU allocations. It remains a possible future optimization when History needs only a still image, but it is not the requested two-canvas design.

A correct snapshot facility would need to:

- prepare alternate scene assets that may be absent from the live game;
- retain those temporary claims without evicting live claims;
- render to an offscreen framebuffer without replacing live scene, picking, camera, overlay, or canvas pixels;
- schedule atomically around live frames;
- coalesce and abort obsolete scrub requests;
- bound transient GPU bytes, dimensions, concurrency, and readback;
- survive context loss and root disposal; and
- prove pixel equivalence with an ordinary root.

Do not implement that machinery merely to simulate a second canvas. Revisit it only if measured duplicate GPU residency becomes unacceptable and a still image is sufficient for the History UX.

## Other same-context designs

One WebGL canvas can render a live scene and a historical scene into separate scissored viewports or offscreen targets. Because both presentations belong to one context, identical assets could share context-local GPU storage. That is technically different from two canvas roots, but it is not a smaller general solution here:

- one physical canvas cannot occupy two independent DOM layout positions, clipping stacks, or tab lifetimes without making the application coordinate its layout with renderer viewports;
- an offscreen WebGL texture can be sampled only by its owning context, so a "screen-space texture" does not become content for another HTML canvas or element;
- moving offscreen pixels into another DOM surface requires a readback, bitmap/copy path, bounded dimensions, cancellation, and ownership equivalent to the snapshot facility above; and
- a persistent multi-scene root would need independent claims, cameras, picking, overlays, scheduling, failure states, budgets, and disposal for each view.

Moving the one live canvas between Game and History would avoid the second context, but historical preparation and presentation would replace live retained state and make returning to Game pay restoration work. It is suitable only if the product deliberately chooses one renderer presentation at a time and measures that switch as cheaper than retaining two roots.

Do not add multi-view root semantics for a preview that is already expressible as an independently owned canvas. Reconsider the snapshot route for still previews, or persistent same-context views only if the product later requires two continuously rendered views and duplicate GPU residency is the measured blocker.

## Why not a preparation pool now

An explicit pool could eventually be supplied to multiple roots:

```ts
const pool = createRendererPreparationPool(provider);
const live = createRendererRoot(liveCanvas, options, { pool });
const history = createRendererRoot(historyCanvas, options, { pool });
```

Such a pool could share immutable context-independent work:

- coalesced source reads and completed bytes;
- parsed glTF metadata and selected-scene structure;
- canonical CPU geometry and derived bounds; and
- decoded image sources where browser ownership permits safe reuse.

It could not share context-specific buffers, textures, programs, vertex arrays, framebuffers, GPU budgets, context restoration, or disposal. Closing one root must not cancel pooled work retained by the other. Pool diagnostics would need to separate shared CPU bytes from per-root GPU bytes and key every entry by provider identity plus exact content revision.

Royal's current `gltfResourceReader` contract also allows returned byte storage to become Royal-owned or transferred. A host cache must return an unretained view or copy; it cannot hand the same transferable backing buffer to two roots. A real pool would need an internal immutable ownership contract rather than pretending that using the same reader already shares storage.

The local prototype's largest improvement came from consumer-side session reuse and scrub coalescing before any renderer pool existed. That makes a new pool speculative until new profiles prove otherwise.

## Evidence

Probability's History tab uses a continuous horizontal scrubber to preview an Automerge document at selected historical heads. A short drag may select many checkpoints faster than a renderer should prepare them.

The prototype mounts a second DPR-1 Royal canvas only while its 3D preview is visible. Probability reuses its live model session and prepared CPU projection when those resources cover the selected version, and opens a historical session only for releases absent from the live game.

A headless Chromium/SwiftShader diagnostic with 73 generated Bus-shaped pieces and 100 real Automerge edits measured about 3.2 seconds to first History controls before consumer-side reuse and coalescing. Reusing live model resources and deferring preview work until scrubbing stopped reduced the same cold path to about 1.4 seconds while live preparation was still running, and about 0.43 seconds after it settled. A 41-event pointer scrub then took about 0.86 seconds. These are local diagnostics, not acceptance thresholds.

## Cases to verify in Probability

- The selected version references a model deleted from the current game but still present in historical storage.
- The same logical model has a different historical content version.
- A historical card uses art or texture data absent from the live scene.
- The selected asset is genuinely missing, corrupt, slow, or unauthorized.
- Rapid pointer and keyboard scrubbing select hundreds of versions, but only the final settled selection prepares.
- The History tab closes, hides, reopens, or moves while preparation is pending.
- The live Game tab closes before the History preview.
- Either WebGL context is lost and restored independently.
- Repeated opening and closing releases the History root's GPU residency.

## Measurements before reconsidering Royal work

Measure a representative game with repeated glTFs and a historical version containing currently absent models:

- time to first correct preview and final preview after a 100-checkpoint scrub burst;
- duplicate source reads and glTF preparation jobs;
- live-root and History-root GPU bytes separately;
- the History root's peak backing dimensions and explicit persistent budget;
- host/provider retained bytes and duplicated canonical CPU bytes;
- context count, context-creation failure, and independent context-loss behavior; and
- cleanup after 100 version selections and 20 History mount cycles.

If duplicated source/preparation work dominates, prototype the explicit CPU preparation pool. If duplicate GPU residency dominates and History only needs a still, prototype live-root offscreen snapshots. If neither dominates, keep the existing two-root design.

## Rejected directions

- claiming that two WebGL canvases share GPU allocations;
- a process-global implicit cache without provider identity or deterministic disposal;
- replacing the live root's scene and then restoring it;
- screenshotting the live canvas when the historical scene differs;
- keeping one hidden renderer root per historical version;
- relying on a mutable URL or incidental HTTP cache as historical storage; and
- preventing restore because an exact preview asset is unavailable.

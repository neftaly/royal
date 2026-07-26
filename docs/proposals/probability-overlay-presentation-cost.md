# Probability: overlay presentation cost after separate publication

Status: renderer fix implemented and renderer-level verification complete.
Representative-device execution is currently blocked in Probability before
Royal mounts. Probability should not work around the presentation cost inside
application state or add a second renderer.

## What the new API solved

Probability integrated the `sceneOverlay` / `Canvas.overlay` API against the
loaded Settlers package. It now projects selection outlines and
movement guides outside the physical scene and outside picking. Local hover
uses `Canvas.rendererRef.current.setOverlay(...)`, so it does not rerender the
React `Game`, replace the base `Scene`, publish presence, or edit the document.

The visual and ownership results are correct. A reduced-opacity wireframe from
the existing exact `SupportShape` follows the hovered robber and renders above
the opaque board.

## Remaining measured cost

On headless Chromium's software WebGL path, adding, clearing, or re-adding that
one hover overlay causes a roughly 350 ms GPU commit on the fully loaded
Settlers fixture:

- initial declarative prototype: about 341 ms;
- warm declarative re-add: about 362 ms;
- declarative clear: about 314 ms;
- imperative `setOverlay` clear with no base React render: about 351 ms.

A UI-only hover during the same loaded session caused no corresponding GPU
commit. Traces are:

- `/tmp/prob-overlay-hover.json.gz`
- `/tmp/prob-overlay-hover-warm.json.gz`
- `/tmp/prob-overlay-clear.json.gz`
- `/tmp/prob-overlay-imperative-clear.json.gz`
- `/tmp/prob-overlay-ui-baseline.json.gz`

The imperative control separates the cause: this is no longer base-scene
publication from Probability. `CanvasRoot` still draws `#surfaceGpu.drawViews`
before `#overlayGpu.drawViews` for every overlay invalidation, so total overlay
latency includes a complete world render.

Software WebGL is not representative evidence for a production GPU budget, but
the current acceptance statement that an overlay transition is comfortably
inside one frame is not established merely by separating scene preparation.

## Decision

Royal now combines the world-space overlay lane with a renderer-owned,
screen-space copy of the completed base presentation. This is not a public
screen-space overlay API. Overlay geometry still uses the scene camera and
world transforms; the retained image only avoids repeating unchanged world
draws.

On the first non-empty overlay after a world change, Royal:

1. clears and renders the complete world normally;
2. copies the final default-framebuffer RGBA8 color into one retained texture;
3. draws the depth-independent overlay.

On a subsequent overlay-only add, replace, clear, or render-object-ref update,
Royal draws that retained color back to the same canvas with one fullscreen
triangle, then draws only the current overlay. Clearing an overlay restores the
unmodified base color.

The retained target:

- belongs to the existing `CanvasRoot`, WebGL context, state owner, and
  persistent GPU budget;
- costs `backingWidth * backingHeight * 4` bytes while retained;
- stores final presentation color, after any scene composite, tone mapping,
  exposure, and color conversion, so restoration does not apply those stages
  twice;
- has no depth attachment because overlay draws deliberately disable depth
  tests and depth writes;
- is allocated only after an overlay is used;
- remains available across a clear for a warm re-add, but is released on the
  next world invalidation while no overlay exists;
- falls back to a correct complete world render if allocation is denied.

World scene/camera changes, animation and render-object updates, resize/DPR,
environment or texture publication, progressive resource work, context loss,
and explicit root invalidation all mark the retained result stale. The next
overlay presentation then rebuilds it from a complete world frame. Context loss
abandons invalid WebGL handles and restoration redraws normally.

External/XR frames keep their existing full multi-view path. They draw the
overlay in each supplied framebuffer and invalidate any ordinary-canvas
retained result; Royal does not reuse a mono canvas image for XR views.

## Adversarial alternatives review

- CSS `z-index` cannot order draws within one WebGL canvas. It would require
  another DOM element or canvas and therefore split sizing, alpha composition,
  input, context loss, and XR authority.
- A second overlay canvas or WebGL context makes the apparently cheap layer a
  second renderer lifecycle and cannot participate correctly in Royal's XR
  framebuffer submission.
- `preserveDrawingBuffer` asks the browser to retain every frame globally. It
  does not identify whether the preserved pixels still match the world and can
  impose cost when overlays are never used.
- A separately rendered transparent overlay texture still needs a base image
  to reconstruct the default framebuffer. It adds another full-size target
  without eliminating that requirement.
- A retained screen-space texture is appropriate only as the private cache
  implemented here. Making overlay content itself screen-space would lose
  world projection and frustum behavior.
- A framebuffer blit is cheaper in some implementations but is not generally
  valid here: Probability requests an antialiased default framebuffer, and
  WebGL forbids blitting the retained single-sample texture into that
  multisampled target. The fullscreen draw works for both context modes.

## Verification and remaining evaluation

Royal integration tests assert that warm overlay replace, clear, and re-add
issue fullscreen presentation draws and no base-world draw calls. They also
assert that an explicit world invalidation forces a complete redraw and fresh
copy before overlay-only restoration can resume. The full Royal test,
typecheck, lint, and build suites pass.

The loaded Settlers fixture was then repeated in the same headless Chromium
software-WebGL environment used for the original evidence. Instrumented WebGL
command counts and trace events showed:

- warm clear: one retained-color presentation draw, zero world or overlay
  surface draw calls, a 43.0 ms `Commit`, and a 37.6 ms `GPUTask`;
- warm re-add: one retained-color presentation draw, one outline draw call, a
  48.3 ms `Commit`, and a 41.8 ms `GPUTask`.

The corresponding traces are:

- `/tmp/prob-overlay-retained-draw-clear.json.gz`;
- `/tmp/prob-overlay-retained-draw-readd.json.gz`.

That removes the measured complete-world redraw: the earlier imperative clear
had a 355.9 ms `Commit` and 350.6 ms `GPUTask`. Trace collection itself adds
overhead, and software WebGL is still not representative device evidence, but
the command counts establish the intended renderer boundary directly.

Connected-device execution was attempted on a Quest 2 and a 2018 iPad
(`iPad7,6`, iPadOS 17.7.11) against the production Probability play build. Both
browsers loaded the application shell, then failed with
`TarstateParseError: schema_tools.artifact_build_invalid` before creating a
canvas or mounting Royal. The iPad result was captured through WebKit Inspector
with `document.readyState === "complete"`, an empty body, no canvases, and the
same exception in the console. This is a Probability artifact/schema
compatibility blocker, not a renderer failure, so it does not block committing
the Royal implementation.

Once Probability can load the fixture on those devices, its remaining
acceptance task is to measure total pointer-to-present latency for repeated
overlay add/replace/clear transitions. That measurement should count the
completed GPU/presentation frame, not only JavaScript publication.

The first overlay after a stale or absent cache still intentionally pays for a
complete world frame; acceptance should distinguish that cold transition from
warm overlay-only transitions.

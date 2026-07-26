# Atomic canvas resize presentation

Status: resolved in Royal's canvas resize path.

## Consumer failure

Probability resizes a retained Royal canvas while dragging a workspace split.
The CSS resize is visible immediately, `observeCanvasSize` publishes the new
backing size in one animation frame, and the renderer presents the replacement
frame later. Assigning `canvas.width`/`height` clears the default framebuffer, so
one recorded browser frame is entirely black.

This was reproduced from the built Probability app in Chromium video rather
than inferred from DOM completion. The frame before and after contain the game;
the intervening frame contains only the workspace chrome and a black canvas.

An additional app-boundary check on Royal main `3f91f219` dragged the workspace
separator through 60 live size updates with loaded Settlers. `Game` rendered
exactly once in total, and the existing canvas and renderer root remained
mounted. This rules out React reconciliation, scene replacement, and canvas
replacement as the source of the gap.

Probability can hide the clear with an alpha canvas and a CSS background, but
that changes context/compositing policy for an ordinary opaque scene and cannot
preserve the last rendered pixels. A renderer canvas should resize without
exposing its cleared backing store.

## Implemented Royal behavior

Royal now couples backing-store replacement to an internal synchronous
invalidation and flush. The retained scene redraw occurs in the same resize
callback that assigns `canvas.width` and `canvas.height`, before the browser can
present the cleared default framebuffer.

The primitive remains Royal-owned. Probability does not need to call
`setSize`, schedule renderer frames, or mirror the retained scene.

## Acceptance evidence

- Record a continuously resized, already-loaded opaque canvas at display frame
  rate.
- No frame may contain the WebGL default clear color or omit the prior/current
  presentation.
- Verify both width-only and height-only changes, DPR changes, empty scenes,
  context restoration, and repeated resize events in one frame.
- Preserve coalescing for redundant observer notifications and do not introduce
  an always-running render loop.
- Compare ordinary opaque-canvas frame cost before and after; avoiding the flash
  must not require consumers to opt into alpha compositing.

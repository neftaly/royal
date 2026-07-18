# @royal/renderer-webgl

Royal's imperative WebGL2 renderer root. React applications normally use
`@royal/react`; this package is for hosts that already own an HTML canvas.

```ts
import { perspectiveCamera, scene } from "@royal/renderer-core";
import { createRendererRoot } from "@royal/renderer-webgl";

const root = createRendererRoot(document.querySelector("canvas")!, {
  alpha: true,
  antialias: true,
});

root.setSize({
  cssWidth: 800,
  cssHeight: 450,
  devicePixelRatio: window.devicePixelRatio,
});
root.render(scene({
  camera: perspectiveCamera({ position: [0, 0, 3] }),
  clearColor: [0.03, 0.06, 0.12, 1],
  nodes: [],
}));

root.dispose();
```

The root owns one WebGL2 context, its backing dimensions, frame scheduling,
context-loss recovery, and WebGL state. `alpha` and `antialias` default to
`true`; they are immutable because browsers fix context attributes at context
creation. Invalid values and unknown option fields fail synchronously.

`invalidate()` requests one coalesced frame. `flushInvalidated()` is available
to deliberate imperative hosts, while `acquireExternalClock()` transfers frame
authority to an external clock until its idempotent `release()`.

`getSnapshot()` and `subscribe()` expose the broad operational snapshot.
`getLifecycleSnapshot()` / `subscribeLifecycle()` and
`getSizeSnapshot()` / `subscribeSize()` are focused streams that do not wake for
unrelated frames.

The replacement is being implemented in vertical slices. This package currently
accepts empty scenes and rejects non-empty scene nodes explicitly; it does not
silently call the legacy renderer. Optional capability and WebXR subpaths will
return only with their working feature slices.

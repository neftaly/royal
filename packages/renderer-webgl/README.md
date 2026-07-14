# @royal/renderer-webgl

Royal's WebGL2 backend for pure `@royal/renderer-core` scene descriptors.

React applications should normally use `@royal/react`, which owns canvas and
renderer lifetimes. Use `createWebGlRoot` directly when the host already owns a
canvas and needs imperative rendering.

```ts
import { perspectiveCamera, scene } from '@royal/renderer-core';
import { createWebGlRoot } from '@royal/renderer-webgl';

const root = createWebGlRoot(document.querySelector('canvas')!);
root.render(scene({
  camera: perspectiveCamera({ position: [0, 0, 4] }),
  nodes: [],
}));

// Later, when the host releases the canvas:
root.dispose();
```

The root owns its WebGL2 context and GPU resources. Renderer creation options
are fixed for its lifetime. Use `invalidate()` for imperative changes,
`snapshot()` for lifecycle and planning state, and bounded operational
diagnostics from the root snapshot. Always call `dispose()`.

## Entrypoints

- `@royal/renderer-webgl` — root creation, renderer policies, snapshots, and
  imperative rendering types.
- `@royal/renderer-webgl/capabilities` — explicit WebGL/WebGPU capability
  probing and summaries.
- `@royal/renderer-webgl/webxr` — low-level WebXR render-layer integration.

Royal is currently a private source-level prerelease. See the repository
[README](../../README.md) and [changelog](../../CHANGELOG.md).

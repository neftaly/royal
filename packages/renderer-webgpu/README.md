# @royal/renderer-webgpu

Executable WebGPU API-risk spike for Royal renderer planning.

This package is intentionally private and thin. It does not add a public root,
React wiring, or an examples route. The point is to make WebGPU pressure
observable in tests before changing renderer-core or the existing WebGL2 root.

## What It Exercises

- WebGPU adapter/device probing through injected browser-like objects, so tests
  run safely in Node.
- WebGL2 fallback boundaries for Royal renderer feature requirements.
- Royal scene traversal for pass, mesh, geometry, and material descriptors.
- Backend buffer and material shapes for the first box-mesh workload.
- A browser-only `renderWebGpuProbeTriangle` helper that can clear and draw a
  single triangle when a real WebGPU canvas is available.

## Commands

```sh
pnpm --filter @royal/renderer-webgpu test
pnpm --filter @royal/renderer-webgpu lint
pnpm --filter @royal/renderer-webgpu build
```

## Suggested API Changes

The spike supports the WebGPU research recommendation that root creation should
become capability-negotiated and async-ready before adding terrain or generated
geometry APIs.

Near-term public API pressure:

1. Root options need an explicit backend mode: `"webgpu"`, `"webgl2"`, or
   `"auto"`.
2. Fallback policy should be part of root creation, not a hidden renderer
   branch. WebGPU-only features such as compute and storage buffers need
   visible `"cpu"`, `"asset"`, `"disable-feature"`, or `"error"` outcomes.
3. Root readiness cannot stay purely synchronous for all backends. WebGPU needs
   adapter and device negotiation before rendering.
4. Geometry needs an asset or buffer descriptor path. Current Royal mesh
   geometry only exposes a kind-specific descriptor, so the renderer still owns
   all lowering and upload policy.
5. Material texture assets need an explicit async resource boundary. A solid
   texture can become a uniform immediately; an image-backed texture cannot.
6. The ordered pass list is enough for a first draw probe, but resource
   dependencies and compute outputs will need a resource-aware graph before
   terrain, readback, or GPU culling are made public.

## Fallback Boundary Snapshot

| Royal feature | WebGPU probe | WebGL2 fallback pressure |
| --- | --- | --- |
| `indexed-geometry` | baseline renderer capability | WebGL2 draw-elements path |
| `uint32-indices` | baseline renderer capability | WebGL2 path, with chunking policy still research |
| `instancing` | baseline renderer capability | WebGL2 instancing path |
| `compute-pass` | baseline WebGPU capability | CPU, baked asset, disable, or error |
| `storage-buffer` | baseline WebGPU capability | CPU packing, texture/uniform indirection, disable, or error |
| `timestamp-query` | adapter feature gate | WebGL2 timer extension, CPU timing, disable, or error |
| texture compression | adapter feature gate | asset transcoding, disable, or error |
| `texture-asset` | async texture upload path | existing WebGL2 texture loader shape, but still async |

## Still Research

- A real WebGPU root and render loop.
- WebGPU shader variants for Royal standard, unlit, and wireframe materials.
- Texture asset decoding/upload and sampler/cache ownership.
- glTF, text, SVG path, indexed geometry asset, and terrain lowering.
- GPU timing, readback, and browser acceptance harnesses.
- Shared public `createRoot` and React `Canvas` API changes.

Descendants-open status: none opened by this spike.

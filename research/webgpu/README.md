# Royal WebGPU API Break Research

Date: 2026-06-28

## Scope

This is a research note only. It does not change renderer-core, React exports,
examples, package config, text-vector, or the blender pipeline.

## Readiness Fixture

`fixtures/backend-choice-cases.json` makes the backend-selection recommendation
executable without requiring a browser or WebGPU device. It covers auto,
explicit WebGPU, WebGL fallback, and fallback-error behavior against the
research reducer in `capability-probe.ts`.

Run:

```sh
node research/webgpu/validate-backend-choice-fixture.mjs
```

This is not ready for a real examples route yet. The blocker is the current
synchronous WebGL root contract in the packages. The next prototype step is to
move this reducer into root creation with tests, then add a diagnostic-only
examples probe after async root readiness exists.

Local source checked:

- `packages/react/src/root.ts`
- `packages/react/src/canvas.ts`
- `packages/renderer-webgl/src/root.ts`
- `packages/renderer-webgl/src/capabilities.ts`
- `packages/renderer-core/src/render-graph.ts`
- `packages/renderer-core/src/geometry.ts`
- `packages/renderer-core/src/mesh.ts`
- `packages/renderer-core/src/gltf.ts`
- `packages/renderer-core/src/material.ts`
- `research/terrain/README.md`

## Current Royal Shape

Royal currently exposes a synchronous WebGL2 root:

```ts
const root = createRendererRoot(canvas, options);
root.render(scene);
```

`RoyalRootOptions` group WebGL2 context attributes (`alpha`, `antialias`,
`preserveDrawingBuffer`) under `context`. `Canvas` creates the root
synchronously in a layout effect and renders once the scene child is available.

Renderer-core is intentionally small: a `Scene` is an ordered list of render
passes, a pass owns one camera plus render nodes, `MeshNode` accepts a generic
`Geometry`, and built-in draw support is still box/glTF/vector text oriented.
This is the right time to make backend seams explicit before public APIs imply
that all roots are synchronous WebGL2 contexts.

## Recommendation

Make WebGPU a root/backend capability break before adding terrain, generated
geometry, or advanced material APIs. Do not expose WebGPU-specific component
props first. Instead, break the low-level root contract once so both WebGL2 and
WebGPU can share:

- async readiness
- explicit backend selection
- backend-specific options
- capability negotiation
- feature requirements and fallback policy
- asset-backed indexed geometry
- pass/resource graph boundaries
- explicit compute pass ownership

## Concrete API Breaks

### 1. Root Creation Must Model Async Readiness

Recommended break:

```ts
type RoyalBackendMode = "webgl2" | "webgpu" | "auto";

type RoyalRootOptions = {
  readonly backend?: RoyalBackendMode;
  readonly webgl?: RoyalWebGlOptions;
  readonly webgpu?: RoyalWebGpuOptions;
  readonly requiredFeatures?: readonly RoyalFeatureRequirement[];
  readonly fallback?: RoyalFallbackPolicy;
};

const root = await createRendererRoot(canvas, options);
```

WebGPU requires `navigator.gpu.requestAdapter()` and usually
`adapter.requestDevice()`. That makes synchronous root construction the wrong
default contract. If preserving sync creation is important, the root still needs
a public `ready: Promise<RoyalRootReadyState>` and `render()` must either queue
or return a diagnostic until ready. The cleaner break is `await createRendererRoot`.

React impact:

- `Canvas` cannot assume the root exists during the same layout effect.
- `Canvas` should keep children declarative while root creation is pending.
- Add `fallback`, `onReady`, and `onError`/`onUnavailable` style hooks before
  users need to handle WebGPU permission/device failures themselves.
- Avoid a separate `<WebGpuCanvas>`; backend choice belongs in root options.

### 2. Add `backend: "webgl2" | "webgpu" | "auto"`

Current root options are implicitly WebGL2. Break them into backend-specific
groups:

```ts
type RoyalWebGlOptions = {
  readonly context?: WebGLContextAttributes;
};

type RoyalWebGpuOptions = {
  readonly powerPreference?: "low-power" | "high-performance";
  readonly forceFallbackAdapter?: boolean;
  readonly requiredFeatures?: readonly string[];
  readonly requiredLimits?: Readonly<Record<string, number>>;
};
```

`backend: "auto"` should mean "try WebGPU, then WebGL2 if policy allows".
`backend: "webgpu"` should fail loudly when WebGPU is unavailable unless the
caller explicitly chooses a fallback.

### 3. Make Capability Negotiation First Class

Capabilities should be stable facts on the root, not ad hoc backend checks:

```ts
type RoyalCapabilities = {
  readonly backend: "webgl2" | "webgpu";
  readonly features: ReadonlySet<RoyalFeatureRequirement>;
  readonly limits: Readonly<Record<string, number>>;
  readonly diagnostics: readonly RoyalCapabilityDiagnostic[];
};
```

Renderer-core nodes or asset factories should declare requirements such as
`"indexed-geometry"`, `"instancing"`, `"storage-buffer"`, `"compute-pass"`,
`"timestamp-query"`, or `"texture-compression-bc"`. The root chooses whether to
render, degrade, or reject based on policy.

The existing WebGL2 capability probe already collects compressed texture, timer
query, and WebGPU feature rows. WebGPU should extend that shape rather than
invent a separate reporting mechanism.

### 4. Add Indexed Geometry And Geometry Assets Before Terrain

`Geometry` currently carries only a kind-specific description. Terrain, glTF
internals, instancing, and future generated meshes need a real asset contract:

```ts
type GeometryAsset = {
  readonly attributes: readonly GeometryAttribute[];
  readonly indices?: IndexBufferSource;
  readonly topology?: "triangle-list" | "triangle-strip" | "line-list";
  readonly bounds?: Bounds3;
  readonly usage?: "static" | "dynamic" | "stream";
  readonly requirements?: readonly RoyalFeatureRequirement[];
};
```

Recommended break: make `MeshNode.geometry` accept either a procedural geometry
descriptor or a `GeometryAsset`/asset handle with explicit upload ownership.
This should land before any public terrain or generated mesh API.

WebGL2 degradation:

- Use `drawElements` for indexed geometry.
- Require WebGL2 support for `uint32` indices.
- Split large meshes into `uint16` chunks when allowed by fallback policy.
- If no fallback is allowed, emit a capability diagnostic instead of silently
  drawing the wrong mesh.

### 5. Replace Ordered Passes With A Resource-Aware Pass Graph

Current `Scene.children` is an ordered list of camera render passes. WebGPU
needs explicit resources and dependencies for textures, buffers, depth targets,
MSAA resolves, readback, and compute outputs.

Recommended break:

```ts
type RenderGraph = {
  readonly resources: readonly RenderResource[];
  readonly passes: readonly RenderPassNode[];
};

type RenderPassNode =
  | RenderDrawPass
  | RenderComputePass
  | RenderCopyPass;
```

Do not hide compute inside materials or terrain components. A compute stage
should declare which buffers/textures it reads and writes, then a draw pass
consumes those resources. WebGL2 roots can reject compute passes, use CPU
precomputation, or consume baked assets according to fallback policy.

### 6. Define Compute Pass Boundaries Explicitly

WebGPU compute is the pressure point for terrain LOD, elevation fields, GPU
culling, particle simulation, texture generation, and readback. Public API
should model compute as a pass boundary with named resources, not as a boolean
prop.

Minimum contract:

- required features and limits
- input resources
- output resources
- dispatch size or data-domain size
- fallback behavior (`"cpu"`, `"asset"`, `"disable"`, `"error"`)
- readback permission and latency expectations

WebGL2 cannot execute compute. It can only consume precomputed buffers/textures
or run CPU equivalents.

### 7. Put Fallback Policy In The Root

Recommended shape:

```ts
type RoyalFallbackPolicy =
  | "error"
  | "webgl2"
  | "disable-feature"
  | "cpu"
  | "asset";
```

The policy should be root-level and overridable by asset/node requirements.
Silent fallback is dangerous for benchmarks and visual correctness. Diagnostics
must say which feature degraded and why.

## WebGPU-Only Degradation Matrix

| Feature | WebGPU path | WebGL2 degradation |
| --- | --- | --- |
| Compute terrain/elevation | compute pass writes buffers/textures | CPU task or baked asset; no GPU compute |
| Storage buffers | storage/read-write buffers | uniform buffers in WebGL2, textures, or CPU packing; often feature disabled |
| Indirect draws/GPU culling | compute-generated draw args | CPU culling and explicit draw calls |
| Large indexed geometry | `uint32` indices broadly available | WebGL2 or chunk to `uint16` |
| Instancing | core instanced draws | WebGL2 instancing; otherwise duplicate draws |
| Timestamp queries | WebGPU `timestamp-query` | WebGL2 timer queries or CPU timing |
| Texture compression BC/ASTC/ETC | WebGPU feature gates | WebGL2 compressed texture extensions or transcoded fallback |
| Readback/query buffers | mapped/readback buffers | async `readPixels`/PBO only where available, otherwise unsupported |
| Multi-target pass graph | explicit attachments/resources | WebGL2 FBOs if supported; otherwise split passes or disable |

Public React API consequence: components should declare requirements or consume
capability state, but should not expose backend-only props that become no-ops on
WebGL2. Prefer diagnostics and fallback boundaries over implicit behavior.

## Capability Probe Sketch

`capability-probe.ts` is a standalone browser-side sketch. It does not import
Royal packages and is not part of the workspace build. It shows the minimal
shape needed for:

- probing WebGPU adapter features and limits
- optionally checking Royal WebGL2 availability
- choosing a backend for `"webgl2"`, `"webgpu"`, or `"auto"`
- returning missing feature diagnostics before root/device construction is
  wired into public APIs

## Initial Benchmark Plan

Start with a benchmark matrix that can run on WebGL2 today and add WebGPU when a
private backend exists.

1. WebGL2 parity
   - same scene, camera, clear color, box mesh, glTF, and vector text output
   - compare draw counts, first draw time, and pixel differences
2. Buffer upload
   - static upload: one large indexed mesh
   - dynamic upload: replace vertex/index data every frame
   - streaming upload: many chunk-sized buffers per frame
3. Draw scaling
   - 1, 10, 100, 1,000, 10,000 mesh submissions
   - record CPU frame time, GPU time where available, and diagnostics
4. Instancing
   - one geometry with many transforms
   - compare WebGL2 path against WebGPU instancing
   - include duplicate-draw mode for correctness comparisons only
5. Terrain LOD
   - reuse the terrain research budgets: selected leaves, chunk churn, upload
     bytes, draw count, and frame time while moving the camera
   - test baked asset mode, CPU-generated mode, and WebGPU compute mode once
     available
6. Timestamp queries
   - WebGPU `timestamp-query` when supported
   - WebGL2 timer query support when available
   - CPU timing fallback with an explicit "not GPU time" diagnostic

Benchmark output should include backend, adapter/vendor/renderer label,
features, limits, fallback decisions, and whether GPU timings are disjoint or
unavailable.

## Near-Term Implementation Order

1. Add private root/backend factory internals that can return an async-ready
   root without changing public exports yet.
2. Move current WebGL2 options under a private backend option object.
3. Add private capability rows for root selection and diagnostics.
4. Add private indexed geometry upload/cache in the WebGL2 backend.
5. Prototype WebGPU root behind a non-exported test hook or research harness.
6. Only then break public `createRendererRoot`/`Canvas` options in one release.

The important public break is not "add WebGPU"; it is "Royal roots are
capability-negotiated GPU backends, and readiness/fallback are observable".

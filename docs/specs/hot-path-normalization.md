# Hot-path normalization

Status: architectural decisions plus measurement-gated candidates

## Principle

Variation is handled once at the coldest boundary that has enough information.
Repeated frame and draw work sees canonical semantic records rather than file
formats, browser APIs, extensions, React shapes, or fallback chains.

Canonical does not mean one physical representation. A useful canonical
contract admits a small set of storage layouts without making consumers know
where they came from. It avoids repeated branching and ownership, not merely
type names.

Functional core and one explicit imperative shell are the dominant design
constraint. A less clever implementation with one owner and one testable
meaning is preferred to a faster-looking implementation with hidden WebGL
state, duplicated caches, or engine-specific tricks. Optimize after traces show
a product-path bottleneck.

Every normalization proposal is evaluated against:

- bytes copied during preparation;
- peak and retained CPU/GPU memory;
- time to first drawable scene;
- per-frame CPU and garbage;
- GPU bandwidth, overdraw, and draw calls;
- context restoration and cancellation complexity;
- code/bundle size and test matrix;
- fidelity and fallback behavior.

## Decisions to adopt

### Textures

All complete texture sources lower to one prepared upload-plan contract. VT
pages retain a narrower independently scheduled transport record but share the
same storage-class and GPU-format authority. The contracts permit a small
semantic set of compressed/uncompressed/HDR storage classes. Source format
never reaches material binding or drawing. Texture content/allocation identity
is separate from sampling state so the architecture can use WebGL sampler
objects and avoid duplicating image storage for different glTF samplers.

The portable compressed baseline is ETC2/EAC. A better native compressed target
may be selected once during preparation when it uses the same upload and binding
contracts. This is cold representation policy, not a shader or draw variant.

### Geometry

All geometry presents one shader-facing attribute semantic ABI and one prepared
draw-range contract. The physical buffer layout remains a small validated set:
component types, normalization, stride/offset, index width, and optional
attributes are data in a precompiled vertex-input record.

Compatible glTF buffer slices are borrowed or transferred directly. Repacking
is allowed only when it produces a persistent gain such as decoded compression,
shared arena storage, substantially fewer binds, or a reusable dynamic layout.
Royal does not expand every quantized asset into one interleaved float format.

VAOs bind physical layouts to the fixed semantic ABI once. Frame submission
uses prepared numeric vertex-input identity and never walks glTF accessors.

### Materials and shaders

glTF extension objects lower to canonical material factors, texture slots, and
a numeric feature mask. Variant names resolve to prepared material indices at a
scene/asset revision boundary. Drawing sees no extension strings or nested
optional-property walks.

Texture-unit admission and binding plans compile before submission. Program
identity uses stable numeric feature/pipeline keys. Newly needed shaders may
compile lazily; settled draws reuse linked programs and uniform locations.

All active texture slots that use untransformed `TEXCOORD_0` share one varying
and require no coordinate-transform uniforms. A material with any transformed
or alternate-coordinate slot takes the general per-slot path for exact glTF
semantics. This is a pure plan decision made from the canonical material and
resident feature mask, not a draw-time heuristic.

An environment whose authored Euler rotation is exactly zero takes the
canonical identity-rotation program path. That path omits the rotation uniform
and its normal/reflection matrix multiplies; authored nonzero rotations retain
the general path. The choice is made while lowering the environment, remains
exact, and adds no per-frame heuristic or browser-specific behavior.

Feature specialization MUST be reviewed for program explosion. Closely related
cheap arithmetic may remain in a shared shader when another variant costs more
compile time/memory than the branch saves. Screen-copy, VT, alpha mode, unlit,
and clustered-light differences may justify variants because they change
resources or passes.

### Instances, visibility, and LOD

Authored GPU instances, repeated glTF occurrences, and explicit bulk instances
lower to one logical instance record and versioned SoA change protocol. Stable
logical index/ID is separate from compact GPU slot.

Whole primitives and authored LOD levels emit one selected draw-range
representation. A range carries prepared geometry/material, index/vertex
interval, instance interval, bounds revision, and logical occurrence identity.
The executor does not know whether selection used an object bound, LOD set, or
spatial hierarchy.

### Frame packets and resources

Frame plans use a small closed set of compact packet kinds and integer keys.
Owner-held workspaces reuse capacity. Resource recipes name semantic identity,
representation revision, and requirements; reconciliation resolves them to
generation-safe numeric handles.

Root/frame and focused resource observation use retained listener entries.
Publication captures the current retained length, so removals take effect
immediately and additions wait for the next publication without allocating a
snapshot array. Listener and diagnostic failures remain isolated by the same
owner; semantic lifecycle reducers do not invoke observers themselves.

URLs and strings end at content lookup. Diagnostic strings are constructed on
first failure or cold snapshot reads, not for successful draws.

Every packet supplies complete render-state intent. One root-owned WebGL state
owner applies the minimal difference from the last successfully applied intent.
It is the only state shadow; feature arenas request state through packets rather
than binding around it. External GL invalidates this shadow once at the owner
boundary.

### Transforms, cameras, and picking

Static transforms are resolved once per revision. Versioned camera/transform
channels recompute only affected matrices and reuse scratch across views.

Visibility and picking broad phase share retained bounds/revisions. Exact
picking consumes the canonical triangle representation or explicit proxy. It
does not require a copied GPU-oriented mesh, and its scratch/high-water storage
is retained.

## Deliberately rejected simplifications

- **One GPU texture format:** wastes channels, loses sRGB/HDR semantics, or
  throws away portable compression.
- **One physical vertex layout:** expands quantized data and creates large
  startup copies/peaks.
- **Always meshletize:** WebGL2 has no mesh shaders; fine clusters can multiply
  JS/GL draw calls and metadata.
- **Always use one PBR uber-shader:** avoids compile variants but charges every
  fragment and consumes unnecessary texture units/resources.
- **Always specialize every material bit:** creates a combinatorial program
  cache and visible shader compilation stalls.
- **One universal mutable cache/arena:** obscures ownership and couples unrelated
  resource lifecycles. Shared admission grammar does not imply shared storage.
- **One generic async state machine:** asset, texture, VT page, context, and XR
  states have different legal transitions. Reuse transition patterns, not a
  vague lowest-common-denominator status.
- **GPU work because it sounds parallel:** readback, synchronization, bandwidth,
  and fallback costs must be counted.

## Measurement-gated candidates

### Sampler objects

WebGL2 sampler objects separate wrap/filter state from texture image storage.
They are a strong candidate when the same image is referenced with different
glTF samplers. Before adoption, measure current duplicated GPU allocations and
verify texture completeness/max-level behavior, VT-specific sampling, state
restoration, and state-cache interaction. This should simplify identity and
save memory rather than add a second binding system.

### Visibility clusters / meshlets

Offline clusters may store conservative bounds, optional normal cone, contiguous
index range, LOD/material reference, and stable occurrence mapping. They are
valuable when large primitives suffer substantial overdraw or coarse frustum
selection. They are not automatically valuable for many already-small repeated
objects.

Adopt only if traces show selection/overdraw wins exceed metadata and draw-call
cost on Safari, Quest, and desktop. `WEBGL_multi_draw` may accelerate emitted
ranges where supported; the fallback loops over the identical selected ranges.
No cluster identity becomes a public picking ID.

### Packed material blocks

Uniform buffers or packed typed-array material records may reduce repeated
uniform calls. WebGL2 UBO alignment/size limits, driver behavior, buffer update
cost, and dynamic offsets vary. Compare against current precompiled uniform
locations and state suppression on representative material-heavy scenes.

### GPU selection and transform work

Transform feedback or texture-backed GPU transforms may help extremely dynamic
high-count instances. GPU culling is unattractive without indirect submission
because visible results often require readback or still issue all draws. Defer
until CPU traces prove transform/culling cost dominates and a no-readback
submission path exists.

### Upload staging

Dirty instance/geometry ranges should first be coalesced into bounded direct
uploads. Pixel-unpack buffers, fences, and multi-buffer staging are candidates
only after browser traces show direct upload stalls. They MUST NOT double
retained bytes invisibly.

## Optional WebGL capability policy

Capabilities are probed once per context generation, recorded in one immutable
capability snapshot, and consumed during representation/pipeline selection.
Frames MUST NOT call `getExtension` or branch on browser identity.

An optional feature is accepted only if:

1. the canonical fallback has identical semantics;
2. selection is sticky for the representation/context generation;
3. loss/restoration reconstructs the selected revision;
4. the feature can be physically tested and diagnosed;
5. its extra code, state, cache keys, and tests are smaller than measured gain.

| Capability | Policy |
| --- | --- |
| `KHR_parallel_shader_compile` | Keep. It changes readiness scheduling, not shader semantics. Never busy-poll completion. |
| Native compressed texture extensions | Keep behind the one upload plan when the existing transcoder emits a validated target. ETC2/EAC remains the fallback. Review target proliferation against real device memory/bandwidth. |
| `EXT_texture_filter_anisotropic` | Candidate quality win for oblique ground/art planes. Cap by queried limit and quality tier; no identity change. |
| `EXT_disjoint_timer_query_webgl2` | Candidate cold telemetry. Never block/read back in the submitted frame; discard disjoint samples. |
| `WEBGL_multi_draw` | Candidate executor acceleration for many compatible selected ranges. Same packet/range fallback loop is mandatory. |
| `OVR_multiview2` | Candidate XR acceleration. Same ordered view semantics and non-multiview fallback are mandatory. |
| Occlusion queries (WebGL2 core) | Candidate only for coarse hierarchy/cluster nodes with temporal results. Never one query per object and never block. |
| Pixel-unpack buffers and sync objects | Deferred pending measured upload stalls; browser implementations may add copying/synchronization overhead. |
| Transform feedback | Deferred pending a proven dynamic-instance workload and no-readback architecture. |
| `WEBGL_lose_context` | Test harness only, never product behavior. |

`EXT_color_buffer_float` is currently a semantic requirement for Royal's
scene-linear material composition, not an optional optimization. If a correct
lower-range presentation path is later specified, it may become a capability
tier; until then missing support fails root construction clearly.

## Review questions for every new path

- Can the variation be erased one stage earlier?
- Can compatible source storage be borrowed rather than copied?
- Does this add a packet kind, shader bit, allocation identity, or observer?
- Is a fallback already representable by the same contract?
- What wakes deferred work, and what prevents retries every frame?
- What survives context loss, and who owns its reconstruction recipe?
- Does the optimization save deployed bytes, startup, peak memory, retained
  memory, CPU, GC, GPU bandwidth, fragments, or calls? Which one was measured?
- Does it improve the representative scene or only a microbenchmark?

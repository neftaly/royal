# Assets and glTF ingestion

## Asset boundary

glTF, buffers, images, SVG, manifests, and codec payloads are untrusted data.
They have no authority over Royal's application state, DOM, renderer options,
camera ownership, or resource budgets.

Ingestion MUST validate finite values, integer/range arithmetic, buffer bounds,
accessor alignment, hierarchy recursion, declared required extensions, decoded
dimensions, and resource admission before publication. Validation failures MUST
identify the asset and relevant semantic location without dumping its contents.

`.gltf` JSON and `.glb`, external/data-URI/buffer-view resources, node matrix or
TRS hierarchy, indexed and non-indexed primitives, sparse accessors, and core
material/texture semantics are compatibility requirements.

## Loading lifecycle

A retained glTF identity has these product states:

- `idle`: the exact asset is not retained by the current scene;
- `loading`: scene geometry is not yet renderable;
- `streaming`: geometry is renderable and relevant images remain unsettled;
- `ready`: geometry is renderable and current relevant image demand settled;
- `degraded`: geometry is renderable but at least one relevant image failed;
- `error`: preparation could not produce a renderable scene.

Images not referenced by current prepared materials are dormant, not pending.
Selecting a material variant MAY turn dormant images into requested images and
move `ready` back to `streaming`. State is scoped to exact source, version, and
selected document scene, not source text alone. An explicit zero-based
`sceneIndex` overrides the document default before ordinary and compressed-mesh
inventory; an out-of-range index is an asset preparation error. Scene selection
participates in prepared/status identity but not source-derived mesh or image
content identity. Shared mesh and image references therefore reach the same
resource owners even though each selected scene keeps an independently
cancellable preparation lifecycle. Drawable focused status reports the actual
resolved `sceneIndex` and the complete lightweight `{ index, name? }` scene
inventory, so a consumer can build a selector without parsing the document a
second time. Inventory alone MUST NOT prepare or fetch unselected scene content.

Geometry SHOULD become visible before independent texture work settles. Royal
MUST NOT stall otherwise renderable geometry merely to avoid a minor texture or
normal-map transition. Each material input uses the best semantically legal
available value, and later publication invalidates one coalesced frame.

For a small JSON `.gltf` root, selected external material images MAY enter the
ordinary texture lifecycle as soon as the root document is available, before
geometry resources and canonical preparation settle. This discovery MUST use
the same selected-scene, material-LOD, variant, capability, sampler, fallback,
version, alpha-mask, and canonical texture identities as final preparation.
Visible base color leads emissive, ordinary detail, then transmission detail.
Embedded images remain coupled to validated canonical buffer preparation.
Early discovery is an optimization only: final preparation remains the
validation authority and replaces the provisional claim set atomically.

## Preparation and publication

Document fetch, buffer fetch/decode, scene preparation, and image preparation
are distinct phases. Root document transport uses a count- and byte-bounded
staging owner; CPU preparation, buffer decode, and image work use their
specialized root-wide schedulers and budgets. Waiting on root transport MUST
NOT occupy a CPU-preparation slot. Preparation MUST be generation-safe and
deduplicate equal work.

Referenced buffer reads MUST use the same injected, cancellable resource-I/O
port whether preparation is local or worker-executed. Executor choice cannot
silently replace consumer authentication, caching, or URI policy with a direct
worker fetch.

Exact root-source and referenced-buffer identities share one root-owned byte
transport. Each preparation receives caller-owned storage because a worker may
transfer it; genuinely shared deliveries receive caller-owned storage so no
preparation can detach or mutate the retained shared result. A single delivery
preserves the prior zero-copy ownership path.
Cancellation releases only that asset's claim and aborts pending transport only
after the last claimant leaves. Successfully shared results are retained under
one 32 MiB root-wide LRU ceiling. A result larger than the ceiling is shared
only while in flight and retires immediately after settlement. Rejections are
never sticky cache entries.

Completed root documents retain a separate staging reservation until canonical
preparation starts. Cancellation releases queued or staged ownership; an active
transport continues to count against its limit until the underlying read
actually settles, even when a consumer promise has already rejected.

A root MAY replace default fetch transport with one stable complete-byte glTF
resource reader. The same reader handles root documents, referenced buffers,
and external images and receives the root's URI/version identity plus an abort
signal. Royal still owns claims, deduplication, decode ownership, and bounded
retention. Equal external image URI/version identities share decode ownership
across different glTF documents; parent-document identity MUST NOT force a
duplicate image transport or decode.

For external `.gltf` buffers, the cold pure planner derives byte demand from
the selected scene's child/LOD graph, accessors, sparse payloads, instancing,
Draco payloads, and embedded images. Embedded-image demand follows only the
selected primitives' base materials, material LOD chains, and variant mappings.
Texture source choice is the same capability-aware pure decision used by
material preparation: a supported ETC2 source replaces its core/WebP alternate,
while an optional SVG source retains both its preferred vector source and the
required raster fallback. Unlit materials demand only their base-color input.
The browser port MAY satisfy that plan with single HTTP byte-range requests. It
MUST probe range behavior before issuing remaining ranges concurrently,
validate each returned interval, and fall back once to a complete response when
the origin ignores or rejects range transport. The reader returns the existing
full-offset canonical buffer shape, so transport selection cannot leak into
accessor, codec, material, or rendering paths. Unselected scenes MUST NOT force
their geometry or embedded-image bytes over the network. After demanded codecs
finish, one canonicalization pass packs only selected final buffer views;
compressed source ranges, fallback-buffer holes, and unselected-scene storage
do not survive into the retained preparation binary.

A prepared scene publishes atomically: traversable nodes, primitive records,
bounds, lights, selected index, lightweight scene inventory, variant names, and
image demands either form one coherent revision or do not replace the previous
revision. Individual image outcomes may publish later into material-owned
slots. A failed image MUST NOT invalidate unrelated images or geometry.

Distinct prepared roots MAY borrow one retained canonical geometry object when
immutable external resource/version identity and complete extraction
declarations narrow them to a candidate and byte-exact canonical output proves
equality. Materials, transforms, lights, status, cancellation, and texture
claims remain root-specific. This post-preparation interning removes duplicate
retained CPU arrays and GPU uploads; it does not count as shared worker
preparation. Eliminating duplicate canonical worker work requires the specified
two-stage geometry-task protocol rather than a detached whole-asset cache.

Prepared geometry is not part of ordinary status. One explicit cold visitor may
borrow highest-detail selected-scene indexed positions and packed asset-space
transforms from the retained canonical artifact. It MUST NOT fetch, decode, or
copy mesh data merely to expose it. Repeated meshes retain referential identity,
instances remain transform batches, and overlapping lower node-LOD levels are
excluded. Callback values are borrowed; retained derived indexes or merged
geometry are caller-owned copies and leave with that consumer's lifecycle.

Prepared bounds are a conservative asset-space AABB for framing, coarse layout,
and broad phases. They MUST NOT be interpreted as contact, collision,
resting-height, or support geometry. A consumer needing those semantics derives
and owns an appropriately compact structure from the borrowed canonical
geometry.

A root may retain an exact glTF identity through an explicit non-visual claim.
That claim MUST use the ordinary bounded preparation, transport,
deduplication, cancellation, focused status, and borrowed-geometry lifecycle.
It MUST NOT create scene nodes, transforms, surfaces, lights, picking records,
GPU resources, texture-image demand, or frame invalidation. Visual and
non-visual claims reconcile as one complete ownership set, so moving an
identity between them with overlapping incoming ownership neither rereads nor
reprepares it. A non-visual claim alone MUST NOT eagerly decode material
images. Once a visible owner has established image demand, however, an
overlapping root claim MAY retain those already-demanded canonical texture
identities across a temporary visual-composition gap. The last root and visual
owner releases them; there is no grace timer or detached cache. Declarative
hosts MUST use the root's atomic scene-and-claim
commit or otherwise bridge both handoff directions. Status observation remains
non-owning.

## Supported vertex and primitive profile

Royal ingests POSITION, NORMAL, TANGENT, TEXCOORD_0, TEXCOORD_1, and COLOR_0.
Missing NORMAL on triangle geometry uses flat face-normal behavior without
inventing smooth normals. Attribute normalization and quantization follow glTF
semantics.

`COLOR_0` accepts the core float and normalized unsigned byte/short VEC3/VEC4
forms and lowers once to canonical linear RGBA floats. RGB supplies alpha one.
The shader multiplies it with the material and texture base color before alpha
mode evaluation; exact alpha-mask picking uses the same interpolated alpha.
`TEXCOORD_0` and `TEXCOORD_1` likewise accept float or normalized unsigned
byte/short VEC2 and lower once to canonical float UVs.

Triangles, triangle strips, and triangle fans lower once to canonical triangle
indices. Conversion preserves winding and MUST NOT silently change authored
front faces. Points and line-family modes are explicitly deferred: adding them
would introduce a second rasterization and picking topology for little current
product value.

## Materials

Core metallic-roughness, base color, metallic/roughness, normal, occlusion,
emissive, alpha modes, double-sided state, texture transforms, UV-set selection,
samplers, and unlit are required fidelity.

Implemented material extensions are specular, IOR, transmission,
volume/attenuation, emissive strength, and unlit. Each lowers to canonical
material data. Expensive passes or shader work activate only when a visible
material demands them. Clearcoat, sheen, iridescence, anisotropy, dispersion,
and diffuse transmission remain deferred and MUST NOT be accepted when they
are required.

A required supported extension with malformed data fails the asset. An optional
extension with malformed or unusable data MAY fall back only when the glTF core
representation remains semantically valid; the fallback and reason MUST be
diagnosed once.

## Extensions and codecs

The current replacement implementation accepts these required declarations:

- `EXT_mesh_gpu_instancing`, draft `EXT_texture_avif`, `EXT_texture_webp`, and experimental
  `GS_texture_etc2`;
- `EXT_meshopt_compression` through selected-view async codec preparation;
- `KHR_draco_mesh_compression` through demanded async codec preparation;
- `KHR_lights_punctual`;
- `KHR_materials_emissive_strength`, `KHR_materials_ior`,
  `KHR_materials_specular`, `KHR_materials_transmission`,
  `KHR_materials_unlit`, `KHR_materials_variants`, and
  `KHR_materials_volume`;
- `KHR_mesh_quantization` for its ordinary legal integer position, normal,
  tangent, and texture-coordinate representations;
- `KHR_texture_transform`;
- `MSFT_lod` plus its `MSFT_screencoverage` convention.

This is an implementation ledger, not the desired eventual static profile.
Notably, glTF `KHR_texture_basisu`, image-based-light extensions, and the remaining PBR
family are not yet accepted as required. Direct Royal offline ETC2 KTX2
ingestion is not Basis ingestion. Only the explicitly unregistered
`GS_texture_etc2` vendor extension selects that storage from glTF; it does not
imply `KHR_texture_basisu` support.

Unknown `extensionsUsed` declarations do not fail core content. An unknown
`extensionsRequired` declaration MUST fail before knowingly incomplete content
is published. Royal MUST NOT claim support for imaginary, draft, or similarly
named extensions merely because it can ignore them.

Validation follows the executable extension graph. Payloads of unsupported
optional extensions are opaque because their core fallback does not execute
those fields; supported extension payloads remain recursively validated. Thus a
required `KHR_texture_transform` used by core texture infos MUST be honored,
while another occurrence nested only inside ignored optional clearcoat data does
not turn otherwise-valid core fallback into an asset failure. Extension objects
on the executable graph still MUST be declared in `extensionsUsed`, and every
required occurrence there MUST use an implemented placement.

Draco and Meshopt adapters load only when demanded. Codec output is validated
as strictly as uncompressed input. Codec or worker absence for a required path
produces an explicit asset failure; it MUST NOT hang. glTF Basis remains
unsupported until it has an equivalently owned ingestion path.

## Variants, lights, LOD, and instances

`KHR_materials_variants` exposes stable authored names, not declaration-order
indices. An unknown requested name renders the base material and emits a bounded
diagnostic. Variant selection preserves node and picking identity.
An optional Royal glTF `tint` is a presentation-level scene-linear RGBA
multiplier applied after base/variant/LOD selection. It does not participate in
asset identity, source preparation, geometry ownership, or texture ownership;
equal source-material/tint values share one canonical material identity.

Authored punctual lights lower to Royal light records. Asset-scoped
`EXT_lights_image_based` is fallback illumination only; an explicit Royal scene
environment wins regardless of load order.

`EXT_mesh_gpu_instancing`, repeated authored nodes, and explicit Royal bulk
instances normalize into the same instance semantics. Packed slots and draw
indices never become public identity.

`MSFT_lod` declarations lower to canonical LOD sets as specified by the frame
pipeline. No Microsoft-specific shader, buffer, or draw path remains.

## Explicitly unsupported asset semantics

Royal ignores glTF cameras because the Royal scene owns presentation camera
choice. It does not currently implement animations, skins, or morph targets.
An asset that requires unsupported deformation MUST fail rather than display a
known-wrong static substitute.

### Deferred transform-animation slice

The first possible animation implementation is intentionally narrow: glTF
animation channels targeting node translation, rotation, and scale with `STEP`,
`LINEAR`, and `CUBICSPLINE` interpolation. It does not include weights, morph
targets, skins, skeletal palettes, animation pointers, events, state machines,
or authoring UI.

If implemented, document samplers/channels lower to immutable prepared clip
data. A pure clip sampler writes caller-owned pose/change storage. One explicit
controller owns play/pause/time/loop state and acquires continuous demand from
the existing root/frame clock only while advancing. Pose changes enter the same
canonical transform and packet path as other transform revisions; React does
not reconcile animated nodes per frame.

No public animation API should be selected until official glTF sample assets
prove interpolation and duration behavior and Royal decides clip selection,
loop/clamp defaults, playback rate, seeking, concurrent clips, and blending.
Context loss must preserve logical playback state without retaining stale GPU
handles. This deferred slice MUST NOT add overhead to scenes without animation.

## SVG as an image source

Royal accepts a self-contained SVG referenced by a glTF core image/texture
source as a documented ingestion extension. It does not advertise a private
glTF extension for this.

The root SVG viewport and `viewBox` are normalized to finite raster dimensions.
SVG uses the same ordinary/automatic-VT image path as a direct texture source.
Royal does not parse or resolve nested external SVG resource graphs and does
not claim to sanitize hostile markup. The browser image decoder is the
execution boundary. Applications needing a stronger trust boundary MUST
sanitize or flatten SVG offline under their own policy.

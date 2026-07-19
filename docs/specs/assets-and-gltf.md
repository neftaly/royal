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
move `ready` back to `streaming`. State is scoped to exact source plus version,
not source text alone.

Geometry SHOULD become visible before independent texture work settles. Royal
MUST NOT stall otherwise renderable geometry merely to avoid a minor texture or
normal-map transition. Each material input uses the best semantically legal
available value, and later publication invalidates one coalesced frame.

## Preparation and publication

Document fetch, buffer fetch/decode, scene preparation, and image preparation
are distinct phases. Their jobs share a root-wide scheduler and budgets.
Preparation MUST be generation-safe and deduplicate equal work.

Referenced buffer reads MUST use the same injected, cancellable resource-I/O
port whether preparation is local or worker-executed. Executor choice cannot
silently replace consumer authentication, caching, or URI policy with a direct
worker fetch.

A prepared scene publishes atomically: traversable nodes, primitive records,
bounds, lights, variant names, and image demands either form one coherent
revision or do not replace the previous revision. Individual image outcomes may
publish later into material-owned slots. A failed image MUST NOT invalidate
unrelated images or geometry.

## Supported vertex and primitive profile

Royal ingests POSITION, NORMAL, TANGENT, TEXCOORD_0, TEXCOORD_1, and COLOR_0.
Missing NORMAL on triangle geometry uses flat face-normal behavior without
inventing smooth normals. Attribute normalization and quantization follow glTF
semantics.

Triangles, triangle strips/fans, lines, line strips/loops, and points are
accepted. Picking is exact only where the canonical geometry supplies
triangles. Primitive conversion MUST preserve winding and MUST NOT silently
change authored front faces.

## Materials

Core metallic-roughness, base color, metallic/roughness, normal, occlusion,
emissive, alpha modes, double-sided state, texture transforms, UV-set selection,
samplers, and unlit are required fidelity.

The following implemented material extensions are supported ingestion
semantics: clearcoat, sheen, specular, IOR, transmission, volume/attenuation,
iridescence, anisotropy, emissive strength, dispersion, and diffuse
transmission. Each MUST lower to canonical material data. Expensive passes or
shader work MUST be activated only when a visible material demands them.

A required supported extension with malformed data fails the asset. An optional
extension with malformed or unusable data MAY fall back only when the glTF core
representation remains semantically valid; the fallback and reason MUST be
diagnosed once.

## Extensions and codecs

The current replacement implementation accepts these required declarations:

- `EXT_mesh_gpu_instancing` and `EXT_texture_webp`;
- `KHR_draco_mesh_compression` through demanded async codec preparation;
- `KHR_lights_punctual`;
- `KHR_materials_emissive_strength`, `KHR_materials_ior`,
  `KHR_materials_specular`, `KHR_materials_transmission`,
  `KHR_materials_unlit`, `KHR_materials_variants`, and
  `KHR_materials_volume`;
- `KHR_mesh_quantization` for normalized integer attributes decoded through
  the Draco adapter;
- `KHR_texture_transform`;
- `MSFT_lod` plus its `MSFT_screencoverage` convention.

This is an implementation ledger, not the desired eventual static profile.
Notably, glTF `KHR_texture_basisu`, `EXT_meshopt_compression`,
image-based-light extensions, and the remaining PBR
family are not yet accepted as required. Direct Royal offline ETC2 KTX2
ingestion is not Basis ingestion and does not imply support for the glTF texture
extension.

Unknown `extensionsUsed` declarations do not fail core content. An unknown
`extensionsRequired` declaration MUST fail before knowingly incomplete content
is published. Royal MUST NOT claim support for imaginary, draft, or similarly
named extensions merely because it can ignore them.

The Draco adapter loads only when demanded. Codec output is validated as
strictly as uncompressed input. Codec or worker absence for a required path
produces an explicit asset failure; it MUST NOT hang. Meshopt and glTF Basis
remain unsupported until they have equivalently owned ingestion paths.

## Variants, lights, LOD, and instances

`KHR_materials_variants` exposes stable authored names, not declaration-order
indices. An unknown requested name renders the base material and emits a bounded
diagnostic. Variant selection preserves node and picking identity.

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

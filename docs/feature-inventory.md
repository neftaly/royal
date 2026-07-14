# Royal feature inventory

Date: 2026-07-15

This is a product inventory, not an inventory of internal helper functions.
The status column distinguishes deliberate Royal behavior from compatibility
accepted only while ingesting another format.

Status meanings:

- **product**: intentional Royal capability or public API;
- **ingestion**: accepted at an asset boundary and lowered to canonical data;
- **fallback**: exists to keep a product feature usable on more devices or
  while higher-quality data is unavailable;
- **candidate**: experimental, legacy-shaped, redundant, or otherwise worth an
  explicit keep/delete decision;
- **deleted**: intentionally absent; retained in this inventory to document the
  product decision and prevent accidental resurrection.

## React and renderer lifecycle

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| `Canvas` and `createRendererRoot` | product | Primary React host and lower-level imperative host. Keep. |
| Demand rendering and explicit invalidation | product | Core battery/performance behavior. Keep. |
| `useFrame` | product | Opts a settled renderer into time-driven work. Keep, but do not make it the default clock. |
| Renderer lifecycle snapshot and recovery | product | Needed for context loss and UI state. Keep small. |
| glTF asset status hook | product | Useful React loading/error surface. Keep. |
| Large diagnostic snapshots | candidate | Useful during development, but should be bounded observations rather than a public control model. Reduce after local budgets replace the governor. |
| Public resource-governor policy | candidate | Leaks renderer scheduling into React. Delete and replace with local renderer defaults/caps. |

## Scene and camera

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| One immutable scene description | product | Keep; private multipass compilation is a consequence. |
| Perspective camera | product | Primary 3D camera. Keep. |
| Orthographic camera | product | Small cost and preserves flat/diagram/card use cases. Review only if the public vocabulary must be minimal. |
| Mutable camera-view resource | product | Avoids rebuilding React scene intent during interaction. Keep. |
| Orbit camera/controller | product | React-first DX feature. Keep. |
| Clear colour and transparent canvas | product | Keep. |
| Exposure in EV100 | product | Keep if physically coherent lighting remains a goal. |
| Tone maps: linear clamp, ACES fitted, PBR Neutral | candidate | Multiple presentation choices are deliberate but visually overlapping. Compare oracles and consider reducing to PBR Neutral plus an explicit no-tonemap/debug mode. |
| Y-up right-handed and Z-up left-handed coordinate descriptors | candidate | Adapters are useful, but a public coordinate-system mini-model may be more API than needed. Royal runtime remains metres and one canonical handedness. |

## Scene content

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| glTF asset node | product | Primary authored asset path. Keep. |
| Bulk glTF instances with patchable transform channels | product | Core high-count workload. Keep. |
| Generic mesh node | product | Necessary escape hatch and foundation for simple geometry. Keep. |
| Box and plane geometry | product | Very small convenience surface. Plane is also a VT/ground stress primitive. |
| Standard material | product | Public simple PBR material. Keep. |
| Unlit material | product | Essential for authored artwork and diagnostic parity. Keep. |
| Wireframe material | candidate | Contradicts the stated small PBR-centric public vocabulary; likely delete or make a private debug mode. |
| Directional, point and spot lights | product | Standard compact light set. Keep unless environment-only lighting becomes an explicit product restriction. |
| Studio environment preset | product | Currently the one scene environment authority. Keep; expand by data, not new environment classes. |
| Render-object refs and imperative transform updates | product | Important high-frequency React DX. Keep. |

## Textures and sampling

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| Solid-colour texture | product | Cheap convenience/fallback. |
| Ordinary image texture | product | Required baseline and fallback. |
| Authored texture asset with content/version identity | product | Keep if external caches and mutable URLs are real workloads. |
| sRGB and linear texture colour spaces | product | Correctness requirement. |
| Nearest/linear/mipmap sampler filters | ingestion/product | WebGL/glTF consequence with low incremental cost. Keep. |
| Clamp, repeat and mirrored-repeat wrapping | ingestion/product | Required for glTF and VT sampling parity. Keep. |
| `flipY` | fallback/product | Browser image orientation boundary. Keep explicit until all ingestion normalizes before the public texture API. |
| Authored VT manifest | candidate | Useful for pre-tiled assets, but its version-2 JSON contract should be reconsidered with VT v2 rather than preserved automatically. |
| Automatic raster-image VT | candidate | Product intent is keep, implementation is v1 and will be replaced. Small images should remain ordinary. |
| Generated SVG VT v1 | deleted | Removed. Reintroduce SVG only as a generic VT v2 page producer. |
| Ordinary SVG raster fallback | fallback | Retain for correctness isolation, startup and devices where vector paging is unavailable. |

## SVG ingestion

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| Plain glTF `image/svg+xml` images | ingestion | Nonstandard but useful input. Retain while SVG is a product requirement. |
| `GS_texture_svg` source selection with a core raster fallback | ingestion/candidate | Royal-owned extension. Keep only if Garbo/Probability assets need portable SVG preference; otherwise plain SVG ingestion may suffice. |
| SVG viewport/viewBox normalization | ingestion | Required for deterministic raster dimensions. Keep. |
| Script/event/unsafe-URL stripping | ingestion | Security requirement while SVG is supported. Keep. |
| Nested SVG/image reference resolution | candidate | Enables Tiger and authored composition but is a substantial parser/IO surface. Decide explicitly whether SVG textures may reference external images/SVGs. |
| Relative URL and `xml:base` handling | ingestion | A consequence of allowing external SVG resources. Delete if nested/external resources are prohibited. |
| SVG cycle/depth detection and deduplication | fallback | A required consequence of nested SVG references, not an independent feature. |

## Geometry LOD and visibility

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| Projected screen-coverage LOD selection | product | Keep; cheap runtime selection across prepared levels. |
| Multi-view maximum coverage | product | Required for stereo XR and secondary views. |
| LOD hysteresis | product | Required to prevent threshold flicker. |
| Missing-level drawable fallback | fallback | Required for streaming and partial readiness. |
| Automatic browser-side mesh simplification | candidate | Not currently implemented. Prefer offline/build generation; optional worker ingestion can be added for user uploads. |
| `MSFT_lod` node/material declarations | ingestion | Keep only as an adapter to canonical `LodSet`; no MSFT-specific runtime policy. Material LOD itself is more questionable than geometry LOD. |

## glTF core coverage

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| `.gltf` JSON and `.glb` | ingestion | Core interoperability. Keep. |
| External, data-URI and buffer-view resources | ingestion | Core glTF forms. Keep with limits. |
| Node matrix and TRS hierarchy | ingestion | Core glTF. Keep. |
| Indexed and non-indexed primitives | ingestion | Core glTF. Keep. |
| Triangle, strip, fan, line, line-strip, line-loop and point modes | ingestion/candidate | Full primitive-mode compatibility; rare non-triangle modes can be reviewed if their shader/executor cost is material. |
| POSITION, NORMAL, TANGENT, TEXCOORD_0/1 and COLOR_0 | ingestion | Current prepared vertex profile. Keep unless a narrower asset contract is chosen. |
| Generated normals when missing | fallback | Convenience rather than strict glTF behavior. Review whether malformed/underspecified assets should instead fail or render unlit. |
| Sparse accessors | ingestion | Core glTF compatibility with isolated implementation cost. Keep. |
| Mesh/material variants | ingestion | Useful but application-specific. Review actual usage. |
| glTF punctual lights | ingestion | Low-cost lowering into Royal lights. Keep unless asset lights are unwanted by policy. |
| glTF image-based lights | candidate | Redundant environment authority. Remove runtime ownership; optionally expose an ingestion suggestion later. |
| glTF cameras | unsupported | Deliberately ignored; Royal scene owns the camera. |
| Animations | unsupported | Deliberately out of scope. |
| Skins | unsupported | Explicitly rejected. |
| Morph targets | unsupported | Explicitly rejected. |

## glTF extensions and codecs

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| `KHR_texture_basisu` / KTX2 Basis | ingestion/product | Keep, but fix upload to retain GPU block compression. |
| `EXT_texture_webp` | ingestion | Cheap browser-supported source preference with core fallback. Keep unless KTX2 becomes the only compressed delivery format. |
| `KHR_draco_mesh_compression` | ingestion | Widely used compatibility. Keep if decode size/startup measurements justify its codec. |
| `EXT_meshopt_compression` | ingestion | Efficient geometry delivery and aligned with LOD/offline preparation. Keep. |
| `KHR_meshopt_compression` | candidate | Separate compatibility spelling/profile in current code. Verify real assets/spec status and delete if it is only speculative support. |
| `KHR_mesh_quantization` | ingestion | Mostly accessor acceptance; useful and low runtime cost. Keep. |
| `EXT_mesh_gpu_instancing` | ingestion | Correctly lowers into canonical instance transforms. Keep. |
| `KHR_node_visibility` | ingestion/candidate | Small optional filtering extension. Delete if no production exporter uses it. |
| `KHR_materials_variants` | ingestion/candidate | Useful for authored variants, but retain only with an intentional selection API/workload. |
| `EXT_lights_image_based` | candidate | Delete as a second environment authority. |
| `MSFT_lod` | ingestion | Keep as declarations only; lower to canonical LOD. |
| `GS_texture_svg` | ingestion/candidate | Royal-owned and coupled to the SVG product decision. |

## glTF material profile

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| Metallic-roughness baseline | ingestion/product | Core visual contract. Keep. |
| Base colour, metallic/roughness, normal, occlusion and emissive textures | ingestion/product | Baseline fidelity. Keep. |
| Alpha opaque/mask/blend and double-sided | ingestion/product | Core glTF. Keep. |
| Texture transforms and UV-set selection | ingestion | Core fidelity for real assets. Keep. |
| Unlit | ingestion/product | Keep. |
| Clearcoat | ingestion/product | Keep for fidelity; complete clearcoat-normal support before claiming full support. |
| Sheen | ingestion/product | Keep pending visual oracle. |
| Specular and IOR | ingestion/product | Keep; foundational dielectric fidelity. |
| Transmission and volume/attenuation | ingestion/product | Keep if screen-copy/refraction cost passes device gates. |
| Iridescence | ingestion/product | Keep pending visual oracle. |
| Anisotropy | ingestion/product | Keep intent; texture form is currently incomplete. |
| Emissive strength | ingestion/product | Small and useful. Keep. |
| Dispersion | ingestion/candidate | Expensive/rare; keep only if the visual implementation is convincing on target hardware. |
| Diffuse transmission | ingestion/candidate | Rare and currently incomplete for textures; explicit keep/delete decision. |

## Interaction and XR

| Feature | Status | Coupling and recommendation |
| --- | --- | --- |
| Canvas point picking | product | Keep. |
| Mesh, glTF node and glTF instance identities | product | Keep; logical identity is a core promise. |
| React pointer enter/leave/move/down/up/click dispatch | product | Keep if Canvas is the normal interaction host. |
| Touch/pointer orbit interactions | product | Keep. |
| Imperative pick API | product | Keep for XR and non-DOM hosts. |
| WebXR session runtime/store | product | Keep; physically exercised on Quest. |
| External XR frame clock and stereo views | product | Required consequence of WebXR support. |
| Session lifecycle, visibility and interruption states | fallback/product | Required by real browser/XR behavior, not independent product scope. |

## Runtime consequences, not user features

These should not be offered as product choices unless their cost or behavior is
actually undesirable:

- WebGL context loss/restoration and resource reconstruction;
- generation-safe cancellation of stale async work;
- bounded fetch/decode/upload concurrency;
- texture/geometry deduplication by content and preparation identity;
- shader variants compiled from visible material needs;
- instanced and non-instanced draw paths;
- HDR intermediate targets when transmission, lighting or tone mapping needs
  them;
- per-eye LOD/visibility aggregation in XR;
- fallback resources while asynchronous content is not ready;
- validation limits for untrusted glTF/SVG data.

They exist because supported product features require them. Their
implementation can still be simplified, fuzzed or replaced.

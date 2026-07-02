# glTF Extension Priority

Status date: 2026-07-03.

Sources:

- Khronos glTF 2.0 extension registry: <https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md>
- glTF 2.0 extension rules: <https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#specifying-extensions>
- Local loader: [`packages/renderer-webgl/src/root.ts`](../packages/renderer-webgl/src/root.ts)
- Public React note: [`packages/react/README.md`](../packages/react/README.md)

## What "Required" Means

No glTF extension is globally required. An extension becomes required for a
specific asset only when the asset lists it in top-level `extensionsRequired`.
If we do not support a required extension, the loader should reject or diagnose
the asset instead of rendering a misleading fallback.

Before adding visual extension support, start with this required-first work:

1. Add `extensionsUsed` / `extensionsRequired` parsing and diagnostics.
2. Reject unsupported required extensions with a clear message.
3. Add core glTF loadability gaps that block ordinary assets: `.glb`, data
   URIs, bufferView images, node child hierarchy, strided/interleaved accessors,
   sparse accessors, non-float normalized attributes, and primitive modes.
4. Implement required-when-present compression and texture format extensions.

Required-extension implementation priority:

1. `KHR_mesh_quantization` - not optional when an asset uses quantized
   attributes.
2. `EXT_meshopt_compression` - implemented for bufferView decompression; required
   when fallback buffer data is unavailable.
3. `KHR_texture_basisu` - required when no PNG/JPEG texture fallback is supplied.
4. `EXT_texture_webp` - required when no PNG/JPEG texture fallback is supplied.
5. `KHR_draco_mesh_compression` - required when no uncompressed mesh fallback is
   supplied.
6. `EXT_mesh_gpu_instancing` - required when the asset depends on instancing and
   has no expanded-node fallback.
7. `KHR_texture_transform` - can be required when no fallback UVs are supplied.

If draft or domain-specific extensions such as `KHR_accessor_float64`,
`KHR_texture_video`, physics, audio, or MPEG entries are required, reject them
until the corresponding runtime exists.

The current Royal loader supports `.gltf` and `.glb` documents, external/data
URI/GLB BIN buffers, bufferView images, node child hierarchies, node transforms,
mesh primitives, `POSITION` / `NORMAL` / selected `TEXCOORD_n`, strided and
sparse accessors, normalized integer attributes, base color factor/texture,
samplers, triangle and line drawing, `UNSIGNED_BYTE` / `UNSIGNED_SHORT` /
`UNSIGNED_INT` indices, `KHR_mesh_quantization`, `KHR_texture_transform`,
`EXT_meshopt_compression`, `KHR_draco_mesh_compression`,
`EXT_mesh_gpu_instancing`, `EXT_texture_webp`,
`KHR_texture_basisu`, `KHR_materials_unlit`, `KHR_lights_punctual`,
`KHR_materials_emissive_strength`, `KHR_materials_specular`,
`KHR_materials_ior`, `KHR_materials_clearcoat`, `KHR_materials_variants`,
`KHR_node_visibility`, and vendor `MSFT_lod`.

## Should Do

These are high-value for production asset loading or already part of the local
path. They are sorted in suggested implementation order.

| Priority | Extension | Short explanation | Why |
| --- | --- | --- | --- |
| P0 | `extensionsRequired` gate | Not an extension. Reads required extension names and fails unsupported assets clearly. | This is the first "required" feature because it prevents silent wrong renders. |
| P0 | Core `.glb` support | Binary container for JSON plus binary payload. | Core glTF 2.0 delivery format; many assets ship as GLB. |
| P1 | `KHR_mesh_quantization` | Stores vertex attributes in smaller integer formats with decode rules. | Common size reduction; required if an asset has no float fallback. |
| P1 | `EXT_meshopt_compression` | Compresses buffer views with meshoptimizer codecs. | Implemented for required compressed bufferViews; maintain decoder regression coverage. |
| P1 | `KHR_texture_basisu` | Adds KTX2/Basis Universal texture sources. | Implemented for required base-color textures by transcoding KTX2/Basis to RGBA8 through loaders.gl before WebGL upload. |
| P1 | `EXT_texture_webp` | Allows WebP texture images. | Web-focused texture size win; required without PNG/JPEG fallback. |
| P2 | `KHR_draco_mesh_compression` | Compresses mesh primitive attributes and indices with Draco. | Implemented for required primitive geometry; maintain decoder regression coverage. |
| P2 | `KHR_texture_transform` | Adds per-texture UV offset, scale, rotation, and texCoord override. | Common authoring feature; without it textures appear misaligned. |
| P2 | `KHR_materials_unlit` | Marks a material as unaffected by scene lighting. | Small implementation and common for UI, labels, CAD colors, and baked assets. |
| P2 | `KHR_lights_punctual` | Adds punctual point, spot, and directional lights to glTF scenes. | Implemented locally; maintain required-extension regression coverage. |
| P3 | `KHR_materials_variants` | Defines named material variants for the same mesh. | Implemented locally for `gltf({ variant })` and `<model variant>` material selection. |
| P3 | `EXT_mesh_gpu_instancing` | Stores many instances of one mesh with per-instance transforms/attributes. | Implemented locally; maintain tests and example coverage. |
| P3 | `KHR_node_visibility` | Lets assets mark nodes as visible or hidden. | Prevents rendering hidden authored content. |
| P3 | `MSFT_lod` | Vendor extension for node/material levels of detail. | Already implemented locally; maintain tests and do not regress it. |

## Maybe

These are useful, but they should follow required-extension gating and the
loadability work above. Move items up only when product goals or source assets
need them.

| Priority | Extension | Short explanation | When to do it |
| --- | --- | --- | --- |
| M1 | `KHR_materials_emissive_strength` | Allows emissive colors brighter than the core range. | Implemented for emissive factors; emissive textures remain future material work. |
| M1 | `KHR_materials_specular` | Adds specular color and intensity controls to PBR. | Implemented for specular factor and specular color factor in the forward shader; specular textures are diagnosed and ignored. |
| M1 | `KHR_materials_ior` | Adds index of refraction for transparent materials. | Implemented for the factor-level Fresnel term; transmission/volume/refraction targets remain future work. |
| M1 | `KHR_materials_transmission` | Adds physically based light transmission through surfaces. | Glass/plastic product rendering. |
| M1 | `KHR_materials_volume` | Adds thickness, attenuation color, and attenuation distance. | Thick glass, liquids, gems. |
| M1 | `KHR_materials_clearcoat` | Adds an extra glossy coating layer. | Implemented for clearcoat factor and clearcoat roughness factor in the forward shader; clearcoat textures are diagnosed and ignored. |
| M1 | `KHR_materials_sheen` | Adds cloth-like grazing sheen. | Fabric, apparel, soft goods. |
| M1 | `KHR_materials_anisotropy` | Adds direction-dependent specular highlights. | Brushed metal and hair-like materials. |
| M1 | `KHR_materials_iridescence` | Adds thin-film color shifting. | Pearlescent, soap-film, coated surfaces. |
| M1 | `KHR_materials_dispersion` | Adds chromatic separation for transmitted light. | Gems or high-end glass; depends on volume/transmission. |
| M2 | `KHR_animation_pointer` | Lets animations target arbitrary mutable glTF properties with JSON pointers. | After core animation support exists. |
| M2 | `KHR_xmp_json_ld` | Embeds XMP metadata using JSON-LD. | Asset provenance, commerce metadata, content pipelines. |
| M2 | `EXT_lights_image_based` | Adds image-based/environment lighting data. | PBR scene fidelity once material support matures. |
| M2 | `EXT_lights_ies` | Adds IES photometric light profiles. | Architectural or product lighting workflows. |
| M2 | `EXT_mesh_manifold` | Stores manifold/topology data for meshes. | CAD/print/geometry workflows, not basic rendering. |
| M2 | `CESIUM_primitive_outline` | Stores outline data for mesh primitives. | Geospatial/CAD-style outline rendering. |
| M2 | `MSFT_packing_normalRoughnessMetallic` | Microsoft packed texture convention for normal, roughness, and metalness. | Only if ingesting legacy Microsoft assets. |
| M2 | `MSFT_packing_occlusionRoughnessMetallic` | Microsoft packed texture convention for occlusion, roughness, and metalness. | Only if ingesting legacy Microsoft assets. |
| M3 | `KHR_gaussian_splatting` | In-progress release candidate for Gaussian splat assets. | Track; implement as a separate renderer path if it ratifies and product needs it. |
| M3 | `KHR_materials_diffuse_transmission` | In-progress release candidate for diffuse light transmission. | Track with the transmission/volume material work. |
| M3 | `KHR_interactivity` | In-progress behavior graph for interactive glTF content. | Only if Royal wants asset-authored behavior, not just rendering. |
| M3 | `KHR_node_hoverability` | In-progress node-level hover interaction metadata. | Only if glTF drives interaction policy. |
| M3 | `KHR_node_selectability` | In-progress node-level selection interaction metadata. | Only if glTF drives picking/selection policy. |
| M3 | `KHR_collision_shapes` | In-progress collision shape definitions. | Physics/game workflows. |
| M3 | `KHR_physics_rigid_bodies` | In-progress rigid body physics definitions. | Physics/game workflows after collision support. |
| M3 | glTF External References | In-progress project for references outside a single asset package. | Asset pipeline concern; runtime support later. |

## Won't Do By Default

These are archived, highly domain-specific, superseded by Khronos alternatives,
or a poor fit for the current WebGL renderer. If an asset marks one as required,
the loader should reject it with a clear unsupported-extension diagnostic.

| Extension | Short explanation | Reason |
| --- | --- | --- |
| `KHR_materials_pbrSpecularGlossiness` | Archived legacy specular-glossiness PBR workflow. | Do not author new assets with it; prefer metallic-roughness plus current KHR material extensions. |
| `KHR_techniques_webgl` | Archived WebGL shader technique extension. | Old shader injection path; not a fit for Royal's material pipeline. |
| `KHR_xmp` | Archived XMP metadata extension. | Prefer `KHR_xmp_json_ld`. |
| `KHR_accessor_float64` | In-progress 64-bit accessor values. | WebGL rendering will down-convert; only pipeline tooling might need it. |
| `KHR_audio_graph` | In-progress audio graph data. | Outside renderer scope. |
| `KHR_materials_subsurface` | In-progress subsurface material model. | Wait for ratification and material pipeline maturity. |
| `KHR_texture_procedurals` | In-progress procedural texture definitions. | Too early and requires a broader shader/material graph. |
| `EXT_texture_procedurals_mx_1_39` | In-progress MaterialX procedural texture profile. | Too early; depends on procedural material infrastructure. |
| `KHR_texture_video` | In-progress video texture support. | Media playback and sync path needed first. |
| `ADOBE_materials_clearcoat_specular` | Adobe-specific clearcoat specular controls. | Prefer Khronos material extensions unless Adobe import becomes a target. |
| `ADOBE_materials_clearcoat_tint` | Adobe-specific clearcoat tint controls. | Prefer Khronos material extensions unless Adobe import becomes a target. |
| `ADOBE_materials_thin_transparency` | Adobe-specific thin transparency model. | Prefer KHR transmission/volume path. |
| `AGI_articulations` | AGI/Cesium-style articulation data. | Domain-specific aerospace/geospatial behavior. |
| `AGI_stk_metadata` | AGI Systems Tool Kit metadata. | Domain-specific metadata. |
| `FB_geometry_metadata` | Facebook geometry metadata. | Domain-specific metadata. |
| `GODOT_single_root` | Godot import/export single-root scene hint. | Engine-specific interop hint. |
| `GRIFFEL_bim_data` | BIM metadata. | Domain-specific; only revisit for BIM workflows. |
| `MPEG_accessor_timed` | MPEG timed accessor data. | Media-streaming scope, not static renderer scope. |
| `MPEG_animation_timing` | MPEG animation timing metadata. | Media-streaming scope. |
| `MPEG_audio_spatial` | MPEG spatial audio metadata. | Audio scope. |
| `MPEG_buffer_circular` | MPEG circular buffer data. | Streaming/media scope. |
| `MPEG_media` | MPEG media reference framework. | Streaming/media scope. |
| `MPEG_mesh_linking` | MPEG mesh linking data. | Streaming/media scope. |
| `MPEG_scene_dynamic` | MPEG dynamic scene updates. | Streaming/media scope. |
| `MPEG_texture_video` | MPEG video texture support. | Prefer waiting on broader video texture decisions. |
| `MPEG_viewport_recommended` | MPEG recommended viewport metadata. | Player/streaming scope. |
| `MSFT_texture_dds` | Microsoft DDS texture images. | Prefer KTX2/Basis and WebP for web delivery. |
| `NV_materials_mdl` | NVIDIA MDL material definitions. | Requires a separate material system. |

## Starting Recommendation

The required-contract gate, core loadability baseline, meshopt/Draco geometry
compression, GPU instancing, WebP, Basis texture paths, and factor-level
specular/IOR/clearcoat material terms are now in place. Add richer material
extensions only after the forward material model, texture plumbing, and
environment/refraction targets can support them deterministically.

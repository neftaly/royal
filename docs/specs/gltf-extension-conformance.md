# glTF required-extension conformance ledger

Status: executable replacement profile; reviewed 2026-07-23

This ledger records what Royal may truthfully accept in `extensionsRequired`.
It is narrower than the optional-feature possibility space. A name is accepted
only when its observed placements pass the cold profile validator and its
payload lowers through the owning semantic reader before publication.

Unknown required names, duplicate required names, unsupported codecs, and a
known required name observed outside the placements below fail the whole asset.
Unknown optional extensions do not participate in selection and may use valid
core fallback. Direct Royal features do not imply support for a similarly
shaped glTF extension.

The executable declaration graph is validated before semantic readers run:
`extensionsUsed` contains unique non-empty names, every required name also
appears there, and every executable extension payload is declared. Payloads of
unsupported optional extensions are opaque core-fallback branches; payloads of
supported extensions remain recursively validated. Unknown declared optional
names remain legal when core fallback is valid.

The glTF Lab distinguishes a `supported-oracle` from a
`core-fallback-oracle`. The latter proves that an optional extension's authored
core fallback remains renderable; it is not evidence that Royal implements the
extension's visible semantics. An asset that requires unsupported semantics is
an `expected-required-failure` and is never included in a success sweep.

The pinned Khronos Duck `glTF-Draco` variant is the independent required-Draco
oracle. Its unchanged JSON glTF, external compressed buffer, and external PNG
exercise the async worker preparation and lazy decoder path in the browser as
well as the deterministic preparation contract. The ordinary Duck variant uses
the same lab presentation transform, so compression does not change the visual
oracle.

| Required extension | Accepted placements | Canonical result |
| --- | --- | --- |
| `EXT_mesh_gpu_instancing` | node | validated instance transform batches sharing ordinary geometry/materials |
| `EXT_meshopt_compression` | buffer view and optional fallback-buffer marker; async preparation with available decoder | demanded decoded buffer-view bytes enter the ordinary canonical accessor path |
| `EXT_texture_avif` (open draft) | texture | ordinary cold texture recipe using the draft extension image source |
| `EXT_texture_webp` | texture | ordinary cold texture recipe using the extension image source |
| `GS_texture_etc2` | texture | explicitly marked offline ETC2 KTX2 recipe using the ordinary texture lifecycle |
| `GS_texture_svg` | texture | experimental preferred SVG recipe with required failure or one deferred ordinary fallback |
| `KHR_draco_mesh_compression` | mesh primitive, async preparation with available decoder | validated canonical triangle attributes and indices |
| `KHR_lights_punctual` | document and node | canonical punctual light definition and transformed occurrences |
| `KHR_materials_emissive_strength` | material | multiplied canonical emissive factor |
| `KHR_materials_ior` | material | canonical dielectric index of refraction |
| `KHR_materials_specular` | material | factors and ordinary specular/specular-color texture recipes |
| `KHR_materials_transmission` | material | transmission factor/texture and demand-loaded composite classification |
| `KHR_materials_unlit` | material | canonical unlit material |
| `KHR_materials_variants` | document and mesh primitive | named canonical material choices preserving node/pick identity |
| `KHR_materials_volume` | material, with active transmission | thickness/attenuation inputs on the transmission composite path |
| `KHR_mesh_quantization` | required document declaration; no payload object | legal integer mesh attributes lower once to canonical float streams |
| `KHR_texture_transform` | texture-info fields consumed by the supported material slots | selected UV set and two canonical affine rows |
| `MSFT_lod` | node and material | ordered geometry/material memberships and normalized coverage thresholds |

The supported texture-info placements for `KHR_texture_transform` are core
base-color, metallic-roughness, normal, occlusion and emissive textures, plus
the implemented specular, specular-color, transmission and thickness textures.
Use on an unimplemented material extension is not accepted merely because the
transform math is generic.

## Payload profiles

- GPU instancing accepts `TRANSLATION`, `ROTATION`, and `SCALE`; unsupported
  attributes fail rather than becoming frame vocabulary.
- Punctual lights accept point, spot, and directional definitions with the
  implemented color/intensity/range/cone semantics.
- Specular accepts scalar/color factors and their two texture infos.
- Transmission accepts factor and texture. Volume accepts thickness factor and
  texture, attenuation distance, and attenuation color; active standalone
  volume fails because its rendering semantics depend on transmission.
- Texture transforms accept offset, rotation, scale, and UV-set override and
  disappear into canonical rows.
- `GS_texture_etc2` accepts one image source containing Royal's validated,
  unsupercompressed ETC2 RGBA KTX2 subset. Its source marker disappears at
  canonical decode; sampler, material, budget, upload, draw and picking remain
  ordinary paths. The root first enables `WEBGL_compressed_texture_etc` and
  passes that capability into cold/worker preparation. When available,
  selection is ETC2, then AVIF, then WebP, then core; when absent, optional
  selection is AVIF, then WebP, then core and a required declaration fails
  preflight. Optional ETC2 may omit the core source when its selected
  lower-priority AVIF or WebP representation is itself required. Only the
  selected source is fetched.
- Draft `EXT_texture_avif` accepts the texture-level `{ source }` shape from
  open Khronos glTF PR #2235. Optional use requires either a core PNG/JPEG
  source or a present lower-priority WebP source which is itself required;
  required use may omit both. The selected external or embedded image must be
  AVIF, enters the ordinary browser-image lifecycle, and does not retain a
  corrupt-data retry recipe. Royal's supported browser floor has AVIF decode;
  Royal therefore adds no user-agent branch or startup codec probe. Browsers
  below that floor cross the ordinary bounded decode-failure boundary.
- `GS_texture_svg` accepts one self-contained, bounded SVG image source for
  sRGB color slots. Optional use requires a core source or a present
  lower-priority texture extension which is itself required, and attempts SVG
  first; on SVG transport, profile, or decode failure it selects ETC2 when
  supported, then AVIF, WebP, and core, and fetches only that fallback. Required
  use may omit the fallback and fails rather than silently changing
  representations. The chosen representation lowers through one texture
  identity and lifecycle.
- Meshopt validates the ratified buffer-view schema, lazily loads its decoder,
  requests only compressed ranges reachable from the selected scene, skips
  marked or implicit URI-less fallback buffers, and decodes into the ordinary
  buffer-view storage before one-buffer canonicalization. ATTRIBUTES,
  TRIANGLES, INDICES, and the standard NONE/OCTAHEDRAL/QUATERNION/EXPONENTIAL
  filters are accepted. External roots may share pre-read preparation from the
  immutable compressed source and full decode/extraction declaration; a
  URI-less fallback buffer is represented only by its derived layout and never
  becomes fictional transport identity. The synchronous `prepareStaticGlb`
  test/helper boundary rejects required meshopt; normal root and React
  ingestion use async local or preparation-worker execution.
- Mesh quantization accepts BYTE/UNSIGNED_BYTE/SHORT/UNSIGNED_SHORT positions,
  normalized signed normals and tangents, and signed or unsigned integer UVs
  with their authored normalized flag. Values become canonical float streams;
  node and texture transforms remain the standard dequantization mechanism.
- Variants accept named root definitions and primitive mappings.
- `MSFT_lod` accepts node/material ID chains and the
  `MSFT_screencoverage` extras convention. It does not claim progressive
  lowest-level-first network publication.

Schema validation belongs to these cold readers, not to draw code. A profile
addition must add positive placement/payload oracles, wrong-placement and
invalid-payload failures, canonical lowering tests, and any required visual or
device proof.

## Explicit non-claims

Royal currently rejects required `KHR_texture_basisu`, image-based-light
extensions, the remaining PBR extension family, and unimplemented draft or
imaginary texture extensions. Browser AVIF remains valid as a direct ordinary
Royal texture source; `EXT_texture_avif` is implemented narrowly as an open
draft and is not represented as registered or ratified compatibility.
`GS_texture_etc2` is an explicitly unregistered experimental vendor extension
rather than an ecosystem compatibility claim.
`GS_texture_svg` is likewise an implemented but unregistered Royal experiment,
not a registered ecosystem compatibility claim.

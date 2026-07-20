# glTF required-extension conformance ledger

Status: executable replacement profile; reviewed 2026-07-20

This ledger records what Royal may truthfully accept in `extensionsRequired`.
It is narrower than the optional-feature possibility space. A name is accepted
only when its observed placements pass the cold profile validator and its
payload lowers through the owning semantic reader before publication.

Unknown required names, duplicate required names, unsupported codecs, and a
known required name observed outside the placements below fail the whole asset.
Unknown optional extensions do not participate in selection and may use valid
core fallback. Direct Royal features do not imply support for a similarly
shaped glTF extension.

The glTF Lab distinguishes a `supported-oracle` from a
`core-fallback-oracle`. The latter proves that an optional extension's authored
core fallback remains renderable; it is not evidence that Royal implements the
extension's visible semantics. An asset that requires unsupported semantics is
an `expected-required-failure` and is never included in a success sweep.

| Required extension | Accepted placements | Canonical result |
| --- | --- | --- |
| `EXT_mesh_gpu_instancing` | node | validated instance transform batches sharing ordinary geometry/materials |
| `EXT_texture_webp` | texture | ordinary cold texture recipe using the extension image source |
| `KHR_draco_mesh_compression` | mesh primitive, async preparation with available decoder | validated canonical triangle attributes and indices |
| `KHR_lights_punctual` | document and node | canonical punctual light definition and transformed occurrences |
| `KHR_materials_emissive_strength` | material | multiplied canonical emissive factor |
| `KHR_materials_ior` | material | canonical dielectric index of refraction |
| `KHR_materials_specular` | material | factors and ordinary specular/specular-color texture recipes |
| `KHR_materials_transmission` | material | transmission factor/texture and demand-loaded composite classification |
| `KHR_materials_unlit` | material | canonical unlit material |
| `KHR_materials_variants` | document and mesh primitive | named canonical material choices preserving node/pick identity |
| `KHR_materials_volume` | material, with active transmission | thickness/attenuation inputs on the transmission composite path |
| `KHR_mesh_quantization` | document declaration; current profile is Draco-decoded canonical attributes | normalized integer attributes lower to canonical float streams |
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
- Mesh quantization currently accepts the normalized integer attribute forms
  decoded by the Draco adapter. Uncompressed quantized attributes still fail
  at their semantic reader instead of being interpreted as floats.
- Variants accept named root definitions and primitive mappings.
- `MSFT_lod` accepts node/material ID chains and the
  `MSFT_screencoverage` extras convention. It does not claim progressive
  lowest-level-first network publication.

Schema validation belongs to these cold readers, not to draw code. A profile
addition must add positive placement/payload oracles, wrong-placement and
invalid-payload failures, canonical lowering tests, and any required visual or
device proof.

## Explicit non-claims

Royal currently rejects required `KHR_texture_basisu`,
`EXT_meshopt_compression`, image-based-light
extensions, the remaining PBR extension family, and all draft or imaginary
texture extensions. Browser AVIF remains valid as a direct ordinary Royal
texture source; `EXT_texture_avif` is not a registered glTF extension and is
never interpreted. `GS_texture_svg` remains a documented vendor proposal, not
a current required-extension claim.

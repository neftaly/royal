# Optional glTF feature profile

Status: reviewed extension policy; registry checked 2026-07-19

The authoritative registry is the Khronos
[glTF extension registry](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md).
Registry presence does not by itself justify renderer support. Royal supports an
extension when it improves the product workload, lowers into canonical data,
has a clear fallback/failure model, and does not charge unrelated scenes.

Optional glTF expansion is lower priority than the already-deferred basic
animation slice. Current work should audit truthfulness and architecture, not
grow the implementation, unless a representative asset is blocked by a small
compatibility fix.

## Decision rules

An extension is a strong candidate when:

- it is ratified or widely deployed;
- unsupported consumers have valid core fallback or required-extension failure;
- its format-specific structures disappear during preparation;
- it reuses existing scene, material, texture, light, instance, visibility, and
  executor paths;
- official sample assets can act as correctness oracles;
- target-device cost is absent when unused and acceptable when used.

Royal MUST validate every unknown `extensionsRequired` name before publishing
content. Unknown `extensionsUsed` may be ignored when core glTF remains valid.
Draft extensions are not added to the supported-required set merely to appear
compatible.

## Adoption rubric

Score a proposed extension from 0 (no evidence) to 3 (strong evidence) on each
axis:

| Axis | Question |
| --- | --- |
| Corpus | Do representative Royal assets actually use it? |
| Product value | Does it fix broken content or materially improve fidelity, bytes, memory, load, or frame cost? |
| Canonical lowering | Does its name/schema disappear before retained frame data? |
| Unused cost | Is code lazy/tree-shaken and runtime cost effectively zero when absent? |
| Fallback honesty | Can optional fallback and required failure be implemented exactly? |
| Stability | Is it ratified/widely deployed with stable producer tooling? |
| Oracle | Are official validation and visual assets available? |
| Target fit | Does it work and pay on Safari 17/A10 and Quest 2? |
| Ownership | Does it reuse existing identity, scheduling, resource, and failure owners? |
| Maintenance | Is its code/test surface proportional to its Royal value? |

The score is a discussion aid, not arithmetic authority. An extension is rejected
regardless of total if fallback honesty, security/authority, or ownership scores
zero. Ordinarily it needs strong corpus/product evidence, complete cold lowering,
and no new hot-path vocabulary. “Easy to parse” is not product value.

Priority classes:

1. **Blocked compatibility:** common representative content cannot render
   correctly without it.
2. **Measured delivery:** the same semantics become substantially cheaper
   (KTX2/Basis, Meshopt, Draco compatibility).
3. **Royal product feature:** deliberate visible/runtime capability with its own
   behavior spec (variants, advanced PBR, LOD).
4. **Cheap ingestion:** format detail lowers completely but is not urgent.
5. **Metadata/tooling:** safely ignore or leave to another package.
6. **Architecture fork:** reject until it becomes a separately chosen product.

Classes 4–6 do not displace renderer correctness, performance, cleanup, or basic
animation work.

## Honest partial support

Support is recorded as a profile, not one extension-name Boolean. Each profile
states:

- accepted object placements and fields;
- validation performed;
- canonical lowering result;
- runtime semantics actually honored;
- optional fallback;
- behavior when listed in `extensionsRequired`;
- official tests/oracles exercised.

Royal may include a name in its required-extension allowlist only when every
semantic use accepted by its schema/reader is implemented by that profile. If a
document uses an unsupported placement/field that affects required semantics,
the asset fails. Optional usage may fall back to valid core representation and
emit one bounded diagnostic.

Partial quality or loading optimization is not necessarily partial format
support. The distinction must be explicit.

## `MSFT_lod` support profile

The extension defines ordered lower-quality IDs on both nodes and materials.
`MSFT_screencoverage` in `extras` is a switching hint. Progressive lowest-LOD-
first loading is a permitted implementation strategy, not a required format
semantic.

Royal currently:

- validates node/material LOD indices and child/LOD cycles;
- reads node and material LOD chains, including material LOD inside variants;
- normalizes screen-coverage thresholds;
- selects projected-coverage LOD with hysteresis across all active views;
- honors a positive lowest threshold by rendering nothing below it;
- preserves a drawable level while a selected replacement texture settles;
- shares texture/resource identity across levels.

Royal currently prepares the asset's geometry as one scene rather than
progressively publishing the lowest geometry LOD before higher levels. That is
a missing load optimization, not a false implementation of the declared node
or material LOD relationships. It should be pursued only if large real LOD
assets show time-to-first-draw improvement worth a more complex preparation
publication lifecycle.

## Deferred: `KHR_node_visibility`

`KHR_node_visibility` is ratified and has official static and animation-pointer
sample assets, but Royal does not currently support it and no implementation is
authorized by this specification. It is the first optional glTF feature to
reconsider after basic animation because static visibility can lower without a
new draw path.

Static false nodes are filtered or marked inactive in canonical scene topology
before packet emission. They create no shader feature, draw branch, resource
claim, or picking target. Descendant and attached-light semantics follow the
extension specification exactly. Static true is equivalent to core behavior.

When animation is absent, no runtime visibility channel exists. If
`KHR_animation_pointer` is later implemented, the same canonical active-state
revision can become dynamic and invalidate bounds, visibility, picking, light,
and packet state together. Do not build that controller during static support.

Current implementation status: unsupported required assets fail. This is a
deliberate future compatibility gap, not current claimed support.

## Deferred: `EXT_lights_ies`

Royal does not currently support IES profiles. Registry presence is not enough
to add another light representation, texture lookup, and fragment cost. Revisit
only when a representative Royal scene requires the fidelity and the existing
punctual-light path is stable and measured on Quest 2 and Safari/A10.

## Deferred behind animation: `KHR_animation_pointer`

`KHR_animation_pointer` is ratified but can mutate arbitrary properties in the
glTF asset object model. It is much broader than basic node TRS animation.

Royal should first prove the deferred core TRS animation slice. A later pointer
implementation needs an explicit allowlist of canonical mutable targets and
typed lowering; it MUST NOT interpret JSON Pointer strings during frames or
mutate prepared glTF objects as renderer state. Material/light/visibility
changes must enter the same revision and packet paths as equivalent Royal
changes.

Weights, skins, morphs, cameras, `extras`, and unknown extension targets remain
unsupported until separately specified. A pointer extension declaration is not
permission to turn arbitrary asset JSON into application authority.

## Metadata-only or tool-domain extensions

`KHR_xmp_json_ld` and `EXT_mesh_manifold` do not change current rendering
semantics. Royal MAY ignore them when optional. It SHOULD NOT retain or expose a
generic metadata graph merely for format completeness. An asset/tooling package
can parse them if a real product consumer emerges.

Collision shapes, rigid-body physics, audio graphs, interactivity, and
application hover/select metadata do not belong in Royal. Royal is a renderer,
not a game engine or application runtime. Optional occurrences may be ignored
when core rendering remains valid; required occurrences fail as unsupported.

## Out of scope

Video/procedural texture graphs, interactivity, physics, audio, collision, and
application behavior are not Royal features. They require different execution,
authority, or resource models and MUST NOT widen the renderer's public API or
hot paths. Optional occurrences may use valid core glTF fallback; required
occurrences fail as unsupported.

## Large-world and float64 drafts

Royal does not support `KHR_accessor_float64`. WebGL2 vertex input and shaders
do not provide a matching general double-precision path. Silently downcasting a
required float64 accessor would be false compatibility, so such assets fail.

## Texture format extensions

`KHR_texture_basisu` remains the preferred portable compressed-delivery path.
`EXT_texture_webp` remains a browser-decoded compatibility option with core
fallback. The current Khronos registry has no registered AVIF texture extension;
Royal MUST NOT invent one under `KHR` or `EXT` naming.

Direct Royal ordinary image sources may use any browser-decoded format that
passes the normal image capability and failure boundary. That does not make the
format valid in core glTF. `GS_texture_svg` remains an explicitly unregistered
proposal until its vendor work is complete.

## Vendor packing and rendering extensions

`MSFT_packing_normalRoughnessMetallic` and
`MSFT_packing_occlusionRoughnessMetallic` are candidates only if representative
assets show meaningful fetch, GPU-memory, or texture-unit savings beyond core
glTF's ability to reference shared packed images. They must lower into existing
canonical texture slots and shader inputs; no Microsoft-specific draw path may
survive.

Other vendor material, outline, articulation, media, and metadata extensions
require a concrete Royal product workload and independent behavior spec before
support. Vendor registry presence alone is insufficient.

## Already broad enough

Royal already implements nearly the whole ratified static PBR material family,
compressed geometry/textures, texture transforms, GPU instancing, variants,
punctual lights, image-based lights, and vendor LOD. The highest-value work is
therefore correctness, visual oracles, preparation/resource efficiency, and
canonical hot paths—not maximizing extension count.

# Level-of-detail behavior

Date: 2026-07-15

Royal uses discrete levels authored or generated offline. The runtime chooses
among prepared levels; it does not simplify meshes on the render thread.

## Product promise

LOD reduces geometry and material cost without changing application scene
structure or logical picking identity. Royal's runtime model is `LodSet`.
File-format declarations such as `MSFT_lod` are ingestion adapters only.

## Authoring and ingestion

- Levels are ordered highest fidelity to lowest fidelity.
- Offline tooling should preserve silhouettes, material boundaries, UV seams,
  normals, tangents, skin/morph constraints if those features are later added,
  and a stable logical object identity.
- `MSFT_lod` node and material `ids` are supported because they describe real
  authored relationships. They lower to the same canonical model.
- `extras.MSFT_screencoverage` is a hint, not runtime policy. Royal validates
  and normalizes it before use.
- Node LOD may change geometry and materials together. Material LOD applies
  only within the node level where it is declared, matching the extension.
- A glTF without extension support naturally sees the highest level. Royal
  should keep that fallback valid when producing assets.

The Microsoft extension explicitly allows either distance-based switching or
progressive loading. Royal chooses screen coverage because it is stable across
world scale, field of view, canvas resolution, and XR. The extension does not
require Royal to copy a particular loading algorithm.

## Selection

For each active view, Royal projects conservative object bounds and computes a
screen-coverage ratio. The maximum ratio across views drives selection.

A simple ratio is the correct baseline, with these constraints:

- thresholds are monotonic and clamped to `[0, 1]`;
- a small hysteresis band is applied around the current threshold;
- the finest qualifying drawable level wins;
- if that level is not ready, the nearest drawable lower level is used, then a
  higher one if no lower level is available;
- an object is not culled merely because no authored threshold reaches zero;
  culling remains an explicit visibility decision;
- projected bounds crossing the near plane are conservatively clipped rather
  than treated as zero or infinite coverage.

The initial default threshold sequence is geometric (`0.2`, `0.05`, `0.0125`,
then divided by four), ending in a drawable lowest level. Asset hints override
defaults only after validation. Defaults are tuning data, not part of the public
React API.

## Loading and cost

Version one of the product may fetch and prepare all levels with the asset.
That is simple but costs the sum of every level in network, decoded memory, and
GPU memory. Sensible geometric reductions make the extra geometry approach a
bounded series, but textures and distinct materials can dominate it.

Progressive loading is a later transport feature:

1. fetch enough metadata to discover levels;
2. make the lowest useful level drawable first;
3. upgrade opportunistically without blocking the frame;
4. retain a drawable ancestor while finer work is pending;
5. cancel upgrades when the asset or demand disappears.

`MSFT_lod` relationships may be used for this, but a monolithic GLB cannot make
arbitrary ranges cheap automatically. Packaging and HTTP range behavior must be
measured before promising streaming.

## Identity and interaction

Switching LOD does not change the logical glTF node, instance, or pick identity.
Bounds used for picking and culling must conservatively cover all levels unless
the active level provides an equally safe bound. Material variants select the
variant first; LOD then selects the prepared level within that variant.

## Acceptance gates

- deterministic threshold and hysteresis property tests;
- missing/out-of-order readiness tests;
- near-plane, huge-bound, tiny-bound, and stereo disagreement cases;
- visual silhouette and material continuity oracles;
- traces proving lower CPU/GPU cost on iPad and Quest without switch thrash.

Reference: the Khronos registry's
[`MSFT_lod` specification](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/MSFT_lod).

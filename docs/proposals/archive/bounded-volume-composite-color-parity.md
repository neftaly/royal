# Bounded-volume composite colour parity

Status: closed. Fixed in Royal 0.0.19 by `5bb9ab6c`. Ordinary surfaces keep
their direct presentation when a volume is added; unsupported composited volumes
do not downgrade an established HDR target. See the
[rendering contract](../../specs/rendering-and-presentation.md) and
[0.0.19 changelog](../../../CHANGELOG.md#0019---2026-09-05).

The original 0.0.18 bug report and investigation plan follow for provenance;
present-tense descriptions below refer to that affected version.

## Summary

Adding the first `boundedVolume` node can change the colours of surfaces that
are outside the volume and receive no volume contribution. Probability
reproduces this with Royal 0.0.18: selecting a piece adds one bounded volume,
and unrelated board and piece colours visibly change at the same time.

This is not intended light transport. `boundedVolume` is an emissive medium and
does not add an analytic light. Unaffected pixels must remain presentation-
equivalent when the node merely causes Royal to enter its composite path.

Treat this as a renderer correctness bug, not a request for Probability to
replace its volume with a surface material. An unlit transparent proxy would
avoid the composite transition but would also discard the volume semantics the
API was introduced to provide.

## Consumer reproduction

Repository: `garbo-succus/probability`

Branch: `prototype/hidden-information-light`

Integrating commit: `aa261a8` (`feat(play): render hidden information volume`)

1. Install the Royal 0.0.18 package tarballs.
2. Start Probability with the literal root `pnpm dev` command.
3. Open a populated play session with no local selection.
4. Select a movable piece. Probability adds one closed convex
   `boundedVolume` matching that piece's top-down hull.
5. Compare unrelated pieces and board regions before and after selection.

Observed: colours outside the volume change when the volume becomes active.

Expected: only pixels whose view rays accumulate nonzero medium density may
change. Unrelated opaque, mask, blend, unlit, and overlay presentation must not
change.

The consumer emits no point, spot, or directional light for this feature.

## Why this is not a small isolated fix

`SurfaceGpuOwner.drawViews` currently makes volume visibility sufficient to
request the composite path:

```ts
const compositeRequested = plannedCompositeRequested || volumeRequested;
```

That transition changes the destination and presentation contract for the
whole surface scene:

- ordinary surfaces switch from direct presentation to `LINEAR_OUTPUT` in an
  off-screen target;
- opaque depth becomes a sampled texture for the volume pass;
- remaining transmission and alpha-blended surfaces render into the retained
  target;
- `SurfaceCompositeOwner.present` applies exposure, tone mapping, and sRGB
  encoding in a terminal full-screen pass;
- the direct default framebuffer may be multisampled while the retained target
  is single-sampled;
- target format depends on `EXT_color_buffer_float` and `EXT_float_blend`.

Royal's conformance notes already record that a device with a float colour
target but without `EXT_float_blend` cannot use the retained HDR composite as a
quality-equivalent path for Probability's mixed standard, unlit, and blended
scene. A volume nevertheless requires blending and currently selects the
composite path. When float blending is unavailable,
`linearCompositeColorBytesPerPixel` selects an RGBA8 linear target. Values
above one can then be clipped before terminal tone mapping, which cannot match
the direct path.

Even when both float extensions exist, parity needs browser evidence across
mixed materials, alpha blending, terminal presentation, and the loss of the
direct target's MSAA. A local headless Chromium/WebKit-WebGL query reported
both extensions available, so the investigation must not assume the missing-
extension fallback is the only possible cause.

The affected seam is therefore render-graph and presentation policy, not just
the bounded-volume fragment shader.

## Minimal deterministic oracle

Add a Royal browser fixture with a fixed camera and deterministic scene. Do not
use pointer selection, camera settling, remote sync, or time-varying content.

Render two otherwise identical frames:

1. no bounded volumes;
2. one in-frustum bounded volume whose `color.a` is zero.

The second node must activate the complete volume/composite pipeline but its
shader must discard every zero-density fragment. Pixel output should therefore
be identical away from explicitly documented sampling differences. This is a
stronger oracle than placing a visible volume in a corner because it separates
path activation from the visual effect.

Include representative regions for:

- opaque standard material below and above the tone-map shoulder;
- textured sRGB base colour;
- unlit material;
- alpha mask;
- alpha blend over opaque content;
- scene background alpha;
- screen-space overlays after world presentation.

Run the same fixture with `linear-clamp` and `pbr-neutral`, non-unit exposure,
and both a small direct-eligible scene and a scene already eligible for
terminal presentation.

Compare interior pixels exactly where formats permit it. Define explicit
tolerances for half-float rounding and exclude only known raster-coverage edge
pixels from colour assertions. A whole-frame image similarity score is not a
sufficient oracle because edge and MSAA differences can hide interior colour
regressions.

## Capability matrix

Exercise or faithfully emulate these cases:

| Float colour | Float blend | Required decision |
| --- | --- | --- |
| yes | yes | Retained HDR volume path; unaffected interior pixels match direct presentation. |
| yes | no | Explicit quality-preserving fallback or explicit unsupported result; do not silently clamp the whole scene through linear RGBA8. |
| no | no | Explicit fallback or unsupported result with stable existing scene presentation. |

Do not infer `EXT_float_blend` from float renderability. Do not claim parity
from the fake-GL unit harness alone.

Test physical or real-browser paths for at least Chromium, Firefox, and WebKit,
including a device/browser combination without `EXT_float_blend`.

## Fix directions to investigate

### Preserve the HDR composite

Use the existing RGBA16F terminal path only when all required blending and
renderability capabilities exist. Repair any remaining direct/composite shader
or presentation mismatch under that supported capability set.

### Separate opaque HDR and medium accumulation

Keep opaque radiance in an HDR target that does not require float blending and
accumulate volume colour/transmittance in a separate blendable target. Combine
both at terminal presentation. This may preserve HDR on devices lacking float
blend, but it adds target memory, overlap/composition semantics, and another
pass. Measure it rather than assuming it is acceptable.

### Direct-presentation fallback

Render existing surfaces through their current direct path, retain only the
depth information required by the volume, and composite a presentation-space
approximation over the default target. This may preserve unaffected colours
but weakens physical linear-light composition and requires explicit semantics
for multiple overlapping volumes.

### Capability rejection

If no bounded and quality-preserving fallback is viable, reject or omit the
volume deterministically on unsupported devices while leaving the existing
scene unchanged. Silent whole-scene colour changes are not an acceptable
fallback. Any rejection must use Royal's normal diagnostic/lifecycle contract,
not a browser sniff or Probability policy.

Do not solve the issue by asking consumers to change their authored material
colours, exposure, lights, or tone mapping when a volume is present.

## Acceptance criteria

- Adding an in-frustum zero-density volume does not change unaffected interior
  pixels for supported capability paths.
- Adding a visible volume changes only pixels whose view rays receive a
  nonzero volume contribution, apart from explicitly measured raster-coverage
  boundaries.
- Removing the last volume restores the direct path without a colour flash,
  resource leak, or stale GL state.
- PBR values above one reach tone mapping without premature RGBA8 clamping.
- Mixed standard, unlit, mask, and blend scenes have an explicit and tested
  presentation contract.
- Background alpha and post-world overlays remain unchanged.
- Direct and composite exposure, `linear-clamp`, `pbr-neutral`, and sRGB
  encoding use one demonstrably equivalent transform.
- MSAA differences are either preserved, resolved equivalently, or documented
  and bounded to coverage edges; they must not alter interior colour.
- Capability loss/fallback never silently changes presentation of the whole
  scene.
- Real-browser tests assert GL errors remain empty and exercise volume
  activation, deactivation, resize, and context restoration.

## Probability disposition

Probability may temporarily use an unlit translucent hull/slice proxy if it
needs colour stability before a Royal fix, but that is an explicit visual
fallback and must not be described as volumetric. The preferred product path
remains `boundedVolume` once Royal guarantees unaffected-pixel colour parity.


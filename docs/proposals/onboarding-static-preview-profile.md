# Onboarding glTF capture: remaining work

Status: capture helper included in Royal 0.0.25; performance investigations remain.
`captureImage(root)` now owns readiness, final redraw and PNG capture, with
cancellation, a deadline and stage timings. It uses the existing root and
resource owners; consumers can reuse one root across captures. See the
[consumer API](../specs/consumer-api.md#image-capture).

## Consumer need

Probability onboarding uses a detached renderer to create static DOM images.
Its capture owner in `apps/onboarding/src/onboarding/model-face-images.ts` now
uses the optional Royal helper instead of polling resource counters. Existing local production
samples put a Classic die around 2.6–2.8 seconds after demand, with roughly
0.7 seconds around redraw/readback/encoding. These are lab observations, not
field percentiles or a current Royal speed comparison.

The linked Probability checkout now adopts the new API. Consumers using release tarballs
need Royal 0.0.25 or later.
`captureImage` reports preparation, CPU draw submission, combined canvas
readback/encoding, and total request time. It cannot separately time GPU execution,
readback and PNG encoding through `toBlob`; no such precision is claimed.

## Remaining experiments

1. **Per-root VT opt-out:** compare ordinary textures with automatic VT using
   original inputs, identical pixels/quality, memory and cold/warm timing. A
   requested ~62 KB runtime chunk alone does not establish a worthwhile speedup.
   No root option is currently implemented. Keep authored VT/SVG behavior explicit
   if an opt-out is accepted.
2. **Capture/readback performance:** use stage measurements to locate the remaining
   delay. Compare a renderer-owned asynchronous readback path only with a real
   bottleneck and complete alpha, context-loss, cancellation and encoding checks.

The optional `@royal/react/capture` and `@royal/renderer-webgl/capture` entry
points are implemented. Capture orchestration is outside the main entry graph;
the existing root supplies a small internal capability. This packaging change
is not evidence of faster capture. Any further static-renderer specialization
must justify retained bytes and runtime savings while sharing existing resource
and material code.

Preserve arbitrary model inputs, normal maps, materials, alpha and antialiasing.
Do not pre-render catalog faces, resize/replace source textures, rewrite glTF LOD
thresholds or remove lighting to make this fixture faster.

[Historical measurements and rejected encoder experiments](archive/onboarding-static-preview-profile-2026-09-11.md)
remain available. The [current native probe](../../research/image-capture/README.md)
checks unchanged Classic die inputs and keeps exploratory policy changes inside
the browser test only.

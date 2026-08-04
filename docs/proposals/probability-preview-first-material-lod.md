# Preview-first material LOD publication

> Proposal from Probability. This document requests renderer behavior only; it
> does not authorize Probability-specific application state or a private glTF
> texture extension.

## Problem

Royal implements `MSFT_lod` material selection and preserves a drawable lower
level while a selected replacement settles, but it prepares all image claims
together. A small lower material can therefore compete with the preferred
material instead of producing an earlier complete frame.

The existing Settlers control made every AVIF material's lower level a
128-pixel JPEG. On Intel hardware:

| Asset | Complete preview | Exact final |
| --- | ---: | ---: |
| Original AVIF | — | 2.995 s median |
| 128 px material LOD | 3.188 s median | 3.446 s median |

The format relationship worked and promoted correctly, but the preview arrived
after the original final image and delayed exact completion. Adding a codec
cannot fix that ordering.

## Requested behavior

Derive one cold resource plan from the selected scene's material LOD graph:

1. Identify the lowest complete drawable material level for each visible
   surface.
2. Prepare and publish those levels before preparing higher material levels.
3. Preserve Royal's existing base-color-before-auxiliary ordering within each
   level. Neutral auxiliary fallbacks must not delay a readable base-color
   preview.
4. Permit higher-level transport/read-ahead concurrently when it does not take
   preparation workers, GPU-upload budget, or coherent publication ownership
   from the preview phase.
5. Promote a material only when its selected level is coherently drawable. A
   promotion must not expose mixed bindings, neutral flashes, or replacement
   scene nodes.
6. A failed preferred level leaves the lower drawable level resident and emits
   one bounded resource diagnostic.

This should be normal `MSFT_lod` behavior with no application callback, mode,
priority number, or Probability-specific API. Screen-coverage selection remains
independent: while the desired level is unavailable, the nearest drawable level
is the presentation fallback.

The pure planner should produce stable phase/order metadata from canonical LOD
membership and texture-slot semantics. Fetch, decode, upload, cancellation,
context restoration, and diagnostics remain the imperative resource shell.

## KTX2 and VT relationship

Preview-first publication should be proven with a required lossy WebP
base-color tier first. Probability prioritizes total delivered bytes: WebP adds
no decoder bundle, avoids a duplicate core PNG/JPEG fallback when declared
required, and at 128 pixels keeps the complete preview upload small enough to
isolate scheduling. Normal, metallic-roughness, occlusion, and emissive inputs
may retain their semantic neutral fallbacks until the preferred material level
is coherently drawable; do not generate preview maps merely to make every slot
symmetrical.

The initial Settlers authoring control should use encoder quality `0.35` (or
the encoder's documented equivalent). Resizing its 44 color textures to a
128-pixel longest edge produced 24,476 bytes at quality 0.50, 21,218 bytes at
0.35, 19,268 bytes at 0.25, and 13,800 bytes at 0.05 with the available WebP
encoder. Below 0.35, visible ringing around text and hard color boundaries buys
only a few kilobytes across the complete game. Treat the value as a measured
fixture policy rather than a renderer constant; other content classes still
need their own size/quality control.

`KHR_texture_basisu` is a separate portability decision: it requires runtime
transcoding and does not describe raw ETC2 blocks. Royal's direct offline ETC2
KTX2 profile is useful for renderer-native textures and authored VT pages, but
there is no registered glTF texture extension for attaching that raw storage to
a material. This proposal must not invent or reinterpret one.

Authored VT already has the right spatial behavior: coarsest usable ancestors
first, then demanded fine pages. A later glTF-to-authored-VT contract may reuse
the same preview-first acceptance tests, but is not required to prove material
LOD scheduling.

Layered AVIF is also a separate experiment. AVIF can encode progressive spatial
layers, and WebCodecs describes incomplete progressive image generations, but
Royal's current browser-image path awaits a complete response blob and publishes
one `createImageBitmap` result. A streamed decoder would need to replace
successive generations under one texture identity, retain a drawable generation
through failure/cancellation, and prove physical Safari/iPad behavior. Each
generation would still be an uncompressed browser-decoded upload rather than a
direct VT block publication. Do not make preview-first material scheduling
depend on this optional browser capability.

## Measurement and acceptance

Use immutable Settlers variants with 128-, 256-, and 512-pixel lossy WebP lower
base-color material levels, plus the unchanged AVIF control. Record both the
aggregate preview bytes and the complete release-size delta. On a physical desktop GPU and an
iPad-class device record:

- first geometry;
- first preview pixels;
- complete playable preview;
- exact final promotion;
- source bytes, decode/preparation completion, upload traffic, and retained GPU
  bytes;
- failure, cancellation, and context-restoration outcomes.

The feature is justified only when complete preview is materially earlier than
the unchanged asset's exact final outside run variance, without materially
regressing exact-final completion. A fast first texture with an incomplete
table is not success.

### Reproduced WebP control

Probability now has a fixture generator and an alternating end-to-end observer
at `research/benchmarks/texture-delivery/`. The generator copied the unchanged
Settlers release, added required `EXT_texture_webp` images, and linked duplicate
materials through `MSFT_lod`. Its 44 shared color sources produced 56 material
levels. The complete q35 tiers were 21,218 bytes at 128 pixels and 47,312 bytes
at 256 pixels.

Three alternating headed Chromium runs on the Intel Iris Xe path, local
no-cache transport, and Royal 0.0.5 measured the final asset-driven frame:

| Asset | Preview responses complete | Preview uploads complete | Last asset-driven frame |
| --- | ---: | ---: | ---: |
| Original AVIF | — | — | 4.314 s median |
| 128 px WebP LOD | 3.406 s median | 5.618 s median | 5.689 s median |
| 256 px WebP LOD | 3.385 s median | not source-identifiable by dimensions | 5.827 s median |

The ordinary control submitted 45 browser-image uploads. Each LOD variant
submitted 89: all 45 authored AVIF images plus all 44 WebP images. The 128-pixel
preview therefore became GPU-complete about 1.30 seconds after the unchanged
scene had already reached its entire last frame, and it regressed that last
frame by 1.375 seconds. The 256-pixel tier was 1.514 seconds slower than the
control. Transport is not the explanation: both small WebP tiers completed
near the AVIF response tail, around 3.4 seconds.

This run deliberately disabled Royal's separate automatic-VT option after a
matched control showed that option adds another publication phase. It therefore
isolates ordinary material LOD scheduling rather than crediting or blaming VT.
The result confirms the original JPEG experiment with a smaller, required
representation: current preparation order defeats the preview.

Probability did not spend another full run on the 512-pixel variant. Both 128
and 256 submitted every preview and preferred source and regressed the terminal
frame; a larger duplicate cannot distinguish the scheduler cause. Keep 512 in
the post-fix acceptance matrix, where it can answer the useful quality/latency
tradeoff instead.

A preferred-image failure was also exercised by removing only
`models/tile-brick.avif` while retaining its 128-pixel WebP material. Royal
reported the entire glTF root as failed (`One or more required textures
failed`) instead of retaining the drawable lower material; the corresponding
brick tile disappeared from the rendered board. The diagnostic did not name
the failed image URI. This is a direct acceptance failure for requested
behavior 6, not a request for Probability to hide the failure.

Adversarial controls should include shared textures across material levels,
partially off-screen surfaces, repeated mounts, alpha masks, a failed preferred
level, a camera change during preparation, cancellation before promotion, and
context loss after preview but before final publication.

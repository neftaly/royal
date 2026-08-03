# Automatic instancing across VT-backed material identities

Probability's creator imports a board-game deck as independent, ordinary glTF
roots because each piece remains an independently addressable document object.
For a deck, those roots commonly have:

- byte-identical geometry for every card of one size and thickness;
- the same three physical surfaces: front, back, and edge;
- one distinct front image per card, usually one shared back and edge material;
- independent transforms, visibility, tint, lifecycle, and picking identities.

With automatic virtual texturing enabled, the distinct front images can share
bounded atlas residency. Royal also shares exact geometry across the roots.
Those two optimizations do not currently converge the visible roots into
instanced submissions: the front material source/page-table identity differs,
and ordinary glTF nodes remain separate surface occurrences. A roughly
72-card fixture therefore still behaves like roughly 216 independently
submitted surfaces even though it has only a few physical geometry families.

## Requested renderer behaviour

Royal should automatically converge compatible ordinary/repeated glTF
occurrences into instanced or equivalently bounded submissions when their
geometry and render state are compatible and their differing base-colour
images are backed by Royal's shared VT system. This should require no authored
`EXT_mesh_gpu_instancing`, texture atlas, material variants, or Probability-
specific public API.

The optimization must preserve:

- each occurrence's transform and stable picking result;
- exact alpha-mask and UV behaviour;
- progressive texture publication and neutral/error behaviour;
- distinct logical texture identity and VT demand;
- tint, handedness, culling, LOD, and lifecycle semantics;
- the ordinary non-VT and unsupported-capability fallback paths.

The target lowering for the deck is approximately one submission per compatible
surface/geometry cohort, not one submission per card. In particular, a shared
back or edge should trivially converge, while unique VT-backed fronts should be
able to vary their logical VT image per instance without rebinding an ordinary
texture for every card.

This is intentionally an automatic retained-renderer optimization. The caller
already supplied the semantic information: exact shared geometry, independent
occurrences, and VT-eligible texture sources. Requiring the caller to rewrite
its document model or synthesize renderer batches would duplicate Royal's
canonical scene knowledge and make normal glTF composition unexpectedly slow.

## Design questions to resolve in Royal

A likely implementation needs a compact per-instance material/VT selector and
a shared indirection domain for automatic VT resources. That is only a
candidate, not a requested ABI. Other valid lowerings include a retained
multi-draw/material table on implementations where it is measurably better.

Adversarial cases include:

- two images that share an atlas but have different page-table dimensions or
  sampler policy;
- one image still loading, failing, becoming resident, or being evicted;
- alpha-mask materials requiring exact per-image picking data;
- negative transforms and mixed front-face state;
- overlapping transparent surfaces, for which ordering can prohibit grouping;
- a changing scene where one instance moves without rebuilding every cohort;
- WebGL implementations without useful multi-draw support;
- small cohorts where packing/indirection costs more than separate draws.

The optimization should therefore be measurement-gated and derived from
canonical compatibility, not merely equal source dimensions or glTF names.

## Measured Probability workload

An explicitly offline headless Chromium run imported the real Bus PNG folder
into a blank Probability scene and waited 30 seconds after the document
transaction:

`~/dev/cardcutter/tests/fixtures/bus-game-cards/PNG`

The cold root snapshot reported:

- 219 primitive geometry claims, 9 unique canonical geometries, and 210 reused
  claims;
- 57 unique base-colour candidates;
- automatic VT enabled, but only 1 automatic resource and 56 ineligible
  candidates;
- 57 resident ordinary textures using 54,191,096 GPU bytes;
- no pending geometry, texture preparation, page reads, or uploads.

Thus Probability is already supplying exact shared geometry. The remaining
deck scales with surface/material occurrences. During a three-second camera
pan the instrumented WebGL context observed 8,838 `drawElements` calls across
46 browser frames: approximately 192 submissions per frame. Frame p95 was
150 ms in headless software rendering, versus 33.4 ms for the blank scene.
The absolute software-rendering time is not a hardware claim; the submission
count and root diagnostics are renderer facts.

The 56 rejected candidates are expected under Royal's current per-image VT
policy: imported cards are deliberately resized to about 378 texels on their
long edge, below the threshold at which one image independently amortizes a
VT page table. For a deck, however, their aggregate cohort is exactly where a
shared VT/material indirection could amortize. Eligibility and convergence
therefore need to consider the compatible cohort, rather than accepting only
images that independently justify a dedicated VT resource.

## Acceptance workload

Use Probability's real Bus PNG fixture rather than a synthetic same-texture
instance test:

`~/dev/cardcutter/tests/fixtures/bus-game-cards/PNG`

Repeat with the SVG sibling to cover Royal's encoded SVG page source, but do
not substitute it for the raster case: the two sources currently enter
different automatic-VT lifetime and eligibility paths.

Import it into a blank Probability game with `automaticVirtualTexturing: true`,
wait for terminal texture settlement, then exercise camera movement, hover
picking, and dragging. Compare at least:

- visible surface count versus actual color/depth submissions;
- instanced or multi-draw cohort count;
- frame p50/p95 during camera movement and pointer-rate exact picking;
- scene rebuild and allocation work after one transform changes;
- VT candidate/resource/page diagnostics and visual correctness;
- the same run with the optimization disabled.

Success is not merely lower retained texture bytes. The imported deck should
remain interactively smooth, and its steady-state submission count should
track its small number of compatible geometry/surface cohorts rather than its
card count. If the real fixture disproves this proposed bottleneck, record the
profile and reject or narrow the proposal instead of adding the mechanism.

# Probability: screen-space partitions for coincident edges

## Decision

Royal admits one renderer-level coverage descriptor for the Probability use
case:

```ts
const coverage = screenSpacePartition({
  cellSizeCssPixels: 1,
  count: 3,
  index: 0,
});

edgeMaterial({
  color,
  coverage,
  widthCssPixels: 4,
});
```

`screenSpace` names the coordinate domain. `partition` names the useful hard
guarantee: for matching `cellSizeCssPixels` and `count`, every cell maps to
exactly one `index`. `index` and `count` are neutral renderer vocabulary; they
do not make Royal aware of participants, selection, ownership, or conflicts.
`coverage` describes how an edge material consumes the descriptor.

The alternatives are less precise. A mask usually implies an application
image, stipple does not promise complementary draws, interleave suggests a
particular stripe pattern, and lane can imply draw ordering. The descriptor is
separately typed so another material may explicitly admit it later, but this
decision gives it semantics only on `edgeMaterial`.

## Contract and limits

- `cellSizeCssPixels` is a positive finite number. Royal does not round or
  silently clamp it.
- `count` is an integer in `[1, 4096]`. `index` is an integer in `[0, count)`.
  The upper bound is the number of cells in the renderer's 64-by-64 pattern,
  so every accepted index owns at least one cell per tile. It is an explicit
  representation bound, not a Probability participant model.
- Matching descriptors use the same deterministic phase. Supplying every
  index covers each cell exactly once, without holes or double coverage.
- The phase starts at the lower-left of each view. Stereo eyes therefore do
  not acquire different phases merely because their viewports occupy different
  parts of one framebuffer.
- CSS-pixel sizing follows the existing edge-width scale on an ordinary
  canvas. XR has no CSS box, so one XR presentation pixel uses the existing
  Royal edge convention of one CSS-equivalent pixel.
- Material color and alpha retain their existing meaning on covered cells.
  Geometry borrowing, active LOD, visibility, depth, picking, and presentation
  transforms are unchanged.

The exact guarantee is cell ownership, not equal color weight on every edge.
A short or clipped edge can cross an unequal sample of cells. A long ordinary
board-game outline should approach equal visual weight statistically. Royal
cannot infer or validate a relationship between separate application draws;
mixing different counts or cell sizes has no complementary guarantee and can
make alpha blending order observable.

## Renderer shape

The edge resolve already evaluates the expanded edge signal in screen space.
The partitioned variant converts the view-local fragment coordinate to a cell,
fetches that cell's 12-bit bucket from a deterministic 64-by-64 `R16UI`
pattern, and maps the bucket to `[0, count)` with
`(bucket * count) >> 12`. A non-matching cell writes zero alpha; it does not
discard. The pattern is a permutation of every value from 0 through 4095, so
the exact coverage and non-empty-index guarantees do not depend on a random
distribution.

Royal generates and uploads the 8 KiB pattern once per WebGL context. The
partitioned path lazily creates one shared texture and one optional resolve
program on first use. It adds no geometry, framebuffer, render target,
per-frame texture upload, animation clock, or render pass. Context loss and
restoration follow the existing optional edge-owner lifecycle. The ordinary
solid resolve shaders remain byte-for-byte unchanged.

"No new pass" is relative to the same number of edge runs. Different colors
already require distinct edge runs. Coverage is part of edge style identity,
so otherwise-identical materials with different partition indices also become
distinct runs; they cannot share one mask/resolve transaction. Relative to the
same three solid runs, the iPad capture recorded identical draw counts and one
additional texture bind plus twelve additional uniform calls per measured
frame. The feature does not remove the roughly 350 ms complete-frame
presentation cost observed under headless software WebGL.

## Adversarial review

- A diagonal sum such as `(x + y) % count` was rejected because one exact
  diagonal can remain in a single partition.
- A procedural 32-bit avalanche hash was implemented and passed directional
  reference tests, but matched physical iPad runs put its p95 at 72--74 ms
  against 63--64 ms for solid coverage. Dynamic integer hashing and reduction
  are therefore not the golden path.
- An 8-bit texture was rejected after implementation because a pattern with
  only 256 values silently permits empty indices when `count` is larger than
  256. The final 16-bit permutation makes every public value up to 4096
  representable and non-empty.
- A fixed tile can reveal its 64-cell period on long straight edges, and fine
  one- or two-pixel cells can crawl while an edge moves. The shuffled
  permutation avoids simple row, column, and diagonal symmetries, but it is not
  blue noise and the contract does not promise temporal stability. Animating
  the phase would break stable identity rather than solve the underlying
  sampling limit.
- Divergent `discard` was rejected. Zero alpha preserves the existing resolve
  shape, while the solid program has no coverage branch or sampler.
- Absolute framebuffer coordinates were rejected because side-by-side stereo
  viewports would receive unrelated offsets. View-local lower-left phase is
  explicit and covered by a two-eye viewport-origin test.
- A physical capture exposed a texture-unit state declaration that bound the
  wrong signal and colored the whole surface. The declaration now includes
  both used units, and a state-rebinding regression test prevents recurrence.
- View-local phase does not prove binocular comfort. The same world edge lands
  at different screen coordinates in each eye, so fine color samples can still
  disagree and shimmer or rival. Royal does not silently substitute a coarser
  or different XR pattern.
- Very short or distant edges cannot communicate arbitrarily many colors.
  Probability can add an overlap count or inspectable marker when color alone
  is insufficient. Identical colors are likewise an application identity
  issue.

## Evidence and acceptance

Automated coverage includes descriptor copying and validation, public core and
React exports, permutation uniqueness, two- and three-way directional
sequences, all 4096 valid indices, exact complementary ownership, separate run
lowering, DPR 2 sizing, lazy GPU allocation, no per-frame upload, context
restoration, texture-unit state restoration, and independent `[0, 0]` and
`[100, 0]` view origins.

The 2026-08-01 physical-device A/B used the exact production build
`4947ebc1cd82-dirty-msaao2sk`:

- iPad Safari 17.14 on Apple GPU, at DPR 2 and a 1916-by-903 backing canvas,
  completed 24/24 camera-motion samples. Partition coverage measured
  60/65/66 ms p50/p95/p99; the otherwise-identical three-run solid control
  measured 59/63/66 ms. Both submitted 408 draws, and neither uploaded texture
  data during measured frames. The retained capture shows only the coincident
  outline and all three colors.
- Quest Browser 149 on Adreno 650 completed the harness-controlled two-view
  path at 14.6 ms frame/XR p95 and 2.0 ms XR-callback p95. Its solid control
  measured 14.7 ms frame/XR p95 and 2.2 ms callback p95 from the exact same
  deployment. This proves the final shader, texture format, and view-local
  renderer path on the physical GPU. It is not an immersive-session comfort
  result: trusted immersive activation did not complete during this pass.

These results accept the renderer primitive for Probability's ordinary-canvas
golden path. Remaining XR acceptance is a human stereo-comfort pass during head
motion at intended viewing distances. DPR 1 and two-CSS-pixel visual captures
would broaden presentation evidence but do not block the measured DPR 2,
one-CSS-pixel Probability path.

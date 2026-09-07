# Screen-space tolerant picking investigation

Status: proposal for research, not an accepted API or implementation plan.

Probability needs small visible tabletop pieces to be easier to acquire with a
coarse pointer. The renderer question is narrower than Probability's gesture
policy: can Royal identify the nearest **visible** pickable surface within a
screen-space aperture accurately and cheaply?

Royal should not implement the API sketched here without first brainstorming
alternatives, building competing experiments, and adversarially reviewing the
semantics, performance, memory, public surface, and interaction with the exact
picker. Rejecting the feature is a valid result if the evidence does not support
a general renderer primitive.

Probability's separate consumer-behaviour investigation lives at
`~/dev/probability/research/touch-target-acquisition.md`. Royal must not absorb
its selection, drag, or camera policy.

## Boundary

Royal owns:

- canonical geometry, transforms, sidedness, alpha masking, LOD, visibility,
  depth, and screen projection;
- the exact and tolerant spatial queries and any shared acceleration data;
- a result that preserves enough geometry and screen-distance information for a
  caller to resolve its own gesture.

The consumer owns:

- whether the pointer is coarse;
- whether and how much tolerance to request;
- which result starts a selection, drag, camera gesture, or nothing;
- any minimum target-size, selected-target, or accessibility policy.

This must not add selection concepts, pointer-device heuristics, game-piece
metadata, or camera-pan rules to Royal.

## Required semantics to investigate

The useful query is a circular CSS-pixel aperture: a narrow cone under a
perspective camera and the corresponding parallel volume under an orthographic
camera. It is not a world-space sphere around a ray. CSS scaling, DPR, viewport
offset, and backing resolution must not change its apparent size.

The current exact query remains authoritative. If the centre ray hits an
eligible target, that target wins. Otherwise a tolerant query should be able to
distinguish:

- eligible pick targets;
- non-eligible visible surfaces that still occlude targets;
- empty background.

`pickingId` is the likely existing eligibility signal, but this assumption must
be challenged against imperative `root.pick` consumers. Do not create a second
identity system.

Candidates should be ranked by the minimum screen-space distance from the query
centre to their **visible silhouette**, not by object origin, bounding-box
centre, document order, or the first sample that happened to hit. An exact hit
wins first; otherwise screen distance wins, then front-most depth for an
effective tie. The final tie-break must be deterministic without leaking packed
slots, draw order, or transient frame identity.

The visible silhouette requirement includes normal Royal rules for transforms,
instances, LOD, sidedness, authored picking geometry, and alpha masks. A locked
board with no eligible identity may occlude a piece behind it without itself
becoming the tolerant result. Bounds remain broad phase only.

An expanded result does not generally lie on the original centre ray. Simply
adding `radius` to the existing `PickInput` risks making the existing
`PickResult.point`, `distance`, and client-coordinate contract false. Evaluate
whether the correct API is an explicitly different region result containing
both query centre and actual hit coordinate, or another smaller representation.
Do not choose API shape before proving the query.

## Competing approaches

At minimum, compare rather than assume:

1. **Multi-ray baseline.** Concentric or adaptive exact-ray samples reuse
   current visibility semantics, but can miss thin geometry between samples,
   bias results by sample order, and multiply the existing triangle scan.
2. **CPU aperture query.** Projected bounds generate candidates; projected
   triangles or an equivalent closest-feature calculation determine silhouette
   distance. Visibility and partially occluded silhouettes are the difficult
   part and require an independent oracle.
3. **Shared-geometry BVH.** A BVH can accelerate exact rays and aperture
   candidates, but is only an acceleration structure, not the winning-target
   semantics. Reuse one structure per canonical shared geometry across
   transforms and instances. Measure whether direct scans remain better for
   small card/box meshes.
4. **Small GPU identity/depth region.** This may give a strong visible-pixel
   oracle, but an extra pass and synchronous readback may be worse than CPU work
   and conflicts with Royal's current preference not to render an ID buffer for
   retained CPU geometry. Treat it as an experiment or oracle unless evidence
   is decisive.
5. Any simpler alternative found during fresh brainstorming. The list above is
   not permission to prematurely converge on a BVH.

Consider a hybrid such as candidate generation followed by exact visibility
rays. Adversarially check whether it loses the visible remainder of a partially
occluded target after its nearest projected point is rejected.

## Fixtures and adversarial cases

Extend the existing `research/picking-fuzz` work instead of creating a
Probability-shaped test harness. Include deterministic cases for:

- two small pieces whose expanded regions overlap at varied gaps and depths;
- a thin exposed card edge in a stack;
- irregular, concave, holed, alpha-masked, double-sided, and mirrored geometry;
- a target partly and fully occluded by an eligible or non-eligible surface;
- repeated instances sharing geometry but carrying distinct logical identity;
- a large locked board beneath pieces;
- targets crossing the near plane, canvas edge, or LOD boundary;
- loading, failed, and authored `pickingGeometry` paths;
- perspective and orthographic cameras, tilted and overhead views;
- CSS resize, fractional DPR, and a non-zero canvas client offset;
- a medium-density board game and a deliberately excessive instance scene.

Fuzz candidate distances and overlaps. Compare logical results with an
independent visible ID/depth oracle rather than testing the implementation
against itself. Preserve failing seeds as replay fixtures.

## Measurements

Report at least:

- false positive, false negative, wrong-target, and unstable-tie counts;
- exact-pick and tolerant-pick median and p95 latency;
- worst useful aperture cost in a dense scene;
- allocations after warm-up;
- BVH or other acceleration build time, retained bytes, and update/reuse cost;
- exact hover cost before and after the change;
- package and deployed gzip impact;
- iPad Safari results, not desktop Chromium alone.

Measure input-down queries separately from continuous hover. A slow path that is
acceptable once per gesture must not accidentally become Royal React's default
pointer-move path.

## Review questions

- Can the query report the closest **visible** silhouette without a new render
  pass?
- Does a proposed optimization preserve exact alpha-mask, LOD, proxy, and
  instance identity semantics?
- Can shared geometry own acceleration without per-occurrence duplication or a
  second invalidation lifecycle?
- What happens when two candidates have equal screen distance and depth?
- Can a non-eligible occluder remain authoritative for visibility?
- Is the API honest about the actual hit coordinate and ray?
- Is the implementation stack-safe, bounded by real scene data rather than
  arbitrary magic limits, and allocation-stable?
- Does this primitive generalize beyond Probability without introducing UI
  policy into a renderer?
- Is retaining exact picking plus a small consumer-owned fallback actually
  simpler and faster overall?

Before recommending implementation, perform multiple functional-core,
ownership, lifecycle, public-API, performance, and LOC reviews. Prototype at
least two materially different approaches when feasible. Record rejected
approaches and the evidence, and actively look for a smaller API or no new API.


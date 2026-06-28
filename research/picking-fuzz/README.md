# Picking Fuzz Research

This prototypes the automated picking/fuzzing path for hover and raycast
regressions. It does not fix the Damaged Helmet hover shape. The goal is to
make regressions reproducible by separating event generation, observed state
readback, and visible-shape oracles.

## Current status

Renderer picking integration is still WIP. There is currently no
`/labs/picking-fuzz` examples route, no `PickingFuzzLab`, no renderer picking
API, and no browser adapter that reads live Royal renderer picking state. The
files in this directory are research-only fixtures and oracles; they do not
define a supported runtime API for packages or examples.

The standalone harness in this directory is still useful as a research contract
for geometry and hit-logic validation:

- generate sample coordinates against a target region;
- compare logical hit results with an independent visible-shape oracle;
- report mismatches that can be replayed and translated into browser cases.

A future renderer integration should provide a live probe contract that can:

- drive pointer events against the stage or a canvas;
- read a live hover id and the latest pick probe/debug rows;
- compare that logical pick with an independent visible-pixel oracle.

That integration should add a tiny browser-only probe object. The likely shape
is:

```ts
window.__royalPickingProbe = {
  hoveredId: string | null,
  rows: PickingReplayRow[],
  geometryStatus?: string,
  geometryFailures?: unknown[],
};
```

That object can be populated from future renderer interaction state, from a
future Tarstate-like picking lab, or from an example-specific probe for WebGL
cases. Until that browser object exists, `PickingReplayRow` means the JSON row
contract in `fixtures/replay-row.schema.json`, not a current renderer export.

## Replay row contract

The replay row contract records the minimum information needed to replay a
pointer sample and compare a logical pick with an independent visual oracle:

- `pointerSample`: deterministic pointer coordinates, event type, and coordinate
  space.
- `expectedHit`: the target id expected by the visible-shape oracle, or `null`.
- `observedHit`: the target id reported by the picker/probe under test, or
  `null`.
- `visiblePixelOracle`: the independent visible-pixel result for the sampled
  coordinate. `targetId` matches `expectedHit`; `classification` is
  `covered-target`, `covered-other-target`, or `empty`.
- `hitRegionRef`: metadata for the observed hit region, when one exists.
- `visualBounds`: the visible oracle's target bounds, when visual coverage
  exists at the sample.
- `classification`: `match`, `false-positive`, `false-negative`, or
  `wrong-target`, derived from expected versus observed hit ids.

The committed smoke fixture is intentionally small:

```sh
node research/picking-fuzz/picking-fuzz-harness.mjs replay/check \
  research/picking-fuzz/fixtures/notched-bounds-replay.json
```

The harness can also emit a deterministic replay fixture from the simulated
grid samples:

```sh
node research/picking-fuzz/picking-fuzz-harness.mjs emit-replay
```

`replay/check` validates the row contract and reports classified mismatches. A
known false positive in a fixture is reported as data; the command fails only
when the fixture is malformed or a stored classification does not match the
expected/observed hit ids. The summary includes deterministic
`falsePositiveCount` and `falseNegativeCount` totals so a replay can be compared
across machines without parsing free-form logs.

## Browser driver shape

The automated runner should:

1. Start the examples app with a stable viewport and deterministic device scale.
2. Navigate to each example route once a route/browser adapter exists.
3. Find the target canvas or fuzz stage.
4. Generate a dense sample set in normalized screen space.
5. Dispatch `pointermove`, `pointerdown`, and `pointerup` with browser-native
   mouse or pointer APIs.
6. Read observed state through a future `window.__royalPickingProbe`, Tarstate
   lens rows, or the existing probe table fallback.
7. Sample the canvas pixel under the pointer, plus a small neighborhood.
8. Emit failures where hover/raycast state reports a hit but the visible oracle
   says the pixel neighborhood is empty or belongs to a different target.

The script in this directory keeps the oracle and sampling core dependency-free:

```sh
node research/picking-fuzz/picking-fuzz-harness.mjs --self-test
```

It simulates a bounds-based picker with a visible-mask notch. That models the
helmet class of bug: the pick volume reports a hover in an area where the
rendered shape has no visible coverage.

## Oracles

Use multiple oracles because a single oracle will overfit:

- **Logical hover oracle**: the target id from future renderer interaction
  state, example probe rows, or a renderer picking debug surface.
- **Visible pixel oracle**: `canvas.getImageData()` at the pointer and a small
  radius. A hit on fully transparent background is suspicious.
- **Object color oracle**: optional debug pass where each pickable object renders
  a stable flat id color. This avoids relying only on final shaded color.
- **Depth/stencil oracle**: optional WebGL readback from a debug framebuffer for
  cases where final alpha is not enough.
- **Geometry failure oracle**: existing `geometryStatus` and `geometryFailures`
  rows should make malformed pick meshes fail loudly.

For the helmet issue, the important check is not "helmet-specific". It is:
when the renderer says the helmet is hovered, the visible oracle must find
helmet coverage in the sampled pixel neighborhood.

## Generalizing to all examples

Every example can implement the same fuzz contract:

- `route`: example route from the catalog.
- `target`: CSS selector for the canvas, stage, or primary interactive region.
- `eventPlan`: pointer move grid, jittered edge samples, random walk, drag, and
  click sequences.
- `readback`: `window.__royalPickingProbe` first, Tarstate lens rows second, DOM
  probe table fallback third.
- `oracle`: visible pixel, object-id color, expected layout bounds, or
  example-specific invariant.

Examples without WebGL can still use the same event generation and readback
against DOM/layout probes. WebGL examples should add object-id or alpha/depth
debug readback so the harness is not tied to bounding boxes.

## Benchmark volume

Do not optimize for a tiny fuzz set. A useful default for local checks is:

- 2 viewport sizes: desktop and narrow/mobile;
- 3 device scale factors: `1`, `1.5`, `2`;
- 5 deterministic seeds;
- grid step near 8 to 16 CSS pixels;
- extra samples around canvas edges and previous failure clusters;
- one low-volume smoke mode for PR checks and one high-volume mode for nightly
  or pre-release checks.

The runner should keep failing seeds and sample coordinates in JSON so a single
case can be replayed exactly.

## Future integration points

1. Add a `/labs/picking-fuzz` route or another browser entry point for renderer
   picking fuzz work.
2. Add `window.__royalPickingProbe` to the examples shell or the picking lab.
3. Add a browser dependency such as Playwright only after deciding whether this
   belongs in root tests or in `apps/examples-react`.
4. Convert `picking-fuzz-harness.mjs` into the shared sampler/oracle module used
   by the browser runner.
5. Add a WebGL object-id/coverage debug readback path for glTF examples,
   including `/gltf-helmet`, without changing helmet picking behavior first.

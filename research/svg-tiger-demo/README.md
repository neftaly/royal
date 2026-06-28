# Ghostscript Tiger Demo Route Plan

Date: 2026-06-28

This folder plans the Royal example route for rendering the Ghostscript/Inkscape
tiger through the future SVG-to-path pipeline. It is research-only and does not
modify `apps/examples-react`, renderer packages, public exports, or shared repo
configuration.

## Provenance Position

Use the prior SVG research result:

- The Ghostscript/Inkscape tiger is acceptable inside Royal because this repo is
  `AGPL-3.0-only`, provided attribution and provenance stay with the vendored
  asset.
- It is not ideal as a permissive standalone fixture. Tests or package fixtures
  intended for reuse outside Royal should use local authored SVGs or permissive
  assets instead.
- The full tiger should be added only when the extraction pipeline is ready
  enough to measure it. Keep it under this folder or a future examples asset
  directory with a sidecar provenance note.

Reference asset for the eventual full demo:

- `https://commons.wikimedia.org/wiki/File:Ghostscript_Tiger.svg`
- Commons source notes say it derives from `tiger.eps` from GPL Ghostscript SVN.
- Commons lists the license as GNU AGPL v3 or later.

## Route Sketch

Future route: `/examples/svg-tiger`

Source mapping:

1. `apps/examples-react` route imports a manifest row, not a raw SVG parser.
2. Manifest row points to the vendored tiger SVG and its provenance note.
3. Build/dev asset step runs SVG-to-path extraction and emits a packed path
   payload plus source-map metadata.
4. React example route loads the packed payload through the normal Royal asset
   path.
5. Renderer draws the path payload as filled 2D geometry, with debug toggles for
   source layer/path ids only after the packed format is stable.

Decomplection pressure:

- Keep SVG parsing in the asset pipeline, not the route component.
- Keep provenance with the source asset, not duplicated in renderer code.
- Keep packed path payloads independent from the Ghostscript tiger so smaller
  route fixtures can use the same checks.

## Acceptance Checks

The demo route should not land until these checks exist and pass for the full
asset or the fallback fixture:

| Check | Target |
| --- | --- |
| Command count | Recorded per asset; fail if it unexpectedly changes by more than 5%. |
| Parse time | Less than 50 ms p95 for fallback, less than 250 ms p95 for full tiger on local dev. |
| Packed bytes | Less than 32 KB for fallback, less than 512 KB for full tiger unless reviewed. |
| Render nonblank | Screenshot/canvas oracle reports alpha/color coverage above a low threshold. |
| Render complexity | At least 8 distinct fills/regions for full tiger, at least 4 for fallback. |
| Route source mapping | Manifest maps route id, source SVG, provenance file, packed artifact, and screenshot. |
| Screenshot artifact | CI or local script writes a deterministic artifact for review. |

Run the current research check:

```sh
node research/svg-tiger-demo/check-demo-plan.mjs
```

The check uses `research/pathfinder-svg/svg-path-prototype.mjs` as a temporary
stand-in for the future SVG-to-path extraction API. That keeps the route plan
measurable without editing the active SVG research prototype.

## Fallback Fixture

`fixtures/tiny-tiger.svg` is a locally authored, tiny tiger-like SVG covered by
Royal's AGPL license. It is not derived from Ghostscript or Inkscape. Use it
when the full Ghostscript tiger is too heavy for CI, when parser behavior needs
small deterministic coverage, or while packed path rendering is still unstable.

Fallback route behavior:

- Keep the same route id and source-map shape.
- Swap only the manifest asset row from `ghostscript-tiger` to `tiny-tiger`.
- Keep all acceptance checks active with lower thresholds.

## Next Integration Step

After the SVG-to-path pipeline has a stable packed artifact format, add the full
Ghostscript tiger SVG plus provenance sidecar in this folder, run this check
against it, and then wire `/examples/svg-tiger` in `apps/examples-react` as a
separate patch.

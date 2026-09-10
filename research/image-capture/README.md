# Renderer image capture probe

2026-09-11, Royal `cf6ebcf7` plus the capture/imported-light working-tree changes.

Run the literal repository-root `pnpm dev --host 127.0.0.1 --port 4581 --strictPort`,
then, without editing files while the development page is running:

```sh
node research/image-capture/probe.mjs
node research/image-capture/probe.mjs http://127.0.0.1:4581 ordinary
```

Requires local Chromium and Probability at `~/dev/probability`. The probe serves
unchanged Classic die documents, buffers, textures and onboarding ambient bytes
through CDP request interception. It does not edit the consumer or its assets.
The optional `ordinary` run intercepts the browser's automatic-raster eligibility
module and disables that one predicate. It does not change renderer source or
introduce a supported root option. Authored VT and SVG policy are not evaluated.

The native test captures a glTF containing two directional lights under three
application lights with `importLights: false`, verifies model/transparent pixels
at DPR 1 and 2, then captures the original Classic die through the same root.
The die uses onboarding's transforms, two lights, environment, tone mapping,
alpha and antialiasing. PNGs and reports are retained beside this file. Errors,
failed resource responses and invalid pixel coverage fail the run. If source
edits cause Vite to reload the page during a probe, that run fails and must be
repeated after the module graph settles.

## Observations and limits

Both policies produced 60 × 60 die images with 3,568 nontransparent pixels.
The ordinary-texture image differs at 401 pixels, with a maximum absolute
8-bit channel difference of 89 and a mean absolute channel difference of 0.683.
The pixel hashes differ. Preserved silhouette coverage is not proof of equal
material appearance or sampling quality.

| Final retained quantity | Default automatic VT | Ordinary experiment |
| --- | ---: | ---: |
| Tracked persistent GPU bytes | 30,282,772 | 30,002,624 |
| VT atlas bytes | 278,784 | 0 |
| Automatic decoded/raster bytes | 11,231,232 | 0 |
| VT runtime module requests | 1 | 0 |
| Admitted/resident VT pages | 3/3 | 0/0 |

The last saved single observations were 1,490 ms and 1,294 ms from capture call
to encoded blob. Their preparation spans were 699/621 ms and readback/encoding
spans were 792/673 ms. These are **not a speedup claim**: Chromium uses SwiftShader,
the renderer is warmed by the triangle captures, source/module requests are
local, order is not randomized, and there are no controlled hardware trials.
The operation begins after scene installation; lazy app imports and subsequent
DOM-image decode/presentation are outside its timing window. Do not compare these
times with the earlier cold production onboarding demand-to-image numbers.

The experiment establishes that avoiding VT removes a module and some retained
storage in this case, but changes pixels. It does not justify accepting an opt-out
or a separate static renderer yet. Compare all catalog faces and original assets
on physical A10 Safari before selecting a policy; inspect quality and peak memory
alongside controlled cold/warm timing.

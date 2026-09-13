# Spatial validation of fitted rectangular pages

This complements the solid-color glTF tests with coordinate-coded artwork:
red encodes horizontal position, green vertical position, blue is constant and
alpha is opaque. The production raster-page adapter receives fitted 5017×2508
and 2508×5017 canvases with logical dimensions 8192×4096 and 4096×8192.

Independent normalized-coordinate expectations check seven sample positions per
axis, including interior texels and all gutters. The matrix covers clamp, repeat
and mirrored-repeat independently on both axes; mip 0, mip 3 and the coarsest
mip; first, last and interior pages; and both orientations.

All 18 combinations pass in the headless host browser: 126 generated pages and
6,174 sampled pixel positions, with maximum RGBA channel error 1.0234375 on the
0–255 scale. The allowed error is three levels for filtering and quantization.
Blue and alpha checks also reject missing or incorrectly filled regions.

To check that this is an effective regression detector, an isolated baseline
build substituted `source.height / size.width` for the vertical scale's correct
`source.height / size.height`. The production file was never edited. That build
fails immediately in the landscape clamped case: mip 0, page 0,0, pixel 0,129
has green value 4 instead of the expected 7.9376. The baseline build was restored
afterward.

This validates actual browser canvas page generation and cropping, not the
renderer shader's UV interpolation or a photographic-quality metric. Large
coordinate-coded source arrays belong to the research fixture, not runtime page
scratch. Every generated page is closed, and source canvas dimensions are reset
in `finally`. Research type checking passes. No production changes, dependencies
or budget allowances were introduced.

Reproduce with `source-combinations.html?rectangular-crops=1` and the existing
headless host runner. Artifacts: [harness](rectangular-page-crops.ts),
[results](rectangular-page-crops-results.json). Everything remains uncommitted.

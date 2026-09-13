# First-presentation decode-size audit

The optional `decode-audit=1` mode records successful PNG `createImageBitmap`
output dimensions and promise durations in the first-presentation harness.
Its wrapper forwards arguments unchanged and restores the native function after
each case. It does not retain the bitmap in the report or alter its close method.
Default timing runs do not install the wrapper.

All 16 recorded headless Intel Iris Xe cases pass. Each decodes exactly one PNG
bitmap across first presentation and refinement. Preview cases decode no PNG
before their first visible pixel; plain PNG cases have already decoded it.

| Path | PNG bitmap | Median bitmap call | Median first presentation | Median refinement |
| --- | --- | ---: | ---: | ---: |
| ASTC preview then PNG | 3547×3547 | 237.75 ms | 30.20 ms | 276.65 ms |
| Plain PNG | 4096×4096 | 56.15 ms | 166.45 ms | 36.20 ms |

Medians combine the eight cases per path across both block-size pairings.
The fixed 64 MiB detail storage limit uses `fitOrdinaryTextureStorage`, which
allows for mip storage and selects 3547² here. PNG dimensions are recognized
before decode and supplied as direct `createImageBitmap` resize options. The
ordinary path permits the original 4096² bitmap in this fixture.

The bitmap promise durations include browser decode and requested resizing, but
exclude the preceding Royal transport/decode queue. The larger duration is
consistent with substantial resize cost; this is not an isolated measurement of
the resize operation itself. The result explains why total/refinement timings
must not be interpreted as equal-output decoder comparisons or ASTC overhead.
It does not justify removing the preview path's memory limit.

Review checked the wrapper's object lifetime, native argument forwarding,
per-case restoration, and first-versus-final decode counts. The complete research
TypeScript project passes. No production behavior or budgets changed.

Reproduce with the existing headless runner and
`source-combinations.html?first-presentation=1&decode-audit=1`.
Results: [decode audit](first-presentation-decode-audit.json).
All changes remain uncommitted.

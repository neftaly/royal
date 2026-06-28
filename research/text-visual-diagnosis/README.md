# Text visual diagnosis

The examples browser smoke requires a `chromium` executable on `PATH` and
records objective canvas text measurements without adding DOM or raster overlays
over renderer text. Text Prototype now loads a real font and renders real
outline meshes; these measurements watch that path rather than the no-font
synthetic compatibility path. CI installs Chrome and exposes it through a
`chromium` command before running the smoke.

Run the examples browser smoke with an optional JSON report:

```sh
EXAMPLES_TEXT_QA_REPORT=research/text-visual-diagnosis/text-smoke-report.json pnpm --filter @royal/examples-react test:browser
```

If `research/text-visual-diagnosis/text-smoke-oracle.json` exists, or
`EXAMPLES_TEXT_QA_ORACLE` points at another JSON file, the same measurements
become hard assertions. Until then the smoke prints provisional text-quality
warnings for the Text Prototype route. The checked-in example oracle is
intentionally inactive so baseline updates stay deliberate.

The Text Prototype acceptance string is `AV office 108%.` because it exercises
kerning-sensitive pairs, counters/holes, punctuation, numerals, and lowercase.
The route also reports glyph, outline, and vertex counts from the real-font
layout/mesh path so regressions are visible in both pixels and mesh data.

## Artifact policy

This directory keeps diagnosis docs and example thresholds under version
control. Local PNG captures, machine diagnostics, smoke reports, and active
oracle files are generated artifacts. Leave them untracked and regenerate them
from the smoke or diagnosis scripts when investigating a rendering change.

Commit a generated artifact only when it becomes a deliberate review baseline;
document that baseline in this README at the same time.

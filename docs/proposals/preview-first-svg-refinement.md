# SVG refinement: remaining investigations

Status: targeted performance research, 2026-09-11. Preview consumption,
preview-to-target scheduling, full-atlas queue recovery, cropped-source fidelity
and aligned VT sampling are implemented through 0.0.24. The original proposal's
preview-supported finer-mip work is no longer an open implementation task.

Probability owns preview production and cached bytes. Royal owns source fidelity,
page demand, preparation, admission, publication and cancellation. Keep that
boundary and automatic VT defaults.

## Remaining evidence gates

- Reproduce current startup/refinement hitches on physical A10 Safari before
  choosing another optimization. Separate consumer document/import work from
  renderer preparation, source rasterization, uploads and draw submission.
- Compare worker rasterization or another rasterizer only against a demonstrated
  remaining bottleneck, preserving browser SVG layout, CSS, text and crop pixels.
- Basis/KTX2 preview delivery needs a concrete consumer, supported ingestion,
  quality comparisons and measured transfer/decode benefit before implementation.
- Occluded-stack demand changes need current visibility/correctness evidence;
  do not use them to hide detail or selected descendants.

The 0.0.24 release records an instrumented A10 zoom refinement observation of
1.735 seconds; it is not a controlled benchmark guarantee. The older 16.1/4.1
second runs describe superseded implementations.

See the [historical producer contract and experiments](archive/preview-first-svg-refinement-2026-09-08.md),
[A10 observations](archive/vt-capacity-a10-findings.md), and
[current texture specification](../specs/textures-and-virtual-texturing.md).

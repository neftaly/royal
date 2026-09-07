# Royal proposals and decisions

Reviewed against `main` at `01ef7187` on 2026-09-08. Shipped behaviour belongs in
[the specifications](../specs) and [changelog](../../CHANGELOG.md). Open documents
may contain both implemented work and experiments; their status identifies what
remains. Consumer observations are historical evidence, not a current audit of
Probability.

## Open Royal follow-ups

| Document | Remaining work |
| --- | --- |
| [Preview-first SVG refinement](preview-first-svg-refinement.md) | Use preview-supported finer mips and measure physical-device responsiveness; alternative rasterizers/codecs require evidence. Basic preview consumption and the full-atlas queue fix have landed. |
| [Selection-outline camera performance](selection-outline-camera-performance.md) | Hardware measurements, equivalent descriptor replacement, and GPU submission investigation. Retained source indexing has landed. |
| [Screen-space tolerant picking](screen-space-tolerant-picking.md) | Research semantics, approaches, fixtures, and costs before accepting an API. |

## Completed work and retained decisions

| Document | Disposition |
| --- | --- |
| [Always-on automatic VT](archive/always-on-automatic-virtual-texturing.md) | Implemented in `a1b4961d`, included in 0.0.23. |
| [Bounded-volume colour parity](archive/bounded-volume-composite-color-parity.md) | Fixed in 0.0.19 (`5bb9ab6c`); original 0.0.18 report retained. |
| [BLEND mat occlusion](archive/alpha-blend-mat-occlusion.md) | Separated-bounds fix shipped in 0.0.23 (`fd045a7b`); intersecting geometry retains documented limitations. |
| [Historical scene previews](archive/historical-scene-previews.md) | Keep the consumer's two-root design. No new Royal API; reconsider only with measured renderer costs. |

Archived reports preserve their original investigation and reproduction details.
Their opening status takes precedence over pre-fix descriptions below it.

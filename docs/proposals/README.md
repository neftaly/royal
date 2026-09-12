# Royal proposals and decisions

Reconciled against Royal 0.0.26 and the current working tree on 2026-09-12. Implemented behavior belongs in
[the specifications](../specs) and [changelog](../../CHANGELOG.md). Historical
consumer/device observations are retained as evidence.

## Acceptance

Royal's current consumers are Probability Play and onboarding. A proposal is a
claim to investigate, not an accepted requirement. Before implementing it, check
the current consumer call site and Royal behavior, reproduce the problem, and
compare the smallest plausible fix. Historical timings, hypothetical consumers
and an agent's requested API do not establish a missing renderer capability.
Record browser capabilities with performance evidence. Remove implemented,
superseded or rejected proposal instructions; keep useful measurements in research
and implemented contracts in the specifications.

## Open investigation

[Screen-space tolerant picking](screen-space-tolerant-picking.md) addresses
Play's small-piece touch acquisition. It is not an accepted API: the consumer
must first establish its gesture policy and trial evidence. Exact picking remains
the current contract.

## Closed implementation proposals

| Topic | Decision and retained evidence |
| --- | --- |
| Onboarding capture | Onboarding already calls `captureImage`. No demonstrated need for a separate static backend or VT opt-out; the opt-out experiment changes pixels. Retain [capture research](../../research/image-capture/README.md). |
| Unlimited lights | Play uses `importLights: false`; Royal already has the finite 512-light path. No current consumer demonstrates a need for unbounded or clustered lighting. Retain [many-light experiments](../../research/many-lights/README.md). |
| Automatic texture memory | Allocation and refinement are implemented. Device calibration, ETC2 resizing and prefetch have no new failing consumer workload. Retain [VT research](../../research/virtual-texturing/README.md). |
| SVG refinement | Preview-to-target refinement is implemented. The current import measurements point to large ordinary bitmap uploads, not another SVG renderer or codec. Retain [SVG evidence](../../research/svg-preview/README.md). |
| Selection outlines | Source indexing and camera-copy fixes are implemented. No current comparison establishes another renderer gap. Retain the [historical investigation](archive/selection-outline-camera-performance-2026-09-11.md). |

These decisions do not remove supported capabilities or rule out future fixes.
Reopen a topic with a concrete current consumer failure, rather than carrying
speculative implementation instructions forward.

## Implemented work and retained decisions

The [background-renderer review](../../research/background-renderer-review/README.md)
closed that proposal: retain the existing local fixes, reject unproven shader
expansion and staged image uploads, and require new consumer evidence before a
worker-renderer migration.

| Document | Disposition |
| --- | --- |
| [Imported-light composition](archive/composed-directional-light-budget.md) | `importLights: false` included per glTF mount in 0.0.25; defaults and light limits unchanged. |
| [VT capacity/A10 observations](archive/vt-capacity-a10-findings.md) | Historical intermediate experiments, superseded by 0.0.24. |
| [Original automatic-memory design](archive/automatic-texture-memory-2026-09-08.md) | Shipped allocator rationale and intermediate measurements. |
| [Original preview-first design](archive/preview-first-svg-refinement-2026-09-08.md) | Historical producer contract, implemented scheduling and profiling observations. |
| [Original selection-outline investigation](archive/selection-outline-camera-performance-2026-09-11.md) | Historical full-scan design and software measurements; retained lookup has shipped. |
| [Original onboarding investigation](archive/onboarding-static-preview-profile-2026-09-11.md) | Consumer measurements and rejected encoder experiments; capture API included in 0.0.25. |
| [Always-on automatic VT](archive/always-on-automatic-virtual-texturing.md) | Implemented in 0.0.23; remains the default policy. |
| [Bounded-volume colour parity](archive/bounded-volume-composite-color-parity.md) | Fixed in 0.0.19. |
| [BLEND mat occlusion](archive/alpha-blend-mat-occlusion.md) | Separated-bounds fix shipped in 0.0.23; intersecting geometry retains documented limitations. |
| [Historical scene previews](archive/historical-scene-previews.md) | Retain the consumer's two-root design; no new Royal API without measured costs. |

Archived opening statuses take precedence over their historical implementation
claims. Do not reimplement shipped work from an old experimental section.

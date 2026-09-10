# Royal proposals and decisions

Reconciled for Royal 0.0.25 on 2026-09-11. Implemented behavior belongs in
[the specifications](../specs) and [changelog](../../CHANGELOG.md). Historical
consumer/device observations are retained as evidence.

## Open follow-ups

| Document | Remaining work |
| --- | --- |
| [Onboarding glTF capture](onboarding-static-preview-profile.md) | Linked onboarding now uses `captureImage`; evaluate VT opt-out and readback performance using original assets. The browser-only opt-out experiment changes pixels and is not accepted policy. |
| [Unlimited lights](unlimited-lights.md) | Research scalable exact light composition, including global directional lights and clustered local lights. No architecture or higher limit accepted yet. |
| [Automatic texture memory](automatic-texture-memory.md) | Physical-device default-budget calibration; ETC2 resizing and prefetch only with demonstrated workloads. RGBA allocator/refinement work shipped in 0.0.24. |
| [SVG refinement](preview-first-svg-refinement.md) | Profile remaining current-device hitches; alternative rasterizers/codecs require evidence. Preview-to-target behavior is implemented. |
| [Selection-outline camera performance](selection-outline-camera-performance.md) | Fresh hardware baseline after indexing and camera-copy changes, then evaluate descriptor replacement or GPU costs. |
| [Screen-space tolerant picking](screen-space-tolerant-picking.md) | Consumer device trials, semantics and competing experiments before accepting an API. |

## Implemented work and retained decisions

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

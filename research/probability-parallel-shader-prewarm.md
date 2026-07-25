# Probability shader prewarm

## Decision

Use `KHR_parallel_shader_compile` only to start ordinary surface variants when
their canonical scene first becomes known. Keep drawing and publication
synchronous: the existing `get` path consumes the retained link and preserves
the no-extension behavior.

The rejected alternative deferred entire surface publications until every link
completed. It added a publication frame and regressed Settlers' median final
pixel from 2.986 s to 3.086 s.

## Evidence

The accepted candidate was measured against `2584e300` with separate production
builds, a local no-store Settlers package, fresh headed Chromium processes, and
the Intel Iris Xe renderer. The benchmark waits for the last changed canvas
frame and network quiet, rather than DOM or canvas creation.

| Build | Runs | Median final pixel | Range |
| --- | ---: | ---: | ---: |
| `2584e300` | 5 | 2.214 s | 2.189–2.306 s |
| prewarm candidate | 7 | 2.173 s | 2.115–2.373 s |

Instrumented `LINK_STATUS` time fell from a 283 ms median to 119 ms, a 58%
reduction in synchronous main-thread shader waiting. Final-pixel improvement is
smaller because preparation, decode, upload, and shader work overlap.

## Cost and bounds

- Production delta: 112 lines before formatting/statistical diff accounting.
- Ordinary deployed graph: 265,294 bytes gzip, 344 bytes over the prior budget.
- Bundle budgets move by 500 bytes, leaving the remaining increase visible and
  bounded rather than hiding it in a broad allowance.
- Virtual-texture and transmission variants are excluded because their shader
  source is installed lazily.
- Browsers without `KHR_parallel_shader_compile` keep the previous synchronous
  path and do no speculative work.
- Direct synchronous links retain stage-specific diagnostics. A failed
  speculative link reports the retained program diagnostic when first used.

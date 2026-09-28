# CPU VT pages and bounded registry archive delivery

**Follow-up:** the ZIP experiment described below was subsequently removed after
a controlled HTTP/3 comparison. See [the comparison](http3-archive-comparison.md).
Its measurements remain historical evidence, not a description of retained code.
Subsequent GPU/CPU retention work is documented in [zoom retention](zoom-retention.md).

The five-second **full-detail** target is not met. Current hardware desktop runs
reach interaction readiness in 4.9–5.6 s and full detail in 7.2–7.7 s. The physical
iPad reaches full detail in 26.0 s using the registry release. No texture dimensions,
sampling quality, viewport, game schema, sync endpoint, or GPU budget was reduced.

## Retained changes

Royal now materializes automatic VT pages as CPU `ImageData` during asynchronous
page preparation. The scratch canvas is released immediately, including allocation,
drawing, and readback failures. WebGL receives already materialized pixels rather
than triggering canvas readback during its small upload budget. Pending automatic
pages/uploads can batch up to 16; four active page jobs, the 16 MiB pending-byte cap,
and existing upload time/byte budgets remain intact. Observed pending pixels peak
at 1,115,136 bytes, versus 557,568 with the eight-page queue.

Probability optionally fetches the existing ZIP for small registry releases while
ordinary reads continue. An existing `createComputePool`/`closeComputePool` worker
extracts only declared entries, transfers encoded file buffers back, then retires.
The encoded cache, packed download, and expanded output each have an 8 MiB limit;
there is also a 4096-entry limit. Larger releases and non-registry sources retain
the normal file path. This is an additional bounded CPU cache, not GPU storage.

Every consumed file still passes the existing size/SHA-256 check. Stale cached
bytes are discarded and retried through the normal individually validated file
request. Cancellation clears the cache, aborts transport, and retires an active
worker; late results cannot resurrect ownership. No-worker, extraction-failure,
and missing-archive cases leave ordinary requests available. The normal model
loader remains intact; the experimental lazy model-URL change was reverted.

## Measurements

Desktop: Intel Iris Xe, ANGLE/Vulkan, fresh browser profiles, HTTP cache disabled,
1280×800 at DPR 1. Assets are the site's Nova registry ZIP, not the original P2P
document. These are shared-host observations, not statistically controlled trials.

| Path | Interactive | Full detail | Registry requests | Registry transferred bytes |
| --- | ---: | ---: | ---: | ---: |
| Per-file control, same CPU-page renderer | 5.622 s | 7.585 s | 556 | 5,739,531 |
| ZIP cache, first run | 4.904 s | 7.248 s | 218 | 4,740,079 |
| ZIP cache, final repeat | 5.443 s | 7.648 s | 218 | 4,740,035 |

The reliable desktop result is fewer requests and transferred bytes. Full-detail
time overlaps the control; do not claim a consistent wall-time speedup from this
sample. Stable scene-crop comparisons against control have only 10–11 pixels over
8/255, with mean RGB error below 0.0023/255. The crop excludes dynamic HTML UI.

Physical iPad, same local Nova fixture and 1536×1804 viewport:

| Page path | Full detail |
| --- | ---: |
| Canvas pages, control | 38.062 s |
| CPU pages, eight-page queue | 29.439 / 30.338 s |
| CPU pages, sixteen-page queue | 27.592 / 29.355 s |

Raw JavaScript time in page `texSubImage2D` calls fell from about 498 ms to 9 ms;
page preparation increased from 32 ms to 1220 ms. These are CPU call durations,
not GPU execution times. Moving the work out of upload admission lets batches
progress with fewer complete draws. The local pre/post visual comparison has no
pixels over 8/255. The final registry-backed iPad run reaches ready at 25.998 s,
recovers from forced context loss by 44.272 s total, and passes trusted touch input.
An exact-build Safari repeat reaches ready at 26.465 s and records 214 registry
requests including one ZIP download, confirming archive use rather than only
fallback. Safari reports zero transferSize, so it is not used for byte totals.
The recovery pixel comparison passes the existing threshold (mean RGBA error
below 0.022/255, 0.073% of pixels over 8); it is not bit-identical.

## Review and validation

- Royal: full 1457-test suite and glTF manifest checks; final typecheck, lint,
  renderer build. Cleanup failure cases and real automatic-page runtime mocks
  cover CPU page ownership. Physical recovery also exercises regenerated pages.
- Probability: full 620-test suite, then 13 focused archive/release tests including
  one additional no-worker case; clean final lint/typecheck and production build.
  Tests cover expansion/admission bounds, transferred-byte isolation, closed and
  aborted owners, stale ZIP fallback, and corrupt network response rejection.
- Restarted literal root `pnpm dev` with linked Royal. Registry Nova smoke reaches
  ready at 13.876 s without page errors, failed JavaScript modules, or Vite overlay.
- Repeated adversarial passes checked O(N) archive policy/extraction, O(1) cache
  lookup, bounded memory, worker retirement, cancellation races, integrity, and
  unchanged React publication and network/schema ownership.
- Quest reconnected to ADB, but its browser did not expose a DevTools socket after
  launch/wake attempts; the foreground included Guardian UI. This revision has
  **not** been remeasured on Quest. Earlier Quest results do not validate it.

Experiments with broader image-element AVIF fitting, 32 texture preparations,
CPU compact fallback uploads, an HTTP read queue, and lazy model URLs were reverted:
none established enough consistent full-detail benefit to justify retention.

An early desktop attempt failed because `/tmp` was 99% full while the profiling
harness forced Chromium shared-memory files there. Removing that override restored
normal `/dev/shm` use. Those resource-failure runs are excluded. The harness now
also stops promptly on loading errors and can optionally capture a network log.

Raw artifacts remain in `/tmp/royal-nova-profiles/desktop-registry-*` and
`/tmp/royal-ipad-*.json`. The final CPU profile and interactive flame graph are in
`/tmp/royal-nova-profiles/desktop-registry-final-cpu/`. Main-thread sampled draw
submission is about 614 ms, page drawing about 438 ms, and scene reconciliation
about 153 ms. No remaining single sampled JavaScript function explains the whole
2+ second gap to the requested full-detail target; browser decode/GPU work and
startup sequencing need further measurement before choosing a larger change.

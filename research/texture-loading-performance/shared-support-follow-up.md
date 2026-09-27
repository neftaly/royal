# Shared interaction preparation and loading concurrency

The next physical Quest trace showed that repeated interaction preparation, not
remaining texture detail, held up playability. Nova has 211 model references but
many share Royal's immutable prepared geometry and the same asset-space transforms.
Preparing identical support shapes separately incurred worker copies/round trips,
then React publications, transform updates, demand recalculation and scene redraws.

Probability's scene-local `SupportPreparation` now reuses exact prepared shapes:
geometry identity, batch order, transform counts and every transform value are
part of the key. Borrowed buffers never escape visitor callbacks. A miss makes a
second synchronous traversal to copy into worker-owned buffers; hits make no
geometry copy or worker request. Reuse also shares immutable support indexes and
the shape's existing orientation cache. The LRU holds at most 64 shapes and 16 MiB
of their transferable buffers (JavaScript metadata is not included in that byte
accounting); oversized keys/shapes bypass caching. Close clears the cache. Cheap
hits process in bounded microtask bursts of at most 16 before yielding, coalescing
publications without unbounded synchronous queue draining.

Royal now admits 16 browser texture preparations instead of four. Its existing
64 MiB native-decode admission still applies to full source dimensions, and
oversized/unknown rasters still decode alone. Custom decoders keep the four-job
ceiling. Existing raster/GPU/handoff budgets remain enforced. This gets small
textures through earlier; it does not raise the retained GPU budget.

## Hardware results

All Quest runs use physical Quest 2 Adreno 650, stationary browser mode, the same
Nova fixture and viewport, with browser cache disabled. The CPU-profile run is
reported separately from timing-only runs.

| Quest run | All interaction models | Full detail | Presented frames | Main-thread long tasks |
| --- | ---: | ---: | ---: | ---: |
| Reviewed baseline | 34.495 s | 35.700 s | 447 | 9.416 s |
| 16 preparations alone | 36.616 s | 36.616 s | 462 | 10.054 s |
| 16 + shared support shapes | 10.119 s | 16.983 s | 152 | 4.522 s |
| Repeat | 10.025 s | 15.909 s | 143 | 4.042 s |

The concurrency-only run had all textures resident much earlier, but serial
interaction preparation still dominated the finish. The combined change cuts
full loading by roughly 52–55% and interaction readiness by about 71% in these
runs. A separate instrumented profile confirms only **eight** support worker jobs.
Compared with the earlier Quest profile, sampled `uniformMatrix4fv` self time falls
from 4.219 s to 1.352 s and `uniform4fv` from 1.465 s to 0.462 s. These sampled
costs are not additive estimates of further recoverable time. The new CPU profile
and interactive flame graph are in
`/tmp/royal-nova-profiles/quest-shared-support-cpu/`.

A first experiment that routed VT callbacks through the existing presentation
cadence reduced some draw work but did not materially improve load time and delayed
upload progression. It was removed; no delayed-VT callback path is retained.

The available physical iPad (iPad7,6 / iPadOS 17.7.11) loaded in 44.623 s. Another
run reached ready in 51.061 s and then passed deliberately forced context loss,
full recovery and trusted touch at 94.426 s total. There were no spontaneous
interruptions. These results are within the previous iPad range: no additional
full-load speedup is claimed there. Its remaining tail includes high-resolution
VT upload/presentation work. No viewport, texture resolution, occlusion threshold,
or sampling-quality reduction was used.

## Review and validation

- 1,453 Royal tests plus the 64-case glTF manifest check; 613 Play tests pass.
- Royal and Play lint/typechecks and renderer/production builds pass.
- Root Probability `pnpm dev` was restarted after the linked-package build. The
  final Nova smoke reaches ready at 15.115 s with no page/module/Vite error.
- Physical Quest trusted pointer selection and iPad trusted touch both pass.
- Quest's game crop (x=200..1135, y=0..648, excluding the randomized player-name UI)
  has maximum mean channel error 0.000421/255, with zero pixels over eight.
- iPad before/after optimization comparison passes the existing strict tolerance
  (maximum mean 0.01325/255; 0.0332% pixels over eight). Forced recovery also passes
  with maximum mean 0.000171/255 and zero pixels over eight.
- Adversarial tests cover transform separation, different geometry identities,
  borrowed-buffer lifetime, cancellation, close/reopen and LRU eviction. The final
  read-through checked cache ownership, no transfers of cached/live geometry,
  bounded key work and microtask bursts, and native byte admission at 16 slots.
  No additional actionable finding remains in these changes.

[Compact measurements](shared-support-summary.json) preserve timings, counters,
interaction outcomes and visual comparisons. The earlier baseline commits are
Royal `96e3a4c8` and Probability `86e666a`. No Nova source assets were changed.

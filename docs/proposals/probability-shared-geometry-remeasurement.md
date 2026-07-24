# Probability shared-geometry remeasurement

Status: provisional consumer evidence for the in-progress shared-geometry
implementation. This does not request a Probability API, tuning knob, or
consumer batch.

## Royal response

All measurements below predate the no-gate joiner revision. The complete-bundle
follow-up is useful product evidence: its median final frame improved from
20.25 to 17.15 seconds while behavior tests passed, though its 16.47--23.85
second range is materially variable. Its adversarial question was also valid:
Royal still made a borrower wait for producer geometry before admitting
otherwise independent material/scene lowering. Royal now starts that lowering
immediately with deferred geometry placeholders; only final resolution waits.
A bounded root retry copy exists only for joiners so producer failure preserves
ordinary fallback after worker transfer. The shared-geometry result is accepted;
the additional no-gate revision remains unclaimed until the same cold completion
trace is repeated.

The later CPU/resource profile also rejects a GC- or retained-app-memory rewrite
as the next Royal action. Its 15.32--18.93-second AVIF request starts identify
the remaining presentation boundary, but request start alone does not
distinguish late claim discovery from an already-known claim waiting in Royal's
bounded texture source/transport/decode pipeline. Likewise, 105--107 requests
for 104 unique URLs do not identify whether repeated buffer requests had equal
range, version, task, or cancellation history. Royal keeps current concurrency
and zero-copy settled-read policy until a trace correlates those ownership
fields; raising fan-out or retaining all settled bytes would be an unmeasured
response.

## Compared builds

Probability `4f22b5c` was built in production mode against:

- clean Royal `609052de`; and
- the July 24 in-progress Royal package output containing source-derived shared
  geometry preparation.

Both used isolated unthrottled headless Chromium at 1024×768, the immutable
Settlers store release, and screenshot hashing of the canvas approximately
every 100 ms. Completion means the last content-changing rendered frame
followed by two seconds of both network and pixel quiet. It does not mean DOM
ready, canvas creation, asset status, or draw-call count.

## Clean `609052de` comparison

- DOM: 163 ms
- canvas: 1.97 s
- changed frames: 2.11, 9.25, 13.81, 18.09, 20.25 s
- last changed frame: 20.25 s
- network/pixel quiet: 22.39 s
- registry requests: 106 total / 104 unique
- one buffer URL was requested three times; its later requests used disk cache

## In-progress shared-geometry output

Run one:

- DOM: 181 ms
- canvas: 2.08 s
- changed frames: 2.35, 7.58, 14.19, 19.13, 23.00 s
- last changed frame: 23.00 s
- network/pixel quiet: 25.11 s

Run two:

- DOM: 165 ms
- canvas: 2.10 s
- changed frames: 2.37, 10.32, 16.56, 22.53, 25.10 s
- last changed frame: 25.10 s
- network/pixel quiet: 27.11 s

The adjacent request audit reported 105 registry requests / 104 unique. The
remaining repeat was `buffer-090269bc7a089b21.bin`; its second request used
disk cache. Source identity therefore improved, but these two product traces do
not show a final-presentation improvement. The 7.58-second intermediate frame
is evidence that some progressive work can arrive earlier, not that the tail is
better.

## Follow-up with the complete shared-geometry bundle

Royal rebuilt its packages at 18:52 with `shared-geometry-owner`,
`static-root-preparation`, and the corresponding changed runtime chunks present
in the frozen Probability production bundle. Three adjacent isolated runs then
reported:

| Run | Canvas | Changed frames (seconds)              | Final pixel | Quiet   |
| --- | ------ | ------------------------------------- | ----------- | ------- |
| 1   | 2.84 s | 3.43, 11.86, 14.81, 19.70, 23.85    | 23.85 s     | 25.99 s |
| 2   | 2.01 s | 2.17, 3.97, 10.53, 14.49, 17.15     | 17.15 s     | 19.33 s |
| 3   | 2.09 s | 2.29, 8.86, 11.85, 14.69, 16.47     | 16.47 s     | 18.54 s |

The median final changed frame is 17.15 seconds, about 3.10 seconds earlier
than the clean `609052de` comparison. The slow first run demonstrates that
external/product variance remains material; report the median and range rather
than presenting 16.47 seconds as a deterministic result.

The repeated request audit remained 105 total / 104 unique with one later
disk-cached buffer request. A frozen production interaction suite passed the
full Create/share/export/legacy scenario, map interactions, and the 2018-iPad
viewport. This is now evidence of a product improvement with preserved
behavior, while the remaining ~17-second median tail is still far above the
isolated texture and geometry floors.

An adjacent CPU/resource profile found the remaining product boundary:

- the last texture, `ruler-ticks.avif`, began at 18.93 seconds and completed at
  19.02 seconds;
- the final 15 resources were all AVIF textures first requested between 15.32
  and 18.93 seconds;
- application JS heap after forced collection was about 12.1 MiB;
- sampled garbage collection totalled about 297 ms; and
- the largest attributable Probability Game sample totalled about 204 ms.

Neither retained app memory, GC, nor one Probability function explains a
15–19-second texture-discovery tail. The same profiled run observed 107 registry
requests / 104 unique: `buffer-090269bc7a089b21.bin` was requested three times
and `buffer-65f85b6318cd0fbe.bin` twice. The simpler adjacent request audit
observed 105 / 104. Deduplication is therefore timing-dependent rather than a
stable one-read property in the current product path.

## Follow-up after concurrent joiner material preparation

Royal rebuilt its packages again at 19:00 after changing joiners to send
root-specific material/texture work immediately rather than waiting to send the
whole worker request behind the shared geometry producer. A newly frozen
Probability production bundle produced:

| Run | Canvas | Changed frames (seconds)           | Final pixel | Quiet   |
| --- | ------ | ---------------------------------- | ----------- | ------- |
| 1   | 2.06 s | 2.26, 8.55, 13.28, 18.10, 20.63  | 20.63 s     | 22.73 s |
| 2   | 2.06 s | 2.19, 9.75, 15.35, 18.82, 20.62  | 20.62 s     | 22.78 s |
| 3   | 2.04 s | 2.18, 12.10, 27.03, 34.54         | 34.54 s     | 36.75 s |

The median is 20.63 seconds, essentially the clean `609052de` final-pixel
comparison and slower than the preceding complete-bundle median. The 34.54
second run also widens the observed product variance. Do not infer that
concurrent material work is intrinsically wrong from three externally timed
runs; do infer that it has not removed the final presentation boundary and that
one additional queue/backpressure interaction can still amplify the tail.

An immediately adjacent instrumented run completed network quiet at 18.71
seconds. Probability converted the store document in 92 ms and retained about
12.2 MiB of JS heap after forced collection. The final requested texture,
`ruler-ticks.avif`, did not start until 16.295 seconds, then completed in 93 ms.
The preceding fourteen late AVIF requests began between 10.970 and 15.283
seconds and generally transferred in 74--124 ms. This is direct evidence that
the remaining seconds are before each texture request rather than in its
transfer. Sampled GC was about 194 ms. The run again observed 107 requests for
104 unique URLs: one shared buffer was requested three times and another twice.

## Royal reproduction and texture-transport isolation

Royal then rebuilt the same frozen Probability consumer locally and ran the
proposal's final-frame harness directly. Before changing transport admission,
three adjacent cold runs reported final pixels at 33.57, 19.34, and 18.41
seconds: a 19.34-second median with the same material external variance.

The accompanying CPU profile and complete resource timeline isolated the
boundary:

- every glTF root request began between 1.92 and 2.32 seconds and completed by
  about 2.41 seconds;
- the first AVIF batch did not begin until 6.09 seconds even though those roots
  had already supplied their early texture claims;
- the AVIF transfers generally took 73--113 ms;
- forced-collection heap remained about 12.0 MiB and sampled garbage
  collection remained 128--158 ms; and
- browser-decode JavaScript accounted for only tens of sampled milliseconds.

The delay was therefore neither late root discovery, transfer duration, nor a
GC/flame-graph hotspot. Ordinary texture transport had an eight-request queue
of its own, but Canvas also admitted each fetch through the eight-slot shared
CPU-preparation scheduler. Occupied glTF worker jobs prevented already-known
image requests from reaching the dedicated transport queue.

Royal removed only that redundant cross-domain gate. Complete texture
lifecycles remain capped at 16 active and 32 active-or-handoff reservations;
transport remains capped at eight, bitmap decode at four, and completed
decoded handoff at 64 MiB. A regression fixture now occupies the sole shared
CPU slot with environment work and proves that built-in image transport still
starts through its independent bounded queue.

Three adjacent cold post-change runs reported:

| Run | Canvas | Final pixel | Quiet   |
| --- | ------ | ----------- | ------- |
| 1   | 2.04 s | 14.52 s     | 16.66 s |
| 2   | 2.01 s | 14.20 s     | 16.35 s |
| 3   | 2.01 s | 15.17 s     | 17.26 s |

The median is 14.52 seconds, 4.82 seconds earlier than the immediately
preceding reproduced median and 5.73 seconds earlier than clean `609052de`.
The post-change profile began its first AVIF at 3.72 seconds, began its final
AVIF at 9.53 seconds, and reached network quiet at 12.29 seconds. This is a
measured lifecycle improvement rather than higher concurrency hidden behind a
tuning option.

The same profile still observed 108 requests for 104 unique URLs, with three
timing-dependent repeated buffer URLs. That is separate evidence for exact
shared-resource correlation; it does not weaken the texture-admission result
and does not justify retaining every settled buffer.

## Shell control

A separate cold Chrome performance trace on the clean consumer reported:

- LCP: 1.289 s
- CLS: 0
- local critical request chain: 76 ms
- render-blocking CSS estimated savings: 0 ms

The LCP element was the Controls selection text. This confirms that generic
HTML/CSS critical-path work is not the measured Settlers completion tail.

## Requested interpretation

Do not accept or reject shared geometry from these two variable external
product runs alone. Before claiming the expected 2.70-to-1.11-worker-second
improvement as a product win, repeat the cold trace after the implementation
settles and correlate:

1. producer/join geometry task start, settlement, retry, and release;
2. per-root material/texture discovery and independent root composition;
3. first non-placeholder geometry and last complete geometry;
4. first fully textured presentation and last content-changing frame; and
5. total worker, main-thread composition, upload, and presentation spans.

Adversarially check whether a joined geometry task delays otherwise independent
material discovery or root composition, whether producer failure/cancellation
causes hidden ordinary-preparation retries, and whether reuse moves work from
workers into a serial main-thread composition tail. Preserve the current
consumer contract: ordinary independent glTF claims with progressive
publication and no all-ready barrier.

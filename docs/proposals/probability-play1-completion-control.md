# Probability Play 1 completion control

Status: consumer evidence against treating the current Settlers result as near
the practical lower bound. This is a renderer scheduling requirement, not a
request for a Probability option or an app-side preloader.

## Control

The same isolated unthrottled Chromium harness loaded the same immutable
Settlers release at 1024×768 and hashed the canvas about every 100 ms. Completion
is the last content-changing canvas frame followed by two seconds of pixel and
registry-network quiet.

Deployed Play 1 (`https://prob.nz/play`, React Three Fiber/Three):

| Run | Canvas | Final pixel | Quiet |
| --- | ---: | ---: | ---: |
| 1 | 3.75 s | 14.12 s | 16.29 s |
| 2 | 2.30 s | 13.58 s | 15.79 s |
| 3 | 2.44 s | 10.75 s | 12.75 s |

Median final pixel: **13.58 seconds**.

Current Probability `4f22b5c` rebuilt against Royal `2500e3ae`:

| Run | Canvas | Final pixel | Quiet |
| --- | ---: | ---: | ---: |
| 1 | 2.01 s | 17.52 s | 19.63 s |
| 2 | 1.94 s | 16.34 s | 18.40 s |
| 3 | 2.00 s | 19.07 s | 21.14 s |

Median final pixel: **17.52 seconds**. Current Play paints a useful placeholder
and partial scene earlier, but completes 3.94 seconds (29%) later than the
prototype control. The prior 20.25-second clean Royal baseline and the
improvement to 17.52 seconds are therefore not evidence of approaching the
practical minimum.

## Paired resource evidence

An adjacent instrumented Play 1 run:

- requested all late AVIFs by about 2.56 seconds;
- completed those observed requests by about 2.83 seconds;
- made 177 registry requests for 104 unique URLs, including 18 requests for one
  shared card face and 10 for another;
- retained about 20.9 MiB JS heap after forced collection; and
- converted the store document in 235 ms.

An adjacent current-Play run:

- converted the document in 68 ms;
- made 106 registry requests for 104 unique URLs;
- retained about 12.2 MiB JS heap after forced collection;
- did not start its final AVIF batch until 11.40 seconds; and
- transferred that batch in about 79--87 ms.

Probability already submits its sorted complete direct-model claim set to one
Royal Canvas. App conversion, main-thread work, GC, and texture transfer duration
do not explain the completion gap. Royal is substantially lighter and correctly
deduplicates source identity, but its texture lifecycle prevents encoded
transport from running as far ahead as the browser-controlled prototype.

The current documented limits are 16 active complete source preparations, 32
active-or-handoff source reservations, eight transports, four bitmap decodes,
and 64 MiB decoded handoff. Removing the glTF CPU-scheduler gate was correct,
but transport is still admitted from inside a complete preparation reservation.
With 104 unique sources, downstream decode/handoff progress therefore governs
when later network requests may begin.

## Requested renderer property

Known external texture transport should run ahead of bitmap decode and GPU
handoff up to a separately justified encoded-source bound. Decode, decoded
handoff, and upload limits must continue to protect A10/Safari-class devices.
Do not expose a consumer concurrency knob and do not ask Probability to preload
renderer-owned URLs.

Possible implementations include a separately byte-bounded encoded-blob stage
or a browser-cache warming stage which owns no decoded representation. The
choice belongs to Royal. The important property is that four slow decoders or
progressive upload admission cannot leave already-known small external image
requests undispatched for another nine seconds.

Adversarially preserve:

- cancellation before and during transport;
- exact version/source identity and one consumer-visible fetch;
- bounded retained encoded and decoded bytes;
- no all-textures-ready presentation gate;
- early first geometry and first texture;
- Safari behavior without assuming Chromium cache coalescing; and
- prompt release of encoded bytes after decode ownership transfers.

## Acceptance

On the same Probability production consumer and immutable release:

1. three cold final-pixel runs must beat the Play 1 median rather than only the
   old Royal baseline;
2. the final external image request should start near the root/early-claim
   phase, not after ten seconds of decode progress;
3. first useful canvas and progressive publication must not regress;
4. unique transport, retained heap, cancellation, and failure behavior must
   remain bounded and observable; and
5. Probability must require no new API, preload list, batch, or scheduling
   protocol.

## Branch result and remaining bound

The isolated `codex/probability-texture-read-ahead` implementation dispatches
known encoded texture transport independently of bitmap decode, preserves live
CPU preparation across WebGL context restoration, and exposes encoded
transport/staging pressure independently of decoded handoff. AVIF retains
`createImageBitmap` as its primary browser path; direct image-element upload is
the compatibility fallback because the proposed unconditional shortcut was not
reachable through a normally budgeted Canvas and lacked cross-browser evidence.
The implementation also raises complete texture preparation admission from 16
to 32 while retaining the 64-source and 64 MiB decoded-handoff authorities. A
controlled 16-to-32 comparison improved median final pixels from
10.91 to 9.96 seconds (0.95 seconds, 8.7%). Raising admission again to 48 produced
no meaningful improvement (9.92 seconds) and was rejected because it increased
peak decoded-memory risk.

The final rebuilt three-run system-Chromium series measured 7.09, 7.74, and
7.48 seconds: a **7.48-second median**. An adjacent three-run deployed Play 1
control measured 8.00, 8.67, and 9.27 seconds: an **8.67-second median**. This
branch was 1.19 seconds (13.7%) faster in that paired control, but broader
current-Play samples ranged from about 7.01 to 10.07 seconds. Several samples
lose and restore the live antialiased WebGL canvas during Chromium's
software-renderer fallback, adding roughly 1.0--1.3 seconds; Play 1 did not do
so in the matched control. This is useful lab-noise evidence, not a
production-hardware renderer result. The branch improves scheduling and beats
the adjacent prototype control, but does not satisfy the one-quarter-Play-1
target.

The retained stage evidence is:

- the canvas and useful placeholder exist at about 1.8--2.2 seconds;
- all 46 glTF requests start by about 1.65 seconds and all 45 AVIF requests
  start by about 2.20 seconds, so late request discovery is no longer the wall;
- browser AVIF decode is parallel and accounts for about 0.55 seconds of
  aggregate traced decode work, although completions arrive in waves;
- those decoded sources represent about 98.6 MiB of RGBA upload authority;
- synchronous WebGL upload calls total about 293 ms, while software-GPU upload,
  mip generation, and completion become visible over several later seconds;
  and
- final-pixel completion is therefore controlled by initial texture residency,
  not document conversion, glTF transport, request dispatch, React, or GC.

A bounded 128--512 KiB first representation reduced an experimental final frame
to 5.6 seconds, but AVIF decoding still consumed the full authored image and
camera-driven promotion decoded sources again. That experiment was removed:
lower resolution without a lossless promotion authority is not a renderer
optimization.

For this immutable release, a 3.4-second exact-final-pixel result leaves only
about 0.2--0.6 seconds after the last decoded handoff to establish the complete
98.6 MiB ordinary-texture working set. The current browser AVIF/glTF contract
does not expose mip-addressable or region-addressable source data, so queue
tuning cannot make that obligation smaller.

The next legitimate control does not require removing AVIF or inventing another
runtime protocol. Royal already implements `GS_texture_etc2`, whose optional
form permits one glTF texture to contain a preferred directly uploadable ETC2
KTX2 mip pyramid, an `EXT_texture_avif` alternate, and a core fallback. Royal
deterministically selects ETC2 when the WebGL capability is present and AVIF
otherwise; only the selected source is fetched. Re-authoring this immutable
Settlers release with that existing contract is the shortest honest experiment
for the 3.4-second target because it removes browser decode, RGBA expansion, and
runtime mip generation while retaining AVIF support.

Authored virtual-texture pages or a separately specified multi-resolution AVIF
contract remain alternatives when initial projected detail, rather than the
complete texture, should become resident. Either is a data/API decision; it
must not be hidden behind a blurry fixed cap, deferred “final” definition, or
Probability-only preload protocol.

## Integration review

The integration keeps render-ready non-visual claims scene-independent:
geometry, metadata, and selected material images prepare through their ordinary
owners even before the first scene, while no WebGL object, picking record,
light, presentation frame, or detached cache is created. Texture completion
only schedules presentation when the current canonical scene actually claims
that decoded identity.

An adjacent physical Safari 17.14 Sponza control compared the retained 32 MiB
texture/VT upload allowance with the previous 4 MiB allowance. The 32 MiB run
reached first usable at 7.403 seconds and terminal images at 9.289 seconds; the
4 MiB run reached those points at 7.864 and 9.472 seconds. Camera-drag callback
p95 was 21 ms versus 23 ms, with no failures, fallback, denial, or context
interruption in either run. Network timing differed by roughly 0.5 seconds, so
the small completion delta is not attributed entirely to upload policy. The
useful result is that the larger progressive allowance did not introduce the
feared Safari hitch.

The exact integration bundle measures 121,268 gzip bytes for the ordinary
Royal initial graph, 143,673 bytes of lazy chunks, 56,607 bytes of worker
assets, and 264,941 bytes of deployed Royal JavaScript. The staged transport
diagnostic and scene-independent lifecycle add only tens of synchronous gzip
bytes and do not increase the lazy or worker ceilings.

# Proposal: make many-root progressive loading byte- and work-bound

Status: root-transport and zero-upload admission slices accepted and
implemented; shared CPU geometry preparation and the texture tail remain open.

## Workload

Probability's Settlers board has 719 eventual draw calls from 46 distinct glTF
roots. The roots total about 286 KiB of JSON, reference 11 external geometry
buffers, and reference 45 unique images. The images total about 163 KiB encoded
and about 98.6 MiB as base-level RGBA, or about 126 MiB resident with mipmaps.

This is intentionally a renderer stress case: many independently meaningful
board-game objects reuse geometry but differ in material and texture.

## Observation 1: root transport occupies preparation slots

`GltfAssetOwner` currently routes the complete root read plus canonical
preparation through the root's eight-job asynchronous preparation owner. In a
warm browser experiment, fetching and parsing all 46 small roots together took
about 70 ms. In the ordinary pipeline the last root did not become drawable
until 7.86 seconds because later root reads were not started until earlier
preparation jobs settled.

An experiment which began root transport at claim time and admitted only the
subsequent preparation through the existing scheduler reduced the last
drawable root from 7.86 to 6.12 seconds and reduced the largest observed root
read span from about 1.58 seconds to 180 ms. The experiment was reverted; this
repository should receive implementation only from the Royal agent.

The naive experiment is not itself the requested design. Starting every
unknown-size read without a retained-byte bound can make peak CPU memory scale
with all claims. Royal should separate transport progress from CPU preparation
without replacing one arbitrary count ceiling with unbounded staged bytes.

Desired property: transport, staged source bytes, worker preparation, decoded
handoff, and GPU upload have distinct ownership and measurable byte/work
budgets. Waiting on transport should not consume a CPU-preparation slot.

## Observation 2: a fixed surface count serializes zero-byte reuse

Surface admission currently advances by 16 surfaces even when later surfaces
reuse already resident geometry and require zero geometry upload bytes. The
Settlers trace advanced visible draw counts in 16-surface steps. With 719
surfaces, this creates about 45 admission transactions independent of actual
upload size.

An experiment removed that second count throttle while retaining the exact
per-frame geometry upload byte budget and persistent GPU byte budget. In the
adjacent cold software-WebGL traces, the first full 719-draw frame moved from
18.85 to 11.54 seconds. After also separating root transport, a warm run reached
the full draw set at 5.70 seconds. The experiment and its tests were reverted.

Desired property: exact upload bytes and retained GPU bytes govern geometry
admission. Once geometry is resident, every zero-upload surface which references
it may become drawable in the same transaction.

## Observation 3: image transport/decode is not near its isolated floor

The browser fetched all 45 cached images together in about 53 ms and decoded
all 45 ordinary AVIF blobs together in about 87 ms. The ordinary Royal pipeline
continued discovering image requests and completing texture preparation for
many seconds. The decoded set is large enough that upload and retained-memory
budgets are legitimate; encoded transport and browser format decode alone do
not explain the tail.

Raising the browser decode queue from four to eight in isolation did not improve
end-to-end completion and was rejected. This suggests the next trace should
attribute time across late material discovery, resize/alpha work, decoded
handoff backpressure, GPU upload, and presentation instead of changing another
count.

## Requested diagnostics

Royal's root snapshot already exposes queue pressure, decoded handoff, upload,
and residency. For a cold many-root trace, please retain or report:

- claim, root-read start/end, preparation-queue admission, first drawable, and
  image-complete time for each root;
- unique versus repeated root, buffer, image, and canonical geometry identities;
- source, canonical geometry, decoded handoff, alpha, and resident GPU bytes;
- actual worker tasks, total worker-seconds, and peak concurrent work by stage;
- geometry and texture bytes admitted per submitted frame; and
- first draw, first non-placeholder geometry, first complete draw set, and first
  fully textured presentation.

## Acceptance evidence

1. A many-root fixture proves root transport can overlap preparation without
   unbounded staged source bytes.
2. A scene with hundreds of surfaces over one resident geometry admits all
   zero-upload surfaces without a fixed-count tail.
3. One oversize source or upload still makes forward progress.
4. Cancellation releases queued work and retained bytes at every stage.
5. A one-root scene does not regress startup, copies, or peak memory.
6. The Probability Settlers trace improves first geometry and complete geometry
   causally; texture changes separately improve fully textured presentation.

## Implemented decision and measured result

Royal now begins glTF root transport under a dedicated staging owner rather
than occupying the CPU-preparation scheduler. It permits 16 active reads and 64
active-or-staged source reservations, pauses new reads at 32 MiB of completed
root bytes, and releases one idempotent lease when foreground preparation
actually begins. Active cancellation continues to occupy transport capacity
until the underlying read settles. The one-root handoff remains zero-copy.

Geometry publication no longer has an independent 16-surface cursor. The
existing exact per-frame geometry/instance upload byte owner processes the
complete surface suffix and stops at the first non-admitted transfer. A focused
719-surface fixture over one geometry publishes every surface with one 54-byte
upload transaction; distinct geometry remains byte-bounded and one oversize
primitive still progresses.

Current production Probability trace
`/tmp/probability-many-root-after.json.gz` records all 46 glTF root requests
starting within 294 ms and exactly eight preparation-worker starts. The earlier
post-worker-reuse trace recorded only 23 roots within its five-second window,
spread across 2.726 seconds. A separate draw-call probe reached 719 submitted
draws at 5.945 seconds, close to the proposal experiment's 5.70 seconds despite
instrumentation; draw count alone is not claimed as proof that every placeholder
or texture had resolved.

The long trace `/tmp/probability-many-root-long-after.json.gz` shows the
remaining boundary clearly: the 45 image requests were still discovered over
24.878 seconds. Raising decode concurrency remains rejected. This tail follows
canonical root preparation/material discovery and requires the shared-geometry
protocol or a separately measured texture-phase change, not more transport
fan-out.

## Adversarial review

- Do not expose application tuning knobs merely to make this one board fast.
- Do not raise concurrency to conceal duplicate geometry preparation; see
  `probability-shared-gltf-geometry-preparation.md`.
- Do not begin unbounded root reads or retain every source indefinitely.
- Do not equate DOM readiness, asset status, or request completion with the last
  content-changing rendered frame.
- Do not throttle zero-byte reuse for the sake of upload safety; the exact byte
  budget already owns upload safety.
- Do not report a decode-queue microbenchmark as a product win without an
  end-to-end rendered-frame improvement.

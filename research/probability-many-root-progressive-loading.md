# Proposal: make many-root progressive loading byte- and work-bound

Status: proposed from measured Probability Settlers traces.

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

# Initial VT preparation and publication

The candidate batches up to two warm-source page jobs per resource within the
existing global page and byte limits. The detail lane still executes serially.
Raster rendering yields between pages after a 2 ms accumulated CPU slice; one
canvas operation cannot be interrupted.

Initial pageable image decodes receive a camera-size hint, preserving the 256px
seed floor and the 16 MiB per-source cap. Extra seed allocations share a 32 MiB
reservation across in-flight decodes and unconsumed handoffs. A pure planner projects each instance
separately and takes the largest use of a shared image. Its result is cached
across texture publication and invalidated for camera, viewport, and geometry
changes. Exact VT demand remains authoritative; the hint does not reduce final
detail or alter source formats, networking, or schemas.

Ordinary previews remain visible while VT shaders warm and the first admitted
detail set loads. Once published, VT continues refining normally across zooms.
Context loss resets publication. Review found that a budget-limited atlas could
leave the preview gate closed indefinitely: a failing 1 MiB regression test now
passes by allowing publication of fully resident admitted demand when the pool
cannot grow further. Missing ordinary previews still use available VT coverage.

## Measurement integrity

Probability production builds require `ROYAL_BENCH_PATH`, whereas root development
uses `ROYAL_DEV_PATH`. Early production comparisons used the wrong override and
therefore tested the installed renderer in both arms. Those results are invalid
and excluded. Verified production bundles contain `automaticDetailReady` only in
the candidate; the baseline is an isolated build of commit `1d96c62a`.

Desktop registry runs varied substantially: baseline 19.25/13.14 s, candidate
42.33/15.45 s, and a separate candidate CPU profile 12.60 s. Later local full-size
fixture profiles reached 33.31 s baseline and 29.62 s candidate. Other browser
tests and substantial CPU activity were observed on the shared desktop host.
These runs do not establish an end-to-end improvement or reliably isolate the
camera-hint contribution. An ablation without camera hints was also collected;
it is diagnostic, not a clean performance conclusion. Desktop rendering used
Intel Iris Xe through ANGLE/Vulkan, not SwiftShader.

Physical Quest 2 (Adreno 650) reached interaction at 10.36 s baseline and 9.32 s
candidate, but full readiness at 17.88 s and 19.76 s. Repeated zoom preserved most
pages without failures; the second zoom-in made no new requests, while the second
zoom-out added eight requests and one uploaded page. A final candidate run also
passes after the low-memory gate fix. This is not evidence of a five-second load.

Physical iPad reached initial readiness at 26.99 s baseline and 26.52 s candidate.
The candidate recovered from forced context loss by 46.31 s from navigation,
selected a model using trusted touch input, and completed synthetic wheel zoom
cycles without page errors. After the first cycle, 475 pages remained resident;
the second cycle needed no additional uploads. Screenshot inspection showed the
board, cards, and controls present. This does not establish pixel-identical
quality for every possible camera position.

Portable device snapshots and timing observations are in
`initial-vt-publication-summary.json`. Raw CPU profiles and generated flame graphs
are under `/tmp/royal-nova-profiles/verified-three-after-cpu` and
`/tmp/royal-nova-profiles/isolated-{before,after}`. The five-second goal remains unmet;
the useful demonstrated changes are bounded page batching, camera seed planning,
and removal of the intermediate VT publication step, with physical-device
functional coverage. No larger memory pool or quality downgrade was introduced.

Validation: 1,482 tests in 169 files, the 64-case glTF manifest check, typecheck,
lint, and renderer build pass. The final root `pnpm dev` route completed loading
without page errors, failed modules, a Vite overlay, or development-server errors.
The restricted test attempt could not bind sockets; the complete rerun with
loopback access passed. Final Quest interaction/full-readiness times were
9.37/19.77 s. Source and tests are uncommitted.

## Follow-up adversarial review

Pass one reproduced oversized decode hints for completely offscreen bounds on
each clip axis. The planner now rejects bounds whose corners all lie outside
the same homogeneous clip plane, while retaining the original seed floor.
The hint cache also no longer retains an entire old scene: it keeps only the
camera and texture-index identities needed for invalidation, and clears on disposal.

Pass two found that a per-source 16 MiB cap did not limit the aggregate cost of
32 simultaneous enlarged seeds. Extra bytes above the existing seed floor now
share a 32 MiB reservation. Tests cover saturation, handoff retention, upload,
cancellation, and decode failure; final VT demand and quality remain unchanged.

Pass three rechecked invalidation, clipping, shared-image hints, reservation
ownership, publication under pressure, and page scheduling. No further actionable
issue was found. The physical-device measurements above precede these follow-up
fixes; they are not fresh performance measurements of the reviewed version.

Follow-up validation passes: 1,488 tests across 169 files, the 64-case glTF
manifest, typecheck, lint, and build. The rebuilt root-dev Nova route loaded all
325 images and 207 VT pages without page, module, overlay, or server errors.
The run is a functional smoke test, not an isolated timing comparison.

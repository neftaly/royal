# Release empty VT storage after native authority failure

Date: 2026-09-13. Changes remain uncommitted.

## Problem and fix

A valid ASTC preview survives a failed full-raster source and avoids repeated reads,
but the runtime continued collecting detail demand and allocating/resizing an empty
RGBA atlas. The first failure probe observed 557,568 atlas bytes. A saved-baseline
reproduction retained 627,264 bytes, including migration storage, with zero resident
pages and a correctly rendered red preview. Exact empty storage varies with frame
and migration timing; the unnecessary retention is the issue.

Failed native-backed detail now enters the existing VT error state, clears its
demand, and stops contributing to pool budget requests. Frame preparation releases
its unused GPU resource through the existing reference-counted release path and
reports the WebGL state change. The ordinary native preview and decoded lease stay
available. The change adds twelve production lines, no new state fields or caches,
and no per-frame allocations.

This applies to native previews whose full-source load failed, including a new
sampler alias encountering an already-failed shared source. Ordinary decoded SVG
preview coverage retains its existing fallback behavior. Native alternatives without
a preview authority and authored page sources are unaffected by the new predicate.

## Regression evidence

The host fixture injects either an HTTP 404 or four invalid image bytes for the full
PNG, required WebP or required AVIF, with ASTC LDR 6x6 and 8x8. It runs 180 frames
while alternating demand. All twelve cases now retain the red preview, read exactly
`astc,raster`, end with zero atlas/pending/unresident pages, and report one failure.
Only native preview CPU bytes remain: 832 bytes for 6x6 or 384 for 8x8.

An initial test assertion compared decoded bytes with the earliest preview frame,
but that frame could precede VT acquiring its native lease. The corrected assertion
allows the small native source storage while excluding a full-raster reservation.
It does not require discarding the pixels needed for fallback/context restoration.

The [saved baseline](authority-failure-baseline.json) fails the corrected atlas-zero
assertion while retaining red pixels. Candidate reports:
[transport failures](authority-failure-transport.json),
[invalid content](authority-failure-invalid.json).

The unit regression also verifies that a later sampler alias allocates no new GPU
textures and does not retry detail. All 86 runtime/growth tests and all 1,248 full
suite tests pass, along with types, lint and the glTF manifest check. Successful
paths still pass all [32 source cases](authority-failure-source-regression.json) and
[six late-bitmap cases](authority-failure-late-regression.json).

## Adversarial review

First pass checked failure state, native preview preservation, cleared demand,
shared-source aliases and bounded reads. The second checked GPU ownership and
frame state: destruction uses the existing reference count, cleans up an in-flight
replacement when the last pool owner leaves, and returns the state-change flag to
the frame renderer. Ordinary SVG preview failures retain their separate coarse
fallback path, covered by existing tests. The new check runs before demand
collection; permanently failed detail does not continue triangle traversal.

The empty-atlas regression is a memory/correctness result, not a claimed frame-rate
improvement. Aggregate GC data includes fixture setup and is not used for timing
comparisons.

## Size accounting

The fix's measured artifacts crossed the prior tight ceilings: lazy JS 130,410
bytes versus 130,384; deployed JS 274,030 versus 274,008; renderer tarball 749,664
versus 749,568. Explicit allowances add 64 bytes to lazy/total gzip ceilings and
128 bytes to the package ceiling. Bundle and packed-consumer checks then pass.
These numbers are ceiling overages, not measurements of the entire uncommitted
feature's size delta. The small allowances are recorded under
`failedNativeAuthorityRelease*` in the budget files.

[Patch](authority-failure.patch) and [source hashes](authority-failure-sources.json)
identify the before/after runtime. To reproduce, build the candidate and run:

```sh
VT_BENCH_URL='http://127.0.0.1:5186/research/vt-comparison/source-combinations.html?failure=transport' \
VT_BENCH_OUTPUT=research/vt-comparison/authority-failure-transport.json \
node research/vt-comparison/run-host.mjs
```

Use `failure=invalid` for invalid content. All browser checks remain headless on
Intel Iris Xe through ANGLE Vulkan. Nothing was committed, pushed or deployed.

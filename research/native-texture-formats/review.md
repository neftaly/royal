# Native texture adversarial review

Two review passes examined the final scope: native ETC2, ASTC LDR 6x6/8x8,
and BC1 RGBA/BC3/BC7 KTX2; no encoder or transcoder. Reviews were performed by
the implementing agent, not independent reviewers.

1. The first pass traced container parsing, mip rebasing, color interpretation,
   extension gates, context loss, and repeated binding resolution.
   - Found a stale capability cache across `TextureGpuOwner.invalidate()`.
     Clearing it re-enables extensions for the restored context. The test
     requires two extension queries and two uploads across invalidation.
   - Found that the explicit ETC2 source claim could admit ASTC after a
     simplification. Its discriminator now requires ETC2 exactly; a malformed
     claim is rejected before publication.
   - BC mip rebasing can produce illegal 1x1/2x2 base levels. Preparation and
     custom native uploads validate rebased base alignment; budget-suffix tests
     exercise rejection instead of relying on a WebGL error.
   - BC1 uses eight-byte blocks. Allocation, pending-page admission, and upload
     accounting all use the shared block-byte authority; parameterized runtime
     tests cover every new format through upload and invalidation.
   - The parser created temporary BigInts for each uint64 field. Two uint32
     reads preserve the safe-integer check without those allocations. The
     follow-up measurement retained zero payload-buffer growth and reduced
     parse cost in this run; timing is not a universal speed guarantee.

2. The second pass traced unsupported assets through source admission, GPU
   omission, scene publication, VT residency, and cleanup; it also challenged
   the benchmark and metadata validation.
   - Found that GPU omission alone could leave an unsupported decoded source
     waiting in the handoff queue. The built-in decoder now checks the device
     before publishing native blocks. Local asset failure releases the source
     reservation and keeps rendering alive. A root-level regression loads 40
     unsupported ASTC sources plus one supported ETC2 source and asserts zero
     remaining handoff bytes, no scheduled/listener failure, continued draws,
     and no pending frames.
   - Native decoding that finishes during context loss now waits for restoration
     before deciding support; an abort removes its listeners. A regression
     exercises successful restoration and cancellation, so temporary context
     loss cannot poison the asset as permanently unsupported.
   - Unsupported authored VT must not fetch page payloads or allocate storage.
     Each new format is exercised for 100 updates with absent extensions:
     one manifest fetch, one capability query, zero GPU allocation.
   - Checked BC linear/sRGB extension separation and ASTC LDR profile matching;
     tests reject linear-only S3TC and HDR-only ASTC for those requests.
   - Checked incompatible page encodings, colors, gutters, corrupt lengths,
     overlapping ranges, oversized uint64s, and extra DFD planes. DFD model and
     single-plane storage validation now apply to every native format.
   - Replaced uninformative zero-duration `gl.finish`-only draw measurements
     with synchronous one-pixel readback. The corrected software-renderer
     result shows that cheap ASTC upload does not imply cheap sampling.
   - Kept native metadata out of a new per-frame allocation path. Resident
     bindings return the existing object, unsupported bindings return the
     shared empty object, and exact page-byte calculations allocate no objects.
     The new dispatch uses a fixed six-format table; no per-call map or array
     is built. No transcoder, worker, shader, or dependency was introduced.

Remaining scope boundaries are documented rather than silently approximated:
no physical-GPU performance claim; no live raster/SVG encoding; no Basis;
no ASTC/BC retained CPU alpha decoding; no arbitrary block footprints or HDR.
These are intentional exclusions from the requested native-only implementation.

Final verification passed: 1,193 tests in 147 files, the glTF manifest check,
TypeScript, renderer lint, full workspace build, package entrypoint imports,
packed-consumer compilation/imports, and explicit bundle/package-size gates.
Browser tests accepted uploads for all six native formats and verified sampled
pixels for both ASTC footprints. CPU encoding, real-image software-browser
sampling, and JS/GC measurements are retained with reproduction scripts.
The production-source delta is 161 net lines, with no dependency changes.

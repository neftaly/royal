# Keep direct PNG fitting

The first-presentation audit attributed substantial time to the preview path's
3547px resize. This follow-up isolates browser bitmap operations with the same
requested output dimensions and `resizeQuality: 'high'`:

- Plain: decode the 4096px PNG without resizing, as a control.
- Direct: decode the PNG directly to a 3547px bitmap.
- Staged: decode a 4096px bitmap, then resize that bitmap to 3547px.

Each pattern has one discarded warm-up trio and six recorded rounds covering
all operation-order permutations. PNG generation, full canvas readback and pixel
hashing occur outside the timed section. The headless browser reports the Intel
Iris Xe host backend; timings are browser promise durations, not GPU query times.

| Pattern | Plain decode median | Direct resize median | Staged total median |
| --- | ---: | ---: | ---: |
| Solid red | 51.85 ms | 232.30 ms | 245.55 ms |
| Opaque blue / half-alpha red checker | 51.85 ms | 226.50 ms | 245.90 ms |

All 36 recorded outputs have the requested dimensions. Full-canvas hashes are
stable across rounds and match between direct and staged outputs for each
pattern. A hash is a diagnostic, not a general quality-equivalence proof.

Direct resizing exposes one returned 3547² bitmap, representing 50,324,836 RGBA
bytes. Staged resizing simultaneously exposes the original and resized bitmaps,
representing 117,433,700 bytes. Both are explicitly closed after the diagnostic.
These counts exclude canvas readback and browser decoder internals and are not
measurements of peak process memory. The initial decoder may itself use a full
image internally even in the direct path.

The measured staged path is approximately 6–9% slower and retains an additional
64 MiB returned bitmap during the resize. It does not justify changing the
production PNG path. This decision is specific to the tested browser, sizes and
patterns; it does not override AVIF's separate correctness-driven resize path.

Review checked matching decode options, balanced ordering, excluded diagnostic
work and `finally` cleanup for both success and resize failure. Research type
checking passes. No production changes, dependencies or size allowances were
introduced.

Reproduce using `source-combinations.html?bitmap-resize=1` with the existing
headless host runner. Artifacts: [harness](bitmap-resize.ts),
[results](bitmap-resize-results.json). Everything remains uncommitted.

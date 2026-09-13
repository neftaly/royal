# Context restoration after full-source failure

Date: 2026-09-13. Research-only pass; no production changes or commits.

The empty-atlas fix preserves native preview pixels after an authoritative source
fails. This follow-up verifies that context loss does not discard those pixels,
retry the failed source, or recreate empty VT storage.

Each case runs 180 alternating-demand frames after a full-source failure, loses
and restores the WebGL context, then runs another 180 alternating-demand frames.
The matrix covers HTTP 404 and invalid image bytes for PNG, required WebP and
required AVIF, with ASTC LDR 6x6 and 8x8. All twelve cases pass on headless Intel
Iris Xe through ANGLE Vulkan.

## Results

- Native preview pixels remain `[255,0,0,255]` after restoration.
- Renderer source reads remain exactly `astc,raster`: no ASTC reread and no
  full-source retry.
- Complete VT snapshots match exactly before and after restoration.
- Atlas bytes, resident/pending/unresident pages and desired pages remain zero.
- One authority failure remains recorded; native source bytes remain 832 for
  6x6 or 384 for 8x8.
- No frame or GL errors occur after restoration.

Reports: [HTTP failures](failure-restoration-transport.json),
[invalid content](failure-restoration-invalid.json). This is a restoration and
ownership check, not a frame-rate or aggregate-GC comparison.

## Review and limits

The shared context-restoration helper waits for both context events, allows the
loss event to finish before requesting restoration, and retains the existing
five-second event timeout. Moving the helper allows both failed and successful
source paths to use the same procedure. The runtime invalidates GPU bindings and
budgets while retaining source leases and failure state; the browser checks verify
the resulting behavior rather than relying only on that code reading.

The second review compares entire VT snapshots and exact source-read sequences,
not just visible color. It also checks that known failure state survives restoration
without creating repeated diagnostics or new VT demand. Research TypeScript, Vite
build and whitespace checks pass. All 32 [normal source cases](failure-restoration-source-regression.json)
also pass with the shared restoration helper. Renderer source is unchanged from the
[authority-failure fix checkpoint](authority-failure-sources.json).

These tests retain ASTC capability across context restoration. Capability changes,
actual device loss, and browser-specific restoration failures are outside this
host test. PNG/WebP/AVIF authority failures are controlled transport/content inputs.

The failure modes remain available on `source-combinations.html?failure=transport`
and `?failure=invalid`; their reports now include `beforeRestore` and `final` snapshots.

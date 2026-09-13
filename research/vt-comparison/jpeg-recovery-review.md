# JPEG failure and explicit recovery

Date: 2026-09-13. Evidence-only pass; no renderer edits or commits.

The expanded failure matrix passes all **20 cases** on headless Intel Iris Xe
through ANGLE Vulkan: HTTP 404 and invalid image content, five raster fixtures,
and ASTC LDR 6x6/8x8. The raster fixtures are PNG, JPEG, JPEG with a 24 KiB APP15
segment, required WebP and required AVIF. Invalid-content responses contain four
invalid bytes; valid JPEG metadata is exercised when the replacement recovers.

Each case advances 180 demand-changing frames after the authority fails, restores
the WebGL context, then advances another 180 frames. The ASTC preview remains red
and the renderer makes only one full-source read. Complete VT snapshots match
before and after restoration, with one recorded failure and zero atlas bytes,
atlas pools, desired pages, resident pages, unresident pages and pending bytes.

Retained decoded source bytes equal the six native mip payloads: 832 bytes for
6x6 and 384 bytes for 8x8. These exclude the KTX2 container overhead. An initial
post-run check incorrectly compared retained payload bytes with container size;
review corrected the check to sum the block-aligned mip sizes. No product change
or measurement adjustment was needed.

The fixture then serves valid content and changes the public glTF version while
keeping the source URL and renderer root. Every case recovers to blue authority
pixels with one resident page, one automatic resource, and zero failed, pending
or unresident pages. Total source reads are exactly ASTC/raster/ASTC/raster.
There are no frame or GL errors.

Review checked failure suppression in the scheduler and the separate versioned
identity used for recovery. The second pass checked the complete recorded
snapshots, payload accounting, exact source reads and recovered residency rather
than relying solely on the fixture's color oracle. All assertions pass. No new
performance claim is made from these setup-heavy browser traces; remote HTTP
cache freshness and physical mobile devices remain outside this check.

Evidence: [transport failures](jpeg-recovery-transport.json),
[invalid content](jpeg-recovery-invalid.json),
[source hashes](jpeg-recovery-sources.json). Run the candidate source-combination
fixture with `?failure=transport&recover=1` or `?failure=invalid&recover=1` using
the existing headless host runner. Whitespace checks pass.

# Context restoration during decode-budget contention

Date: 2026-09-13. Research-only regression for the resident atlas-key optimization;
no further renderer changes or commits.

The large-authority contention fixture now accepts `&restore=1`. While one full
raster is resident and the other texture is held on its native preview by the
decoded-source budget, it loses and restores the WebGL context. Both resources
remain in the scene. It then verifies another 120 frames before removing the
admitted resource to release capacity.

All four cases pass on headless Intel Iris Xe / ANGLE Vulkan: ASTC LDR 6x6 and 8x8,
with simultaneous arrival in normal and reverse scene order. The admitted texture
returns blue and the waiting texture stays red. The existing fetch-level guard
remains active across context loss and rejects a second full-raster read before
explicit removal.

The complete VT snapshots before and after restoration differ in exactly two
counters: page requests and uploaded pages each advance from one to two. The GPU
page is rebuilt from the retained decoded authority. Atlas bytes, resident pages,
pending work, failure counts and retained source bytes are otherwise identical.
There are no extra ASTC or raster source reads during restoration.

After removing the admitted texture, the waiting source reads its raster once and
becomes blue. The total four reads contain each ASTC and each raster exactly once.
Final removal returns decoded-source and atlas ownership to zero.

Review checked that GPU key reuse cannot carry an old atlas across invalidation:
the runtime clears GPU references and computes keys again when allocating restored
storage. The second pass compared every snapshot field and distinguished a page
rebuild from a new full-source read. The later promotion proves that context loss
neither turns budget denial into a permanent failure nor bypasses admission.

Research TypeScript, Vite build and whitespace checks pass. Runtime source still
matches the recorded resident-key checkpoint. These checks cover retained source
accounting and visible ownership behavior, not browser-process peak memory or
performance during context loss.

Evidence: [normal order](contention-restore-results.json),
[reverse order](contention-restore-reverse-results.json),
[source hashes](contention-restore-sources.json). Run the source-combination page
with `?large-contention=1&simultaneous=1&restore=1`, adding `&reverse=1` for reverse
order, through the existing headless host runner.

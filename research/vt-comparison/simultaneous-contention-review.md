# Simultaneous large-authority admission

Date: 2026-09-13. Research fixture extension; no renderer changes or commits.

Sequential contention did not cover two large authorities arriving together.
`?large-contention=1&simultaneous=1` now submits both glTF nodes in the initial scene.
`&reverse=1` reverses their scene order without changing their identities or positions.

All four simultaneous cases pass on headless Intel Iris Xe / ANGLE Vulkan:
ASTC LDR 6x6 and 8x8, in both scene orders. Normal order admits the left texture;
reversed order admits the right. This is an observation of this fixture, not a
public scheduling-order guarantee.

Only one full raster read starts while both textures remain present. The other
native preview stays red for 120 frames while the admitted authority is blue.
Removing the admitted texture then promotes the remaining one without changing
its version. Final removal releases all tracked decoded-source and atlas ownership.
Both sequential cases also pass with the strengthened fetch guard.

The fetch wrapper latches an error if a second raster read starts before removal.
This catches a transient double admission between frame snapshots, even if the
runtime were to catch the associated load failure later. It does not block or
serialize either fetch. Every inspected frame also checks the retained-source
ceiling, frame/GL errors and failed-page count. Before removal there are exactly
three source reads: both ASTC sources and the winning raster. The fourth read is
the remaining raster, with no fifth read. Native transport order may differ.

Review checked that simultaneous mode really starts with both nodes, allows either
winner, and neither gates transport nor supplies mock bitmaps. The second pass
reversed scene order to exercise the opposite winner/removal path. It also checked
the interval between first admission and explicit removal, and retained accounting
after replacement: one bitmap plus one native preview, then zero on final removal.
Research TypeScript, Vite build and whitespace checks pass.

This validates real browser admission and retry after budget release. It does not
measure peak browser-process memory or provide a throughput/GC comparison. The
underlying production reservation logic was already correct; no new runtime state,
branch or allocation was introduced.

Evidence: [normal order](simultaneous-contention-results.json),
[reverse order](simultaneous-reverse-results.json),
[sequential regression](simultaneous-sequential-regression.json),
[source hashes](simultaneous-contention-sources.json). Sequential regression was
captured before the equivalent fourth-read assertion rewrite and the optional
reverse-order selection; neither changes its execution path or tested invariant.

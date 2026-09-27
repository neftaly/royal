# Nova loading investigation

Continue the uncommitted memory work; do not commit. Profile the current full-resolution
`/home/neftaly/dev/nova/release` through `/home/neftaly/dev/probability` root `pnpm dev`
with `ROYAL_DEV_PATH=/home/neftaly/dev/royal`. Nova already serves at 127.0.0.1:45944;
its `/compact/` prefix maps to full-resolution release assets, not reduced artwork.
The current Probability root server uses localhost:3004.

User priorities:
- Real-world loading time backed by traces/CPU flame graphs and repeatable comparison.
- Investigate apparent HQ-to-LQ texture replacement, not just total ready time.
- Explain/reduce overhead from many small assets compared with larger ones.
- Other measured opportunities, including conservative occlusion-aware loading priorities.
- No visual regression: never discard a thin visible edge using an arbitrary 1 mm cutoff.
- Preserve existing game assets and layout; do not use authored low-resolution versions
  to hide renderer costs. Keep changes ready for commit but uncommitted.

Measurement plan: hardware Chromium CDP trace + CPU profile, request waterfall,
renderer snapshots and targeted texture-upload/source tracking. Distinguish network,
initial decode, source re-read, page generation, repeated scene work and GPU upload.
Confirm improvements with the same full-resolution workload. Use screenshots and
regression tests for quality/coverage. Inspect the cost of occlusion policy itself;
prefer priority changes before hard skipping unless invisibility is provable.

Initial hypotheses (results are in `report.md`):
- Initial ordinary GPU storage may upload larger seed pixels before VT registration
  compacts to a 64px fallback, producing a temporary quality downgrade.
- Idle ASTC transition or coarse-page selection may also explain a late downgrade.
- Catalogue publication / per-object work may dominate many-small-image scenes.
- Screen-area/occlusion priority may defer hidden deck faces while preserving visible
  slivers, shared images and prompt recovery when the camera or objects move.

Measured follow-up:
- Baseline 101.3s, 80,141,458 GPU bytes, 624 pages, 852 allocations, 3,084 uploads.
- CPU/handoff fixes: 95.5s, 666 allocations, 2,951 uploads, 10 texture deletes
  versus baseline 197. Texture-key serialization is no longer a top CPU cost.
- Presorted BSP + backface demand: 84.0s, 26,480,958 GPU bytes, 207 pages,
  458 allocations and 944 uploads. Timings are single instrumented dev runs.
- Final physical Quest synced game: 43.2s, 26,170,386 GPU bytes, 172 pages,
  no denials or page errors. iPad7,6 fixture and restoration pass again.
- Visual gate caught a small tracks-board difference. Disabling ASTC did
  not remove it; the source-size investigation below isolated and fixed it.
- Isolated visual cause: the tracks image (110,345 encoded bytes) produced its
  root plus two detail pages from the 359×183 seed with backface rejection,
  then eight pages from a 391×200 reread. The control generated all ten detail
  pages from 391×200. Detail sources now target the finest requested mip once;
  root fallback retains its cheap seed path. Added a coarse-first regression test.
- Final quality-fixed run: 60.8s, 207 resident pages, 26,666,814 retained GPU bytes,
  no errors/denials, 1,073 texture uploads. Tracks-board pixels match within 8/255;
  only one pixel exceeds that threshold in the 752,100-pixel scene crop.

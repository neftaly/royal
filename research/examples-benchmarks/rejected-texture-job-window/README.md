# Rejected texture job window

The physical iPad Safari experiment in
`2026-07-21T18-28-53-507Z-gltf-bistro-web-scene-exterior.failure.json`
changed only the root-local browser texture job window from eight to sixteen.
Bitmap decode concurrency remained four and the scene, cache mode, GPU budget,
upload budget, and asset bytes were unchanged.

The preceding eight-job run completed all 202 Exterior textures in 39.271
seconds without browser errors. The sixteen-job run took 47.037 seconds and
WebKit reported same-origin access-control failures for ordinary AVIF and blob
loads. The renderer ultimately recovered all 202 images, but the browser
lifecycle evidence is invalid and the wider window did not improve completion.

Keep the eight-job bound. Increasing outstanding encoded blobs is not a safe
loading optimization on the Safari 17 / A10 support floor; future work should
reduce per-texture decode cost or improve authored storage instead of widening
this queue without a byte-based pressure authority.

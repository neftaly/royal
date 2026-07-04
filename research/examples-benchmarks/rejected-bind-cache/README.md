# Rejected Bind Cache Experiment

Renderer-side program/buffer/texture bind caches reduced WebGL state counters but
hurt target frame time, so the renderer change was removed.

Useful Quest 2 comparisons:

- Baseline kitchen sink: `p95=43.3ms`, `state/frame=2172.7`.
- Texture bind cache run: `p95=62.7ms`, `state/frame=1968.8`.
- Program/buffer-only cache run: `p95=62.9ms`, `state/frame=1962.4`.

Conclusion: counters alone were misleading here. Keep measuring target frame time
before landing hot-path cache layers.

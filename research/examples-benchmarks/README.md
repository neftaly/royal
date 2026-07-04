# Example Benchmark Reports

Saved reports for renderer performance work. These are inputs for deciding what to
delete, keep, or change; they are not pass/fail CI fixtures.

Current baselines:

- `host-gltf-kitchen-sink.json`
- `host-gltf-instancing-quick.json`
- `host-generated-vt-load.json`
- `quest2-gltf-kitchen-sink.json`
- `quest2-gltf-instancing-quick.json`

Rejected experiments live in subfolders with their own notes so they are not
mistaken for current baselines.

iPad Safari runs collected through `ios_webkit_debug_proxy` go under
`ipad-safari/`. Treat them as device baselines only when `frameStats.complete`
is true and `warnings` is empty or understood.

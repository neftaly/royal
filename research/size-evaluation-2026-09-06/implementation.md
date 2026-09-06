**Implemented follow-up: shared codec delivery**

The retained change preserves Draco (the existing minidraco implementation),
Meshopt, all Play features, worker parallelism, and shader/material behaviour.
Both codecs are now self-contained ES modules, loaded on demand through URLs
resolved by the consumer and forwarded to preparation and nested decode workers.
The build plugin deliberately separates their compilation from the application
graph; it rejects assets with imports. General preparation sharing was not
adopted because ordinary consumer chunking can make a worker execute the app's
entrypoint. Optional VT and volume implementations remain lazy and available.
No restricted feature build or fidelity tradeoff was introduced.

| gzip bytes | 0.0.20 | Candidate |
| --- | ---: | ---: |
| Initial fixture | 139,860 | 139,919 |
| All fixture JS | 287,811 | 253,609 |
| Incremental total over React | 228,503 | 194,301 |
| Preparation worker | 56,753 | 22,952 |

The complete incremental saving is 34,202 B (15.0%). Initial size increases 59 B.
Existing package budgets pass; bundle ceilings have been tightened to protect
the saving. This is a delivery reduction, not a source LOC reduction or a
measured hardware FPS improvement. Compressed worker loading gains an on-demand
codec request; uncompressed workers avoid loading those decoder bytes entirely.

Verification includes the full Royal suite, TypeScript, lint, package builds,
and the isolated packed consumer. The packed consumer now executes real Draco
Duck decoding and checks a known Meshopt stream. Worker-protocol tests assert
codec URLs are carried into preparation and nested workers.

Browser validation used the temporary Probability copy through literal root
`pnpm dev`; the real Probability checkout and dependency catalog were untouched.
Five Play checks passed: history preview/restore, SVG textures, map gestures,
one-finger piece drag, and rebuilt module loading with no browser/module/Vite
errors. A separate production fixture exercised small-GLB main-thread Draco,
JSON glTF worker preparation with two Draco tasks (nested workers), and Meshopt.
Draco positions, normals, and indices matched exactly between main and worker
paths, and Meshopt matched known positions/indices. A source-development fixture
also exercises the codec plugin. These are Chromium/software-GL checks; physical
A10 and Quest validation remains outstanding.

Local logs: `/tmp/royal-codec-tests-final.log`,
`/tmp/royal-codec-consumer-final.log`, `/tmp/royal-codec-size-final.log`,
`/tmp/royal-codec-browser-tests.log`, `/tmp/royal-codec-parity-tests.log`, and
`/tmp/royal-codec-source-tests.log`. The production/source browser harness is in
`/tmp/royal-codec-browser`; temporary Playwright tests are under
`/tmp/royal-play-smoke-q4va7dwp/apps/play/e2e/royal-codecs*.spec.ts`.

Meaningful cold/warm A/B measurements exposed and corrected an initial compressed-startup regression. Codec delivery now starts alongside external geometry reads. See [the timing report](cold-start/README.md) for 960 navigations, paired results, raw evidence, limitations, and reproduction commands. The final suite passes 945 tests in 131 files.

# Adversarial review before 0.0.21

Reviewed codec URL ownership across main/preparation/nested worker realms, selected-source prefetch ordering, decoder import failure propagation, cancellation and worker termination, public exports, standalone asset emission, packed dependency boundaries, and source-development compilation caching.

## Fixed finding

The codec build plugin cached compiled output indefinitely, including rejected promises. Watched source/dependency edits could continue serving stale output and transient build failures could poison future requests. The plugin now registers bundled dependencies as watch files, clears its compile cache on watch changes, and evicts failed promises. Three regression tests cover edit invalidation, failure retry, and rejecting codec chunks that import an application module.

## Adversarial checks

- Abort standalone Draco module delivery in the browser. Small GLB/main-thread and JSON/worker preparation both reject without hanging or emitting an unhandled page error.
- Remove the Worker API before module evaluation. JSON Draco and a known Meshopt stream decode serially with correct geometry.
- A deliberately throwing top-level Worker constructor rejects rather than falling back. This is unchanged from 0.0.20 (the owner acquires its worker before its response promise). It is an existing limitation, not represented here as a working fallback. Nested Draco-worker constructor failure retains its existing serial fallback and test coverage.
- The 960-navigation benchmark already exercises consumer-resolved URLs under nested deployment paths. Production and source browser fixtures verify actual main/nested-worker decoding and a shared codec URL.
- Standalone codec builds reject static or dynamic module imports; packed consumers import both published codec files and decode real geometry.
- After the cache fix and 0.0.21 version bump, every published package JavaScript file has exactly the same SHA-256 as the measured implementation. The timing and pixel-parity results therefore still apply to the emitted runtime.

## Release validation

948 tests in 132 files, TypeScript, lint, package builds, packed consumer imports/types/real-codec decoding, and tightened bundle/package size budgets pass. Final complete fixture JavaScript remains 253,609 gzip bytes. The five Play compatibility checks and production/source codec checks previously passed with identical runtime output. Three additional adversarial browser checks pass. No physical A10 or Quest timing was measured.

No dependency update is included. Browser harness scripts and logs are archived beside this report. The failed first adversarial run is retained to document the overly broad fallback assumption and its correction.

# Main integration and adversarial follow-up

Validated 2026-09-26 after integrating the reviewed changes with `origin/main`
`d8d1ec81` (Royal 0.0.35). The changelog retains the 0.0.34 and 0.0.35 release
entries and puts the virtual-texture changes under Unreleased.

## Additional fix

The intermittent atlas allocation-stability failure was reproduced by forcing
exact-demand work across frames. Two failing migrations could repeatedly
reserve and release replacement atlases, changing each other's available-memory
fingerprints and causing an unbounded retry loop even after demand and page
requests settled. `retry-loop-before.log` records the failing reproduction.

Failed GPU migrations now compare demand, pool share, uploaded coverage, and
available memory excluding temporary RGBA replacement reservations. Ordinary
capacity-denial checks still use the actual available budget. This keeps failed
migrations quiet until a relevant committed state changes. Tests cover both
ordinary and chunked demand, preserved old residency, and successful recovery
after either demand or committed capacity changes.

The HDR inspection oracle uses Node's strict native typed-array comparison.
It still compares every output byte and confirms the source is unchanged, while
avoiding matcher overhead that exceeded the default test timeout in full runs.
The test timeout was not increased.

Three adversarial probes are now retained in the scheduling suite: removing a
resource during paused demand, context invalidation during paused demand, and
empty views superseding a paused visible traversal.

The accepted presentation-path size increase has a documented 64-byte allowance
for the initial, incremental, and glTF-initial gzip budgets.

## Validation

- 1,409 tests across 162 files pass, plus the 64-case glTF manifest check.
- All 54 atlas-growth cases pass, including failure stability and retry recovery.
- Typecheck, lint, all-package build, package imports, packed consumer, and
  bundle-size checks pass.
- Chromium with SwiftShader: all 150 alpha-blend pixel samples, VT anisotropy,
  the full examples browser suite, and ordinary/creation-time context restoration
  pass.
- Relevant command output is saved alongside this file.

These checks run on the integrated source tree. Earlier iPad and Quest reports
remain evidence for their recorded builds; physical devices and immersive XR
were not retested during this follow-up.

# Malformed authored native pages: failure lifetime

Follow-up: [empty failed-atlas reclamation](empty-failed-atlas-review.md) now
releases fully unusable allocations. The original retention findings below
record behavior before that fix.

Six runtime regressions cover ETC2, ASTC 6×6/8×8, BC1 RGBA, BC3 and BC7.
A valid one-page manifest leads to a native KTX2 page with unsupported `ru`
orientation. The source remains supported/ready, records one failed page and
has no resident pages; the compressed upload function is never called.

After failure, pending decoded-page bytes return to zero. One hundred updates,
runtime invalidation, and another hundred updates neither throw nor repeat the
page fetch. The total remains one manifest read plus one page read, with no
pending reads or uploads. Failed page identities survive runtime invalidation;
this is distinct from unsupported device capability and from transport retry.

Changing the source version and supplying valid `rd` metadata clears the failed
page identity: one new manifest read and one new page read produce one resident
page and exactly one compressed upload. Removing the scene releases atlas
bytes, pending bytes, failed-page records and all GPU budget ownership.

The tests explicitly confirm nonzero GPU ownership after malformed-page
rejection. An atlas was allocated from the valid manifest before the page was
read, and that atlas remains owned while the source stays in the scene. Thus
bounded failure handling does not mean zero resident GPU allocation for a
wholly unusable authored source. This is not an ownership leak after removal;
reclaiming the idle allocation earlier would be a separate policy change.

Validation: full suite 1,325 tests across 149 files, the 65-case glTF manifest
check and root typechecking pass. These are mocked-runtime lifecycle checks;
no GPU timing or GC improvement is claimed. No production changes, budget
allowances or commits were made in this pass.

Tests: `native VT compatibility` in
`tests/replacement/renderer-webgl-vt-runtime.test.ts`.

## Partial failure and shared-pool isolation

Four additional cases cover ASTC 6×6/8×8 with the failing or healthy resource
inserted first. Each resource has four detail pages and one coarse page, and
both share the same physical atlas. Only the failing resource's coarse page
has invalid orientation metadata.

The failing resource still publishes all four healthy detail pages. The
neighbor publishes all five pages. Initial transport totals two manifests and
ten page reads, with nine compressed uploads; another hundred updates do not
add reads. Runtime invalidation re-uploads the nine healthy pages without
retrying the failed coarse page. Removing the failing resource preserves the
healthy resource's exact atlas texture and five resident pages. Removing the
remaining scene releases all GPU budget ownership.

This verifies that ancestor failure does not indefinitely block healthy detail
and that failure identities do not poison another resource in the shared pool.
It does not assert usable coarse coverage for the failed texture when viewed
at a mip that specifically needs its missing coarse page. These are scheduler,
publication and ownership checks using mocked WebGL, not shader pixel or timing
measurements.

All 109 runtime/native/ETC2 tests and root typechecking pass after the extension.
No production code, size allowances or commits changed in this follow-up.

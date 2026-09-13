# Native page color-space failure containment

A valid KTX2 page with storage color space different from its effective binding
previously reached upload, threw, and remained eligible for another read. Six
new malformed-page cases reproduced non-settling failures before the fix.

Read completion now closes and records incompatible native pages as failed
before they enter the upload queue. The existing stale/aborted result checks run
first. Effective color space follows the asset override, otherwise the manifest.
The upload guard remains as defensive validation. This adds three runtime lines,
no persistent state or new allocation on successful reads, and no per-frame work.
The normal failure mechanism supplies no-retry behavior and empty-atlas cleanup.

## Adversarial coverage

All six formats cover malformed orientation, linear storage against an sRGB
binding, and sRGB storage against an explicit linear binding override. Tests
assert no invalid uploads, no repeated reads or allocations over unchanged frames
and invalidation, zero empty-atlas budget, and successful new-version recovery.
Eight ASTC 6x6/8x8 × insertion-order × defect cases additionally verify healthy
detail recovery, preservation when returning to a failed coarse mip, shared
neighbor survival, and restoration without retrying the failed coarse page.

The headless Intel host-GPU color-space fixture changes both Vulkan format and
DFD transfer metadata consistently, preserving a valid native container with
incompatible storage color. Both insertion orders pass actual context loss and
restoration: ten failed native reads total, ten failure records retained, one
healthy atlas with ten resident pages, no pending/unresident pages, healthy pixels
and zero GL error. The 44-case source-combination matrix also passes.

## Healthy native measurements

Sixteen moving native textures, 256 MiB budget, 600 measured frames, headless
Intel GPU; before and after measured sequentially with builds/tests idle:

| Metric | Before | After |
| --- | ---: | ---: |
| Submission median / p95 | 0.5 / 0.9 ms | 0.5 / 0.9 ms |
| Sampled allocation | 13,823,612 B | 14,351,756 B |
| GC events / duration | 10 / 7.180 ms | 10 / 6.969 ms |
| Final resident pages | 336 | 336 |

Final VT state and sampled pixels match exactly. One pair cannot establish a
small timing or GC change; allocation sampling was higher after the fix. The
new validation executes during read completion, which healthy steady measurement
has already warmed past. These measurements check steady rendering, not native
read-completion throughput. No performance improvement is claimed.

## Validation and size

Full suite: 1,351 tests plus 65 glTF manifest cases. Root and research typechecks,
lint, packed consumers, and bundle gates pass. The packed renderer was 750,365 B,
45 B above its previous ceiling; a named 64 B package allowance raises the ceiling
to 750,384 B. This overage is not the binary delta. Bundle ceilings are unchanged.
The first sandboxed package attempt failed to spawn pnpm; the authorized rerun
completed consumer checks, then exposed the size overage, and the final rerun
passed with the recorded allowance.

The [patch](native-color-failure.patch) and [source hashes](native-color-failure-sources.json)
record the exact runtime pair. Runtime sources embedded in both profiling builds
match those hashes. Everything remains uncommitted.

Evidence: [before](native-color-failure-host-before.json),
[after](native-color-failure-host-after.json),
[before heap mapping](native-color-failure-profile-before.json),
[after heap mapping](native-color-failure-profile-after.json),
[SVG-first recovery](native-color-failure-svg-first.json),
[native-first recovery](native-color-failure-native-first.json),
[source matrix](native-color-failure-source-regression.json).

## Adjacent source validation follow-up

The bounded malformed-page matrix now adds wrong native format, width, height,
and mip count for each of the six native formats (24 additional cases). Every
fixture remains a structurally valid KTX2 container; it disagrees with the page
source contract. Each case verifies a terminal page failure, no native upload,
zero pending/empty-atlas bytes, no repeated reads or allocations over 100 frames,
invalidation plus another 100 frames, and successful new-version recovery.
Width and height are changed independently to catch one-axis checks.

A temporary mutation removed the three source checks for format, dimensions,
and exactly one mip. All 24 selected cases failed. The source file was restored
byte-for-byte in a finally block. With source validation restored, all 162
runtime/growth tests and root typechecking pass; diff whitespace checks pass.
This follow-up adds only regression coverage and evidence, with no production
changes or additional performance claim. It uses mocked GL, so the earlier real
GPU evidence remains scoped to the color-space defect and healthy source matrix.
No commits were made.

## Headless GPU page-contract follow-up

The steady mixed-source fixture now generates structurally valid native KTX2
pages that violate one source requirement at a time: ASTC 6x6 against an 8x8
manifest, width 72 instead of 144, height 72 instead of 144, or two mips instead
of one. Unlike truncated bytes, these cases exercise source-level validation
after successful container parsing. The shared structural fixture supplies the
corresponding format descriptors, level indexes and block sizes consistently.

Each run waits for empty failed-atlas cleanup, loses and restores the real
headless Intel GPU context, then renders 120 moving frames. Before loss and at
completion there is one healthy pool, ten recorded failures, and zero pending
or unresident pages. Ten total native reads show that failed pages were not
retried during restoration. Final healthy pixel and GL-error checks pass.

| Defect | Order | Total failed reads | Healthy resident pages | Evidence |
| --- | --- | ---: | ---: | --- |
| format | svg-first | 10 | 10 | [native-contract-format-svg-first.json](native-contract-format-svg-first.json) |
| format | native-first | 10 | 10 | [native-contract-format-native-first.json](native-contract-format-native-first.json) |
| width | svg-first | 10 | 10 | [native-contract-width-svg-first.json](native-contract-width-svg-first.json) |
| width | native-first | 10 | 10 | [native-contract-width-native-first.json](native-contract-width-native-first.json) |
| height | svg-first | 10 | 10 | [native-contract-height-svg-first.json](native-contract-height-svg-first.json) |
| height | native-first | 10 | 10 | [native-contract-height-native-first.json](native-contract-height-native-first.json) |
| mips | svg-first | 10 | 10 | [native-contract-mips-svg-first.json](native-contract-mips-svg-first.json) |
| mips | native-first | 10 | 10 | [native-contract-mips-native-first.json](native-contract-mips-native-first.json) |

These eight runs are correctness evidence, not timing comparisons: independent
insertion orders ran concurrently. Research typechecking and diff whitespace
checks pass. The production runtime SHA-256 still matches the retained
color-space fix. Only the research fixture and evidence changed; no commits
were made.

## Removing and reintroducing a failed identity

The 42 malformed-page cases (six formats × seven defects) now cover a complete
identity lifecycle as well as unchanged-demand and context invalidation:

1. Fail the initial source and verify bounded transport and empty GPU cleanup.
2. Remove the source from the scene; failure records and pending/atlas bytes
   immediately return to zero.
3. Repair the bytes and reintroduce the exact same asset object, without changing
   URI or version. It loads one resident page successfully.
4. Remove it again, restore malformed bytes, and reintroduce the same identity.
   A fresh read fails once and empty GPU budget returns to zero.
5. Repair the bytes and replace the currently failed asset with version one.
   It loads successfully, preserving direct failed-source version recovery.
6. Clear the scene and verify zero retained GPU budget and failure/pending state.

Each complete sequence makes eight fetches (four manifests and four pages) and
two valid compressed uploads. This verifies that failure records live with the
claimed resource, rather than leaking into a permanent URI-level failure cache.
Review confirms scene reconciliation destroys and deletes unclaimed runtime
resources. All 162 runtime/growth tests, root typechecking, and diff whitespace
checks pass. This is mocked-GL lifecycle coverage, not a browser cache or network
freshness guarantee. Production source hash is unchanged. No commits were made.

## Integration validation after lifecycle and scheduler coverage

The complete current test suite passes 1,381 tests across 149 files, followed by
all 65 glTF manifest cases. Lint, root typechecking, and research typechecking
pass. The rebuilt research client passes all 44 headless Intel host-GPU source
combinations. The runtime embedded in its source map matches the current runtime
file and the previously validated color-space fix; later changes were tests,
research fixtures and evidence. Package/size checks were not repeated because
production and their recorded budgets have not changed since that validation.

[Validation record](native-integration-validation.json) records exact source and
log hashes; [GPU matrix](native-integration-source-regression.json) records the
host renderer and source outcomes. Diff whitespace checks pass. This validates
the accumulated changes, not completion of the continuing VT improvement goal.
Everything remains uncommitted.

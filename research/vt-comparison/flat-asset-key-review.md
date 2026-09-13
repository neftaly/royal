# Smaller authored VT identity construction

Authored VT keys now serialize one flat array instead of constructing nested
identity arrays and serializing a sampler key inside the outer JSON value.
Sampler defaults still come from `canonicalTextureSampler`. The change removes
three production lines, three temporary arrays per key call and the inner JSON
serialization, without adding a cache or persistent state.

The raw internal key strings change. Equality semantics are preserved for the
tested identity classes: manifest identity versus explicit content identity,
number versus string scalars, absent versions, color space and normalized sampler
fields. The helper is not a public package export; its callers use it for internal
maps and grouping. Automatic texture keys and serialized texture/glTF formats
are unchanged. [Patch](flat-asset-key.patch), [source hashes](flat-asset-key-sources.json).

## Identity and failure review

A bidirectional oracle compares the actual old and candidate functions across
6,000 raw input combinations, including delimiter-like and escaped strings,
aliasing manifest URIs, explicit/implicit defaults and raw empty scalar strings.
Both functions partition these into the same 780 classes: no observed merges or
splits. The public constructor rejects empty identity strings; the production
regression uses 81 valid content/version combinations and verifies that explicit
content aliases ignore manifest URI while manifest identities do not.

The existing typed-version/default-sampler test remains. Removing the manifest/
content tag makes both public identity tests fail. The source was restored
byte-for-byte afterward. No cache was introduced, so there is no new cache
lifetime or invalidation policy to maintain.

## Measurements

The [key-only Node comparison](flat-asset-key-cpu.json) uses the actual transpiled
key and sampler functions, 20,000 warm-up calls and eight alternating rounds of
200,000 calls per implementation. Median time falls from 123.186 to 77.467 ms
per round, about 37.1%. This is an isolated CPU result, not a browser frame-rate
claim. The script reads the original module from `VT_KEY_BASELINE` or the recorded
`/tmp/royal-vt-before-flat-asset-key.ts` baseline.

Four headless Intel-GPU profiles use the reduced-diagnostic eviction fixture in
before/after/after/before order. Each performs 128 measured replacements, with
257 rendered frames, 163 total page reads/uploads including warm-up, and identical
final VT state and colors. The latest 32 response bodies are no longer alive.

| Run | Sampled allocation bytes | GC events | GC total ms |
| --- | ---: | ---: | ---: |
| [Before](flat-asset-key-eviction-before.json) | 3,933,940 | 6 | 5.518 |
| [After](flat-asset-key-eviction-after.json) | 4,196,220 | 5 | 4.857 |
| [After repeat](flat-asset-key-eviction-after-repeat.json) | 3,868,692 | 5 | 8.066 |
| [Before repeat](flat-asset-key-eviction-before-repeat.json) | 4,294,648 | 6 | 5.844 |

Allocation totals overlap, and GC duration varies. These do not establish an
end-to-end speed or GC improvement. The change is retained for its measured
helper cost reduction and simpler construction with equivalent tested behavior.
[Before allocation summary](flat-asset-key-profile-before.json),
[after allocation summary](flat-asset-key-profile-after.json).

Eight [ASTC GPU regression cases](flat-asset-key-gpu-regression.json) also pass:
6×6/8×8, byte/slot caps and both scene orders, including late neighbor admission,
colored replacement and context restoration. Every case finishes with three
resident pages and ten uploads; final disposal releases retained GPU budget.

## Validation and size

The full suite passes 1,463 tests across 149 files and 65 glTF manifest cases.
Root typechecking, lint and packed-package validation pass. Lazy gzip measures
130,650 bytes, two above the old ceiling of 130,648; a named eight-byte allowance
sets that ceiling to 130,656. Other bundle and package ceilings remain unchanged,
and the final bundle check passes. This overage is not an exact binary delta
against the original implementation. No commits were made.
[Validation record](flat-asset-key-validation.json).

## GPU identity and lifecycle follow-up

The [native identity fixture](native-identity-gpu.ts) exercises actual resource
sharing and rendering, in addition to the string equivalence tests. Five meshes
use four identities: two URI aliases with the same content key and numeric
version (one explicitly specifies the default sampler), a string-version variant,
and numeric/string content-key variants. Colors make accidental sharing visible.

All four [headless Intel GPU cases](native-identity-gpu.json) pass: ASTC 6×6 and
8×8, each in both scene orders. Five phases cover initial rendering, removing one
alias, removing the last alias, re-adding it, and real context loss/restoration.
All 100 pixel checks pass. Each case has four resident identities initially,
three after removing both aliases, and four after re-add/restoration. The unused
alias URI is never fetched. Total reads progress 8, 8, 8, 10, 14; final uploads
are nine. There is one shared atlas, no GL error, and tracked GPU budget is zero
after disposal.

An isolated control build removes version identity from the key. The fixture
[rejects that mutation](native-identity-control.json) in the first ASTC 6×6 case:
only three identities and six reads remain, instead of four and eight. Later
control cases do not run. Production source was never changed by this control.
This verifies resource-key behavior on the host GPU; it does not measure speed,
allocation rate, or other GPUs. Research typechecking and building pass. No
production lines were added in this follow-up and no commit was made.
[Source hashes and validation](native-identity-validation.json).

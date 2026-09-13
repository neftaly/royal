# Native decode sharing: confirmed failure-isolation limitation

The real browser decoder and TextureAssetOwner reproduce order-dependent source
preparation when the same sRGB native KTX2 is claimed as both sRGB and linear.
The linear claim is invalid under the current native storage contract.

| First claim | Both claims: valid sRGB snapshot | After removing linear claim |
| --- | --- | --- |
| sRGB | ready | ready |
| linear | error | error |

Both explicitly declared `ktx2-native` and MIME-detected KTX2 behave this way
for ETC2 RGBA, ASTC 6×6/8×8, BC1 RGBA, BC3 and BC7.
Each case reads the source once. The experiment stops at decoded-source
ownership; it does not render or claim the invalid linear binding can upload.
GPU-owner color-space rollback has separate coverage.

Cause: decodedTextureKey deliberately omits color space to share ordinary
pixels. TextureAssetOwner chooses the first claim for preparation and retains
errors while that decoded identity remains claimed. decodeKtx2Texture rejects a
native storage color mismatch before publishing the source. Consequently the
invalid first claim also prevents the valid claim from receiving native levels.

This is a confirmed limitation, not a completed fix. No production changes were
made in this pass. Adding color space only to explicit native identities would
leave MIME-detected native content affected. Adding it to all identities would
split ordinary raster decode sharing. Simply deleting decoder validation would
change native-to-raster fallback selection, which currently catches preparation
errors before choosing the fallback. A correction must account for these three
paths together; a narrow explicit-encoding patch is insufficient.

Reproduce with:

```
pnpm exec vitest run research/vt-comparison/native-color-sharing-probe.test.ts
pnpm exec tsc -p research/vt-comparison/tsconfig.json
```

All 24 diagnostic cases and research typechecking pass. The probe asserts the
observed behavior to make the finding reproducible; those assertions are not the
desired isolation contract and are outside the ordinary regression suite. When
fixing this, replace them with regression assertions that the valid claim can
prepare regardless of claim order. No timing or allocation conclusions follow
from this small ownership experiment. Everything remains uncommitted.

## Expanded review and implementation decision

The matrix now covers six formats × explicit/MIME-detected encoding × both
claim orders. Fifty further reconciliations of the valid-only claim trigger no
new transport. A new source version prepares successfully in every case and
performs exactly one additional read. Thus the failure is retained for the
source identity; these checks found no retry churn or permanent failure across
version changes. Capabilities are mocked to available; this is not a host-GPU
upload benchmark.

Defer the general failure-isolation redesign. The contradictory linear claim
is invalid under the renderer's current strict native storage contract; this
experiment does not establish a failure for two valid claims. The larger change
would affect every shared decode, not only VT, and would need per-binding error
and fallback outcomes while retaining common pixel ownership. Do not add a
partial explicit-format key exception or disable color-space validation to hide
this result. The limitation remains documented and reproducible. Revisit if a
valid source recipe exhibits the same poisoning, or if malformed-binding
isolation becomes an explicit contract. No production lines, state, allocations
or package allowances were added for this investigation.

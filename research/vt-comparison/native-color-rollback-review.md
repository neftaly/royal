# Native color-space mismatch rollback

Ten GPU-owner regressions cover ASTC 6×6/8×8 and BC1/3/7 with encoded linear and
sRGB storage. Each establishes a valid resident texture, then attempts to bind
the same decoded native blocks under the opposite color-space interpretation
with a separate storage identity.

The incompatible binding raises the existing storage-color-space validation
error. Its attempted allocation is released: retained GPU bytes return to their
pre-attempt value. The already-resident compatible texture is never deleted,
retains the same handle afterward and requires no second compressed upload.
Disposal finally returns retained GPU bytes to zero.

This checks rollback for invalid binding metadata. Device capability rejection
has separate tests that settle unsupported textures without frame exceptions.
It also differs from ordinary decoded pixels, which can share CPU storage across
linear/sRGB GPU interpretations. Native KTX2 metadata fixes the encoded transfer
function and is validated accordingly.

The native-texture suite passes 42 tests and root type checking passes. These
are GPU-owner tests using fake GL, not new physical-device or performance
measurements. They do not exercise asset-owner decode ordering across conflicting
color-space requests. No production change or size allowance was needed.
Everything remains uncommitted.

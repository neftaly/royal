# Shared glTF texture index across material roles

Two regressions now use one texture-asset reader and decoder to request the same
texture index as preview-enabled base color and ordinary sRGB data (such as an
emissive use), in both lookup orders. This specifically exercises the prepared
asset cache; separate reader instances would not detect a role-key collision.

Repeated lookups retain the correct per-role object. Base color retains the ASTC
preview recipe; the non-base-color asset has neither preview metadata nor ASTC
alternative. Their decoded keys differ. With ASTC advertised as supported, the
decoder returns native preview state for base color and the full 512px bitmap
for the ordinary use, with exactly one ASTC fetch, one PNG fetch and one bitmap
decode across the pair.

Review also checked a linear data-map use. Ordinary linear and sRGB uses share
their decoded-pixel identity but have different GPU storage identities. An
initial test assumption incorrectly required separate decoded keys; source
review confirmed sharing is intentional because color interpretation belongs
to GPU storage. The regression preserves that useful sharing while ensuring a
preview recipe cannot replace the ordinary authority.

The raster-preview suite passes 19 tests and root type checking passes. This is
reader/decoder coverage using fake GL and bitmap decoding; it does not claim a
new shader or photometric validation. No production change, extra decoding cache
or size allowance was needed. Everything remains uncommitted.

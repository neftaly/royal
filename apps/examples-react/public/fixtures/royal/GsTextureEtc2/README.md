# Royal direct ETC2 oracle

`optional-fallback-quad.gltf` is an authored Royal fixture for the experimental
`GS_texture_etc2` delivery contract. It retains a one-pixel core PNG fallback
and embeds a structurally valid 4×4 sRGB ETC2 RGBA KTX2 alternate as a data URI.
The texture uses non-mipmapped linear sampling so its exact GPU block residency
is 16 bytes rather than 64 bytes for decoded RGBA8.

The fixture is intentionally tiny: it proves extension selection, opaque
source marking, KTX2 validation, direct compressed upload, orientation, color,
and exact diagnostics without treating a large scene as a unit test. It is not
a visual quality oracle for an offline compressor.

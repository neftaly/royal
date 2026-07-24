# Optional texture extensions need a supported required fallback

Probability's store enrichment experiment adds `GS_texture_etc2` as an
optional direct-GPU representation while retaining `EXT_texture_avif` as the
required compact representation. A texture can therefore have:

```json
{
  "extensions": {
    "EXT_texture_avif": { "source": 0 },
    "GS_texture_etc2": { "source": 1 }
  }
}
```

with both images external or embedded as GLB buffer views.

Royal currently rejects this unless the AVIF image is also repeated as core
`texture.source`. The diagnostic says the optional ETC2 extension needs a core
fallback, although required AVIF is already an unconditional Royal-supported
fallback. Probability's measurement control used that duplicate-source
workaround, but a production author should not institutionalize it.

## Requested renderer decision

Please consider making static texture planning reason about the complete
logical source set rather than requiring a core source specifically:

- when ETC2 is supported, select the optional ETC2 source;
- otherwise select the required AVIF source;
- reject a texture whose remaining alternatives are all optional and which has
  no core source;
- preserve the existing failure for any unsupported required extension; and
- preserve core-source fallback behavior for ordinary optional extensions.

This should be a general source-planning rule, not a Probability or AVIF special
case. It should add no consumer API.

Useful adversarial cases are:

1. optional ETC2 + required AVIF + no core, with and without ETC2 capability;
2. optional ETC2 + optional AVIF + no core;
3. required ETC2 + no core;
4. optional ETC2 + a core source;
5. the same cases with URI images and embedded buffer views; and
6. an unsupported required texture extension alongside an otherwise usable
   source.

The measured motivation and exact delivery shape are in
`../probability/research/benchmarks/texture-delivery/README.md`.

## Resolution

Royal's pure static texture planner now validates the complete ordered source
chain rather than requiring core specifically. Optional ETC2 accepts required
AVIF or WebP below it; optional AVIF accepts required WebP; optional WebP still
requires core. Optional SVG accepts the same required raster chain for its
failure fallback. An all-optional extension chain without core remains invalid.
Selection remains SVG, then ETC2, AVIF, WebP, and core as applicable, and
transports only the selected ordinary source unless SVG actually fails. Focused
fixtures cover capability-present/absent ETC2, URI and embedded images,
required lower-priority fallback, all-optional rejection, required ETC2,
ordinary core fallback, malformed required-source indices, and unknown
required-extension failure.

This rule adds no ordinary initial-path bytes. Relative to the preceding
read-ahead build it adds 235 gzip bytes to lazy glTF code and 124 bytes to the
preparation worker; total deployed JavaScript moves by 228 bytes to 265,169.
The source-map and declaration-bearing renderer tarball grows by 366 bytes to
575,854, so its rounded package ceiling moves from 562 to 563 KiB.

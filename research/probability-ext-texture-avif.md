# Proposal: support the existing `EXT_texture_avif` glTF draft

Status: accepted and implemented as a draft compatibility profile

Consumer: Probability Play (`~/dev/probability/apps/play`)

## Correction and requirement

Probability requires AVIF texture delivery. Transcoding its card and board art
to WebP, PNG, JPEG, Basis, or raw GPU texture storage is not an acceptable
substitute.

`EXT_texture_avif` has not been merged into the Khronos registry, but it was not
rejected. KhronosGroup/glTF PR
[#2235](https://github.com/KhronosGroup/glTF/pull/2235) remains open. The draft
is already implemented by Three.js, Babylon.js, and glTF Transform. Royal
should describe it accurately as an implemented draft extension rather than a
ratified extension or an imaginary format.

The draft follows the established texture-source extension shape:

```json
{
  "extensionsUsed": ["EXT_texture_avif"],
  "extensionsRequired": ["EXT_texture_avif"],
  "images": [{ "uri": "face.avif" }],
  "textures": [
    {
      "extensions": {
        "EXT_texture_avif": { "source": 0 }
      }
    }
  ]
}
```

When a core PNG/JPEG fallback exists, `texture.source` selects it and
`EXT_texture_avif` may remain optional. Without that fallback, the extension is
required.

## Current consumer workaround

Royal already has ordinary browser AVIF decode, dimension inspection, embedded
`image/avif`, and texture lifecycle support. What is missing is glTF source
selection.

Probability currently supplies a custom `GltfResourceReader` which:

1. parses every root before Royal;
2. copies `EXT_texture_avif.source` into the core `texture.source`;
3. removes the extension declarations; and
4. rewrites the GLB JSON chunk.

That adapter adds application code, performs an avoidable root copy, and
misrepresents AVIF as a core glTF image format. Native Royal support should make
the complete adapter deletable.

## Requested behavior

- Recognize `EXT_texture_avif` only at the texture extension placement defined
  by the draft.
- Require its top-level `extensionsUsed` declaration when executed.
- Validate an exact non-negative image `source` index and allow
  `image/avif` for a selected embedded image.
- Resolve external and GLB-embedded AVIF through the ordinary Royal texture
  lifecycle, caching, budgets, diagnostics, and cancellation.
- If AVIF decoding is supported, prefer the extension source over an optional
  core fallback without fetching or decoding both.
- If AVIF decoding is unavailable, use a valid optional core fallback. A
  required AVIF texture must fail explicitly rather than publish knowingly
  incomplete material content.
- Treat failure of a selected, supported AVIF source as an asset failure; do not
  silently retry a fallback after corrupt bytes, HTTP failure, or decode failure.
- Preserve the existing sampler, color-space, alpha, mipmap, resize, upload, and
  residency behavior after source selection.
- Expose the same source-selection and failure evidence as
  `EXT_texture_webp`; do not create a Probability-specific public API.

The parser/source-selection implementation should preferably share one
format-extension mechanism with `EXT_texture_webp` so AVIF adds data and
capability policy rather than a parallel texture pipeline.

## Acceptance evidence

1. External and GLB-embedded AVIF-only fixtures render when
   `EXT_texture_avif` is used and required.
2. An optional AVIF fixture selects AVIF while retaining a valid core PNG/JPEG
   fallback for consumers that do not implement the draft.
3. AVIF decode failure crosses the ordinary bounded asset-failure boundary.
4. Missing declarations, wrong placement, invalid source indices, wrong MIME
   types, and malformed payloads produce bounded path-specific failures.
5. Selection does not fetch both the AVIF and fallback image.
6. Cancellation and source replacement release all ordinary image/decode/upload
   ownership exactly once.
7. Probability deletes its root-rewriting `GltfResourceReader` and sends the
   original glTF/GLB bytes to Royal unchanged.

## Non-goals

- Claiming that the extension is ratified or currently in the Khronos registry.
- Transcoding AVIF to another image format.
- Treating AVIF as a core glTF image format.
- Adding an application-specific `PROBABILITY_*` extension.
- Changing Royal's renderer, shader, material, or GPU texture representation
  beyond ordinary decoded image ingestion.

## Royal decision

Royal implements the exact draft texture-level `{ source }` shape from open
Khronos glTF PR #2235. This is deliberately described as draft compatibility:
the extension is not in the current Khronos registry and has not been ratified.

Source choice is part of the existing pure image planner. The preference order
is available ETC2, AVIF, WebP, then core PNG/JPEG. Optional AVIF requires a core
source for consumers that do not implement the draft; required AVIF may omit
it. Selection returns exactly one source recipe, so transport/decode cannot
fetch both and a corrupt selected AVIF cannot silently change representations
after the fact.

The shipped browser floor (Safari 17 and Quest Chromium) includes AVIF decode,
so Royal does not add a payload probe, startup asset, user-agent branch, or
consumer tuning option. On a browser below that floor, AVIF decode fails through
the ordinary texture lifecycle; Royal does not pretend to detect a capability
it never probes.

External and embedded source selection, exact embedded MIME, declaration,
placement, index, and optional-fallback behavior have focused oracles. Once
selected, the ordinary image reader, cache, decode, budget, upload, failure,
and cancellation lifecycle remains unchanged.

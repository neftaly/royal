# SVG Tiger Demo Provenance

Date: 2026-06-28

## Full Ghostscript Tiger

Status: planned, not vendored in this patch.

The intended full demo source is Wikimedia Commons'
`Ghostscript_Tiger.svg`. Prior Royal SVG research recorded that the file is
derived from GPL Ghostscript's `tiger.eps` and is listed as GNU AGPL v3 or
later. That is acceptable for this AGPL repository when attribution and
provenance travel with the asset.

Do not reuse the full Ghostscript tiger as a permissive standalone fixture. If a
fixture needs to move to another package or another license context, use a
locally authored SVG or a permissive source instead.

When vendoring the full asset, record:

- Download URL and date.
- Upstream source statement.
- Upstream license statement.
- Local byte size.
- Any optimizer command used.
- Hash of the exact committed SVG.

## Fallback Tiny Tiger

File: `fixtures/tiny-tiger.svg`

This is a locally authored fallback fixture created for Royal research. It is a
small tiger-like vector drawing for exercising SVG path extraction and render
acceptance checks. It is covered by this repository's `AGPL-3.0-only` license
and is not derived from the Ghostscript/Inkscape tiger.

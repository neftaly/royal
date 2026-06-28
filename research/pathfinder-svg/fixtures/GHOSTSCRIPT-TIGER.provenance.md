# Ghostscript Tiger Fixture Provenance

Date: 2026-06-28
Verified: 2026-06-28 from Wikimedia Commons

The benchmark harness has a reserved `--fixture tiger` mode for a future
vendored copy of `fixtures/ghostscript-tiger.svg`. The SVG asset is not included
in this patch.

Candidate source:

- Wikimedia Commons: `https://commons.wikimedia.org/wiki/File:Ghostscript_Tiger.svg`
- Listed source: derived from `tiger.eps` from GPL Ghostscript SVN
- Listed license: GNU AGPL v3 or later
- Listed file size: about 67 KB
- Current original file: SVG, nominally 512 x 512 pixels

Before vendoring:

1. Download the original SVG from the source page.
2. Save it as `research/pathfinder-svg/fixtures/ghostscript-tiger.svg`.
3. Preserve attribution and license information in this file or a sidecar notice.
4. Keep the asset out of product packages until the extraction API is promoted
   from research.

The license appears compatible with this AGPL repository, but the asset should
only be committed with this provenance note kept next to it.

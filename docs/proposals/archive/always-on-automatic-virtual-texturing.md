# Always-on automatic virtual texturing

Status: closed. Implemented in `a1b4961d` and included in Royal 0.0.23
(`fd045a7b`). The original rationale and verification plan are retained below;
references to the old application opt-in describe the pre-fix state.

## Decision

Automatic virtual texturing is always enabled. Remove the
`automaticVirtualTexturing` renderer option rather than changing its default or
adding another switch. Automatic VT is a core renderer responsibility, not an
application feature to remember to enable.

## Motivation

Probability passed only `alpha` and `antialias` to Royal 0.0.22. Consequently,
automatic VT was silently off. Its imported Settlers ruler and mat retained
their SVG source, but rendering used fixed-size ordinary textures; zooming did
not generate vector-backed detail. The running renderer confirmed
`automaticEnabled: false` and zero automatic resources.

Probability now explicitly enables the option as a fix for the current release.
That application-side flag should become unnecessary.

## Change

- Remove the option from public and resolved root options, validation, React
  root keys, and internal plumbing. Remove obsolete off-path branches.
- Always run the existing automatic representation policy and preserve SVG
  source authority when it is needed for vector-backed pages.
- Keep the existing eligibility, demand, budgets, eviction, and progressive
  fallback behavior. Always-on **auto** VT does not mean forcing every small
  raster texture into a page atlas.
- Remove the redundant `automaticEnabled` diagnostic. Keep the useful candidate,
  resource, page, failure, and memory counters.
- Update the texture/SVG specs and examples to assume automatic VT. Remove
  explicit flags from applications when upgrading. The existing unknown-option
  validation can reject stale callers; no compatibility mode is needed.

## Verification

With default root options, a small SVG must create vector-backed pages and
request finer detail on zoom. Small raster textures must still use the existing
ordinary representation when appropriate. Existing coverage, transparency,
sampler, budget, and context-restoration tests must continue to pass.

No new API, policy layer, renderer mode, or replacement opt-out.

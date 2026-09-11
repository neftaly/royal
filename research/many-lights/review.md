# Review of the finite large-light stage

Base: Royal 0.0.25, `f017d692a5acf9decfd7d157b7ee327bb04e2236`.
The reviewed implementation includes the finite-light changes and follow-up
fixes in this commit. No new package version is published by these changes.

## Findings addressed

- Shader feature-count fields cannot represent arbitrary larger counts. A
  separate feature bit selects a runtime-count shader family; small keys retain
  their existing representation.
- Imported lights can arrive after a valid zero-light standard scene. Uniform
  lookup now accounts for the uniforms legitimately removed by that shader.
- Capture readiness previously missed lazy light uploads and lazy composition
  helpers when geometry was already retained. These now delay ready publication.
- A valid replacement after a GPU-budget failure could inherit a stale frame
  diagnostic and fail capture before preparing. Capture now attempts preparation
  before accepting a frame failure as current.
- Texture growth must reserve both old and replacement storage, and cold ordinary
  texture fitting must account for that peak. Both reservations are covered.
- Allocation and module completion must respect disposal, replacement, context
  loss and frame admission. Regression tests exercise these transitions, including
  failed replacements and stale asynchronous completions.
- Compressed distributed GLSL removes loop whitespace. The shader adapter handles
  both forms and rejects missing rewrites. Built-package device tests verify the
  actual distributed shader and optional module request.
- Adreno exposed insufficient integer precision in the separate research CSR
  tile-list shader. Explicit high precision fixes dense list offsets. Production
  global light indexing stays within 512 records and does not use these lists.

## Verification

The full suite passes 1,136 tests in 144 files plus the 65-case glTF manifest.
Typecheck, lint, package build, packed consumers, public package imports and
bundle-size gates pass. Browser smoke covers the existing rendering paths.
Built-package large-light integration passes 21 cases on software Chromium and
physical Quest 2, including actual lazy loading and context restoration.

Physical device acceptance and sustained measurements are recorded in README.md
and the adjacent result files. The two 90-minute transport soaks have exact pixel
parity throughout. These are original and comparative rendering tests, not
claims of unlimited real-time rendering.

## Remaining scope

The branch is an intermediate, finite 512-light implementation. Spatial lists
are research only. Representative Play scenes, tracked immersive Quest rendering,
and hardware desktop acceptance remain necessary before accepting the unlimited
architecture. Dense/global work remains expensive, and shadow maps are separate.
The injected iPad fixture does not test network chunk loading or external codecs.


## Subsequent spatial and shader experiments

The full-material UBO and inactive-loop comparisons did not justify changing the
production transport or shader families. Factoring conservative frusta into row,
column and depth tests materially reduced CPU list cost while preserving exact
CSR output and all 216 pixel cases on both devices. The optimized builders remain
outside production; their additional workspace and view invalidation are not yet
integrated into renderer ownership. Research typecheck and the independent and
paired conservative-list tests pass. See README.md for the incomplete long iPad
shader attempt, successful smaller diagnostic and sampling limitations.

## Follow-up adversarial review and fixes

WebGL upload errors are now checked after `texSubImage2D`, before publishing
counts or retiring the previous texture. Initial, replacement and in-place
non-throwing error injections each failed before the fix and pass afterward;
failed replacement claims are released and retries recover.

The CDP and XR runners now create a dedicated target and never select an
existing page. Unsupported target creation fails closed. Cleanup checks that
the owned target disappeared and retries within a bounded window, because
Chromium can acknowledge a close during navigation without closing the tab.
Run and cleanup errors are both retained when both fail.

Follow-up validation: 83 targeted tests pass, as do typecheck, lint, package
build and bundle-size checks. The rebuilt package passes 21 software Chromium
integration cases. An isolated Chromium test preserves an existing page's
unsaved JavaScript state and closes the research page on both success and
failure. The second review covered upload rollback, retry recovery, target
ownership, attachment failures and cleanup races; no further actionable
findings remain in these fixes. Physical devices were not rerun for this
follow-up; the earlier measurements above remain historical evidence.

## Zero-contribution performance follow-up

The integrated scalar gate replaces the experimental loop-level rejection with
reuse of the existing BRDF early return. It preserves reference pixels and the
small-light shader; the built-package and full material comparisons pass. The
review found no new correctness issue in the integrated change. Performance is
a tradeoff: about 17–20% faster sparse/spot Quest shading in the final MSAA
fixture, negligible iPad gain, and approximately 2.5% residual non-MSAA dense
Quest overhead. README.md records final and rejected-candidate evidence; no claim
of universal dense-regression elimination or application frame rate is made.

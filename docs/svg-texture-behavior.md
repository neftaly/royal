# SVG texture behavior

Date: 2026-07-15

SVG is an image source at Royal's ingestion boundary. It is not a virtual
texture mode, a residency policy, or a second material path.

## glTF representation

Core glTF 2.0 permits JPEG and PNG images. Writing `image/svg+xml` directly in
a core `image` is therefore a lenient Royal input, not a portable glTF asset.

Garbo Succus may use `GS_texture_svg` as a vendor extension:

- the core `texture.source` points to a raster PNG/JPEG fallback;
- `texture.extensions.GS_texture_svg.source` points to the preferred SVG;
- the document lists `GS_texture_svg` in `extensionsUsed`, never
  `extensionsRequired`;
- clients that do not understand the extension render the raster fallback;
- Royal lowers the chosen source to its ordinary image-source abstraction.

This is the right forward-compatible shape for an image-format extension. The
`GS` prefix should be registered in the Khronos glTF prefix registry before the
extension is presented as public ecosystem work. If the metadata remains
private and niche, glTF `extras` is legal but offers no portable semantics.

## Security boundary

Royal never inserts loaded SVG markup into the application DOM, `innerHTML`, an
`iframe`, `object`, or `embed`. It supplies SVG as an image to the browser image
decoder and uploads the resulting pixels. SVG's secure image processing mode
disables script execution and external resources.

Canvas is not a sanitizer. It only consumes an already-decoded image, and its
origin-clean flag prevents cross-origin pixel reads; it does not make a custom
regex rewriter correct. Royal must not claim that removing a few element and
attribute spellings makes arbitrary XML safe.

Target policy:

- remove the regex sanitizer;
- do not fetch or inline external SVG dependencies at runtime;
- reject or leave unresolved external dependencies instead of rewriting them;
- flatten external images, nested SVG documents, fonts, and stylesheets in the
  offline Garbo asset pipeline;
- preserve same-document paint-server and fragment references required by
  ordinary standalone SVG artwork;
- keep fetch byte limits, finite viewport validation, abortability, and browser
  decode failure reporting as resource-safety measures, not XSS sanitization.

If Royal ever needs to place SVG markup in the DOM, that is a different feature
and requires an audited SVG-aware sanitizer with its own threat model. The image
path must not be reused for it.

## Nested SVG

The canvas API does not resolve an arbitrary asset dependency graph. It draws
the final browser-decoded image. Royal's current nested-SVG support separately
parses `<image>` tags, resolves relative URLs and `xml:base`, fetches resources,
recurses, detects cycles, rewrites markup, base64-encodes bytes, and caches
dependencies before browser decode. That complexity is why nested external SVG
is expensive despite the final rasterization call being simple.

Runtime nested/external references are out of scope. Standalone SVG containing
its required content, including data URLs where the browser accepts them, is in
scope. The Ghostscript Tiger fixture should be flattened or point directly at
the standalone Tiger asset rather than define product architecture.

## Virtual texturing

SVG remains ordinary raster fallback until VT v2 has a generic page-source
adapter. That adapter may rasterize independent SVG regions, but it receives the
same page requests as raster/KTX sources. No SVG identifiers, branches, caches,
or security decisions belong in VT demand, residency, or shaders.

References:

- [glTF extension mechanics and vendor prefixes](https://github.com/KhronosGroup/glTF/blob/main/extensions/README.md)
- [glTF registered prefixes](https://github.com/KhronosGroup/glTF/blob/main/extensions/Prefixes.md)
- [SVG 2 secure static processing mode](https://www.w3.org/TR/SVG2/conform.html#secure-static-mode)
- [HTML canvas origin-clean security](https://html.spec.whatwg.org/multipage/canvas.html#security-with-canvas-elements)

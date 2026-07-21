# Royal SVG texture oracles

`required-svg-quad.gltf` is the required-form oracle for the experimental,
unregistered `GS_texture_svg` delivery contract. It has no core image source:
Royal must validate and decode the self-contained sRGB SVG or fail the required
extension honestly.

The Ghostscript Tiger example is the optional-form oracle. Its unchanged
upstream SVG is preferred while a 256-pixel raster derivative remains available
to glTF consumers which do not implement the extension. Both forms enter Royal's same
logical ordinary-texture identity, browser decode, automatic-VT, sampler,
material, upload, and draw paths.

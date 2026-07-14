# Lighting behavior

Date: 2026-07-15

Royal owns lighting at the scene boundary. glTF lighting extensions may supply
data, but they do not create a second renderer-wide authority.

## Product promise

- Royal scenes support directional, point, and spot lights.
- A scene may have one environment-light description.
- `studioEnvironment()` is a convenient environment value, not a special
  rendering subsystem.
- Exposure and tone mapping are presentation controls applied coherently to
  direct lights, emissive surfaces, and environment lighting.

`KHR_lights_punctual` lowers directly into Royal light descriptors. It is a
small, ratified interoperability adapter and should stay.

## Image-based light ownership

`EXT_lights_image_based` is real registered multi-vendor glTF, but it is not a
ratified extension. It defines scene-level prefiltered cubemap faces and mips,
diffuse spherical-harmonic coefficients, rotation, and intensity. Its strongest
use is preserving the authored look of a self-contained glTF scene.

Royal commonly composes several glTF assets inside one application scene. An
embedded asset must therefore not silently replace the whole Royal
environment. Royal's existing architecture is:

- keep the decoder isolated as an ingestion adapter;
- lower its value to Royal's canonical environment description;
- scope the imported environment to draws belonging to that glTF asset;
- combine Royal scene punctual lights with asset-local lighting;
- let an explicitly authored Royal scene environment win for every draw;
- never choose between asset environments by load order.

This is the desired wrapper behavior and is a strong reason to keep
`EXT_lights_image_based`: a self-contained glTF scene retains its authored look,
while several glTF assets remain composable. With no Royal scene environment,
each asset may use its own embedded IBL; direct Royal meshes do not implicitly
inherit an arbitrary asset's environment. That can produce deliberately
different lighting between imported assets, but it is deterministic and local.

## Environment representation

The canonical environment should describe intent rather than a particular glTF
layout:

- diffuse irradiance (spherical harmonics or a source that can produce it);
- prefiltered specular radiance;
- intensity and rotation;
- stable content/version identity;
- asynchronous readiness and an ordinary fallback.

An `EXT_lights_image_based` cubemap, an HDR/KTX2 environment, and the studio
preset all lower to this representation. Shaders and frame planning do not know
which adapter supplied it.

## Material consequences

Diffuse transmission is light scattered through an effectively thin surface:
leaves, paper, cloth, or a lampshade. A Lambertian approximation evaluates the
diffuse lobe on the opposite hemisphere, so it is relatively cheap and does
not require the screen-colour copy used by glass-like transmission. Its factor,
colour, and textures remain useful glTF fidelity features.

Dispersion splits transmitted light by wavelength. Royal's current inexpensive
approximation uses the existing transmission screen copy, samples red and blue
at slightly different refractive offsets, and keeps the green sample. It adds
two texture reads only for a dispersion shader variant. This is a sensible
mobile-tier fake, subject to visual and device gates; it is not spectral
rendering and will have screen-space edge/occlusion limitations.

## Acceptance gates

- direct-light unit and attenuation tests;
- reference renders for punctual lights, studio IBL, imported IBL, diffuse
  transmission, and dispersion;
- explicit tests that loading an asset cannot mutate another asset's lighting;
- HDR range, rotation, roughness-mip, and context-restoration tests;
- captured GPU timings on iPad and Quest for each optional material feature.

References:

- [`KHR_lights_punctual`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_lights_punctual)
- [`EXT_lights_image_based`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Vendor/EXT_lights_image_based)
- [`KHR_materials_diffuse_transmission`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_diffuse_transmission)
- [`KHR_materials_dispersion`](https://github.com/KhronosGroup/glTF/tree/main/extensions/2.0/Khronos/KHR_materials_dispersion)

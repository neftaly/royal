# EON rough diffuse BRDF prototype

Research-only TypeScript translation of the BRDF evaluation and directional albedo pieces from:

- Jamie Portsmouth, Peter Kutz, Stephen Hill, "EON: A Practical Energy-Preserving Rough Diffuse BRDF", JCGT 14(1), 116-139, 2025: <https://jcgt.org/published/0014/01/06/>
- arXiv mirror, including the self-contained GLSL listing used for this prototype: <https://arxiv.org/abs/2410.18026>

This is intentionally not wired into Royal's production shaders. Royal does not yet have a first-class roughness parameter on `standardMaterial`, so the prototype stays isolated while the material API shape is still unresolved.

## Scope

`eon.ts` implements:

- Lambert baseline for the smooth comparison.
- Fujii Oren-Nayar directional and average albedo helpers.
- EON BRDF evaluation from the paper's Listing 1.
- EON directional albedo and a small deterministic projected-solid-angle integrator for tests.

The implementation assumes local-space directions with `z` aligned to the surface normal and both `wi` and `wo` in the positive hemisphere, matching the paper listing. RGB `rho` is treated as the single-scattering albedo parameter and roughness `r` is clamped to `[0, 1]`.

## Formula Notes

The constants are taken from the paper's GLSL listing:

- `constant1_FON = 0.5 - 2 / (3*pi)`
- `constant2_FON = 2/3 - 28 / (15*pi)`
- approximate `G_F/pi` coefficients: `0.0571085289`, `0.491881867`, `-0.332181442`, `0.0714429953`

For `E_FON_exact(mu, r)` at `mu = 0`, the direct expression has a removable singularity. The prototype uses the paper's stated grazing limit for `G_q` and the FON relation `G_F = G_q - 2/3 sin(theta)`, giving `G_F(0) = pi/2 - 2/3`.

The multiple-scattering term follows Listing 1's small epsilon clamp to avoid division by zero in the smooth Lambertian limit.

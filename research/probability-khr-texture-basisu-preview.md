# Probability `KHR_texture_basisu` preview decision

Status: reviewed and rejected for the current Royal runtime on 2026-07-25.

## Decision

`KHR_texture_basisu` is a ratified, portable glTF extension, and composing it
with a lower `MSFT_lod` material is standards-shaped. Its semantics are not the
problem. A conforming browser implementation must transcode ETC1S/UASTC into a
GPU format supported by the active device; raw ETC2 KTX2 is not a shortcut.
The [Khronos specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_texture_basisu/README.md)
assigns that runtime transcode to engines.

Royal's installed reference transcoder is a useful size floor, not a selected
dependency: its WASM is 472,914 bytes raw and 223,351 bytes gzip, with another
16,741 bytes gzip of JavaScript glue. That approaches Royal's entire deployed
JavaScript graph before adding validation, capability selection, worker
ownership, cancellation, CPU-memory accounting, context restoration and
multiple output profiles. It conflicts with the current no-runtime-WASM,
small-package and simple Safari 17/Quest 2 startup direction.

The proposed preview also lacks scheduling evidence. A 128-pixel JPEG lower
material exercised Royal's existing material-LOD path correctly, but its
complete preview arrived 193 ms after the original AVIF had already reached
final pixels and delayed exact-final by 451 ms. Basis may reduce representation
cost; support alone would not fix discovery and priority competition.

## Reconsideration gate

Reconsider only with all of:

- representative standards-valid ETC1S/UASTC assets with offline mips;
- a materially smaller Safari 17/Quest 2-compatible lazy transcoder;
- a lower-material scheduling experiment that beats the no-preview baseline;
- deployed, peak CPU/transcode and retained GPU byte measurements;
- cancellation and context-restoration evidence; and
- a general workload beyond Probability that justifies the runtime surface.

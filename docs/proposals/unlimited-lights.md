# Unlimited authored lights

Status: active implementation and research, 2026-09-11. The working branch adds a
lazy global texture path with a finite 512-light combined ceiling. Royal 0.0.25
still has the four-directional/eight-local limits. The unlimited architecture
remains open; spatial acceleration is not integrated or accepted.

See [device evidence and implementation review](../../research/many-lights/README.md)
for physical A10 Safari and Quest 2 comparisons, exactness checks, lifecycle tests
and remaining acceptance work.

## Goal and meaning of unlimited

Remove the small fixed scene-authoring limit so applications can preserve all
lights from arbitrary glTF models and repeated instances alongside application
lighting. Do not fail an otherwise valid scene merely because a fifth directional
light arrives asynchronously.

“Unlimited” means no small renderer constant in the authoring contract. It cannot
mean infinite memory, constant frame time, or every finite scene fitting every
GPU. The implementation must publish device/budget limits and define exhaustion
behavior. Investigate exact light composition first; do not silently drop lights,
change them to ambient, or hide a fixed per-tile cutoff behind a larger global list.

Play provides three directional lights. A glTF with two more exceeds today's
limit; repeated lit models amplify the problem. The implemented
[`importLights: false`](archive/composed-directional-light-budget.md) option, now adopted by the linked Play checkout, solves
intentional use of application lighting, but does not solve preserving every
embedded light. Onboarding's current seven catalog models contain no embedded
lights and do not justify this architecture on their own.

## Working target and optional loading

Target at least 256 authored lights, including directional and mixed scenes.
Prefer a lazily loaded large-light module while ordinary scenes retain the
existing small path. This is a requested implementation target, not a supported
limit or an accepted architecture. Measure the small-path bundle and runtime
cost, first-use preparation, shared shader/material code and lifecycle behavior.
If an optional split duplicates rendering ownership or harms correctness, a
single shared implementation may be preferable. No lazy-loading requirement
justifies dropping lights while the module prepares.

## Original constraints and current branch changes

- `surface/scene-lowering.ts` now validates 512 combined lights on the working
  branch, including imported lights expanded through model/instance transforms.
- `surface/light-uniform-packing.ts` retains the original small uniform arrays;
  the lazy runtime owns larger texture storage.
- `surface/surface-program-features.ts` packs exact directional/local counts into
  three/four bits. Simply raising the directional constant to eight corrupts
  that representation by overlapping the local-light count field. The working
  branch uses a separate large-light feature flag instead.
- `surface/surface-program-owner.ts` specializes fragment shaders for exact counts;
  `webgl/shaders/surface.frag` evaluates each light for each shaded fragment. The
  larger texture path keeps one count-independent shader family.
- Render-object handles and bulk-instance updates retain bindings into light
  arrays. A new storage plan must preserve ownership and update semantics.

All paths are under `packages/renderer-webgl/src`. Benchmark these layers
separately; a count-validation change is not proof of scalable rendering.

## Competing approaches

| Approach | What to investigate | Main limitation |
| --- | --- | --- |
| Dynamic global light storage and loops | Grow bounded storage from live demand; compare supported uniform/data-texture representations and a small set of shader families | Every directional/global light still contributes fragment work; transport limits and driver loop behavior need device evidence |
| Forward+ or clustered forward for local lights | Build conservative tile/cluster lists and reuse the existing material path | List construction, upload, overflow and transparent geometry must remain correct; dense overlap can put every light in every list |
| Exact multipass light accumulation | Process light batches without one monolithic uniform array | Repeated geometry/bandwidth, blending precision and correct material composition may outweigh the benefit |
| Hybrid | Keep a global list for directional/unbounded lights and spatial lists for bounded local lights | Added state and ownership must earn their cost on Royal workloads |

Forward+ restricts each pixel's loop using tile-local light lists; AMD's reference
implementation builds those lists using compute shaders. Royal needs a design
that actually fits its supported WebGL2/device path, not a direct assumption that
that compute implementation is available. Compare CPU-built lists or other legal
implementations before proposing a backend change.
[AMD Forward+ reference](https://gpuopen.com/learn/forwardplus11-directx-11-sdk-sample/).

Directional lights affect the whole scene, so spatial lists cannot generally
remove their evaluations. Also, glTF point/spot `range` is optional: absent range
means infinite reach under inverse-square attenuation. A convenient finite
influence radius would therefore be an approximation unless explicitly justified
by a separate accepted error policy. This prevents treating every imported light
as cheaply bounded.
[KHR_lights_punctual specification](https://github.com/KhronosGroup/glTF/blob/main/extensions/2.0/Khronos/KHR_lights_punctual/README.md).

For multipass experiments, apply environment and emissive contributions once,
and tone mapping/output conversion after accumulation. Prove alpha blending,
transmission/volume, depth, MSAA and overlapping surfaces rather than assuming
ordinary additive framebuffer blending preserves Royal's material contract.
Shadow support is separate work; unlimited lights must not implicitly promise
unlimited shadow maps.

## Experiments and acceptance

1. Establish the existing 0–4 directional and 0–8 local-light baselines. Build
   independent exact-reference fixtures before changing storage or shader keys.
2. Compare at least a dynamic/global prototype and a spatial local-light
   prototype. Include 0, 1, 3, 4, 5, 8, 16, 64 and 256 lights, then a deliberate
   resource-exhaustion case. These are experiment counts, not proposed ceilings.
3. Separate global directional, bounded point/spot, missing-range local, mixed,
   sparse and fully overlapping cases. Include repeated shared glTF assets,
   asynchronous completion in different orders, replacement/removal and large
   numbers of instances.
4. Preserve source preparation/resource sharing, transformed lights, picking,
   render-object handles, bulk pose updates, material variants, secondary roots,
   context restoration and XR view consistency. Keep canonical light identity
   independent of packed storage and completion order.
5. Measure CPU list construction, upload bytes, retained/peak memory, shader
   preparation, variant counts, GPU time where supported, frame median/p95,
   package size and no-light/small-scene regressions. Report instrumentation cost.
6. Run on physical A10 Safari, hardware-accelerated desktop and Quest 2. Software
   rendering and mocked GL tests establish neither useful throughput nor a new
   supported limit.
7. Define list/storage overflow and allocation failure before rollout. An exact
   fallback may split work; if the device cannot complete the request, report the
   specific limit without silently changing the light set. Preserve the last
   valid presentation and deterministic recovery where feasible.

Accept an architecture only after demonstrating correct composition beyond the
old limits, explicit exhaustion behavior and useful measured costs. Retaining the
small-count path may be appropriate if it stays one coherent renderer with shared
material, resource and lifecycle ownership. Do not introduce Play-only light rules
or require consumers to choose rendering architectures.

The branch's automatic 512-light texture path is an intermediate implementation,
not resolution of unbounded scene authoring. The next architecture decision is
whether conservative spatial lists earn their CPU, upload and maintenance costs
on representative scenes. Dense/global cost and explicit failure remain part of
that decision.


Physical acceptance now passes 326 cases on each A10 iPad and Quest 2, and both
90-minute transport soaks retain exact parity. Full-renderer frame pacing on the
A10 remains too slow for large globally shaded scenes. The finite path stays a
draft: compare the measured two-block UBO alternative and integrate conservative
spatial lists before treating 256+ as a practical real-time target. Actual tracked
immersive acceptance is still outstanding; the connected headset's tracking
prompt prevented its session request from completing.

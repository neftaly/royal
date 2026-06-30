import {
  boxGeometry,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  scene,
  solidTexture,
  standardMaterial,
  textureAsset,
  unlitMaterial,
  virtualTextureAsset,
  wireframeMaterial,
  type Geometry
} from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import {
  createBoxMeshBufferShape,
  createMaterialBindingShape,
  createWebGpuSceneProbe,
  type WebGpuSceneProbeDiagnostic
} from "../src/scene-probe";
import type { RendererProbeSnapshot, RoyalRendererFeature } from "../src/capabilities";

const camera = orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1
});

const snapshot = (
  webgpuFeatures: readonly RoyalRendererFeature[] = [
    "compute-pass",
    "indexed-geometry",
    "instancing",
    "readback-buffer",
    "storage-buffer",
    "texture-asset",
    "uint32-indices"
  ]
): RendererProbeSnapshot => ({
  webgl2: {
    diagnostics: [],
    features: new Set([
      "indexed-geometry",
      "instancing",
      "readback-buffer",
      "texture-asset",
      "uint32-indices"
    ]),
    kind: "webgl2_capability_probe",
    status: "available"
  },
  webgpu: {
    adapterStatus: "available",
    deviceStatus: "not-requested",
    diagnostics: [],
    features: new Set(),
    kind: "webgpu_capability_probe",
    limits: {},
    royalFeatures: new Set(webgpuFeatures)
  }
});

describe("WebGPU scene probe", () => {
  it("lowers a Royal box mesh into explicit buffer and material shapes", () => {
    const baseColor = solidTexture({ color: [0.1, 0.2, 0.3, 1], colorSpace: "linear" });
    const root = scene({
      children: [pass({
        camera,
        children: [mesh({
          geometry: boxGeometry({ size: [1, 2, 3] }),
          material: unlitMaterial({ baseColor })
        })],
        clearColor: [0, 0, 0, 1]
      })]
    });
    const probe = createWebGpuSceneProbe(root, {
      capabilities: snapshot(),
      request: { backend: "webgpu" }
    });

    expect(probe.kind).toBe("webgpu_scene_probe");
    expect(probe.backend).toMatchObject({
      backend: "webgpu",
      status: "ready"
    });
    expect(probe.buffers).toEqual([createBoxMeshBufferShape([1, 2, 3], "mesh-buffer:0:0")]);
    expect(probe.materials).toEqual([{
      baseColor: {
        color: [0.1, 0.2, 0.3, 1],
        colorSpace: "linear",
        kind: "inline-color"
      },
      bindings: [{
        binding: 0,
        group: 0,
        label: "material-uniforms",
        minBindingSize: 16,
        resource: "uniform-buffer"
      }],
      id: "material:0:0",
      materialKind: "unlit",
      pipelineVariant: "unlit",
      requirements: []
    }]);
    expect(probe.draws).toEqual([{
      bufferId: "mesh-buffer:0:0",
      materialId: "material:0:0",
      nodeIndex: 0,
      passIndex: 0,
      requirements: ["indexed-geometry", "uint32-indices"]
    }]);
    expect(probe.requiredFeatures).toEqual(["indexed-geometry", "uint32-indices"]);
    expect(probe.diagnostics).toEqual([]);
  });

  it("keeps texture asset upload pressure visible on the material shape", () => {
    const fallback = solidTexture({ color: [1, 0, 1, 1], id: "fallback-magenta" });
    const material = standardMaterial({
      baseColor: textureAsset({
        colorSpace: "srgb",
        fallback,
        id: "albedo",
        uri: "/textures/albedo.png"
      })
    });
    const diagnostics: WebGpuSceneProbeDiagnostic[] = [];
    const shape = createMaterialBindingShape(material, "material:asset", {}, diagnostics);

    expect(shape).toEqual({
      baseColor: {
        colorSpace: "srgb",
        fallbackColor: [1, 0, 1, 1],
        id: "albedo",
        kind: "texture-asset",
        uri: "/textures/albedo.png"
      },
      bindings: [
        {
          binding: 0,
          group: 0,
          label: "material-uniforms",
          minBindingSize: 16,
          resource: "uniform-buffer"
        },
        {
          binding: 1,
          group: 0,
          label: "base-color-texture",
          resource: "texture"
        },
        {
          binding: 2,
          group: 0,
          label: "base-color-sampler",
          resource: "sampler"
        }
      ],
      id: "material:asset",
      materialKind: "standard",
      pipelineVariant: "standard",
      requirements: ["texture-asset"]
    });
    expect(diagnostics).toEqual([expect.objectContaining({
      code: "asset_texture_loader_required"
    })]);
  });

  it("reports virtual texture assets as fallback-only pending descriptors", () => {
    const material = standardMaterial({
      baseColor: virtualTextureAsset({
        colorSpace: "srgb",
        fallback: solidTexture({ color: [0.35, 0.4, 0.45, 1] }),
        id: "terrain-vt",
        manifestId: "terrain-manifest",
        manifestUri: "/textures/terrain.vt.json",
        preview: textureAsset({
          fallback: solidTexture({ color: [0.15, 0.2, 0.25, 1] }),
          id: "terrain-preview",
          uri: "/textures/terrain-preview.png"
        })
      })
    });
    const diagnostics: WebGpuSceneProbeDiagnostic[] = [];
    const shape = createMaterialBindingShape(material, "material:virtual-asset", {}, diagnostics);

    expect(shape).toEqual({
      baseColor: {
        colorSpace: "srgb",
        fallbackColor: [0.35, 0.4, 0.45, 1],
        id: "terrain-vt",
        kind: "virtual-texture-asset",
        manifestId: "terrain-manifest",
        manifestUri: "/textures/terrain.vt.json",
        previewId: "terrain-preview",
        previewUri: "/textures/terrain-preview.png"
      },
      bindings: [
        {
          binding: 0,
          group: 0,
          label: "material-uniforms",
          minBindingSize: 16,
          resource: "uniform-buffer"
        }
      ],
      id: "material:virtual-asset",
      materialKind: "standard",
      pipelineVariant: "standard",
      requirements: []
    });
    expect(diagnostics).toEqual([expect.objectContaining({
      code: "virtual_texture_lowering_required"
    })]);
  });

  it("uses default grey for virtual texture assets without declared fallback", () => {
    const material = standardMaterial({
      baseColor: virtualTextureAsset({
        id: "terrain-vt",
        manifestUri: "/textures/terrain.vt.json"
      })
    });
    const diagnostics: WebGpuSceneProbeDiagnostic[] = [];
    const shape = createMaterialBindingShape(material, "material:virtual-asset", {}, diagnostics);

    expect(shape.baseColor).toEqual({
      colorSpace: "srgb",
      fallbackColor: [0.5, 0.5, 0.5, 1],
      id: "terrain-vt",
      kind: "virtual-texture-asset",
      manifestUri: "/textures/terrain.vt.json"
    });
    expect(shape.bindings).toHaveLength(1);
    expect(shape.requirements).toEqual([]);
  });

  it("reports unsupported Royal descriptors instead of silently accepting them", () => {
    const customGeometry = { kind: "custom-surface" } satisfies Geometry<"custom-surface">;
    const root = scene({
      children: [pass({
        camera,
        children: [
          mesh({
            geometry: customGeometry,
            material: wireframeMaterial({
              baseColor: solidTexture({ color: [1, 1, 1, 1] })
            })
          }),
          gltf({
            asset: {
              id: "helmet",
              uri: "/DamagedHelmet/DamagedHelmet.gltf"
            }
          })
        ]
      })]
    });
    const probe = createWebGpuSceneProbe(root, {
      capabilities: snapshot(),
      request: { backend: "webgpu" }
    });

    expect(probe.buffers).toEqual([]);
    expect(probe.draws).toEqual([]);
    expect(probe.diagnostics).toEqual([
      {
        code: "unsupported_geometry",
        message: "Geometry kind \"custom-surface\" needs an explicit buffer/asset lowering contract before WebGPU upload.",
        nodeIndex: 0,
        passIndex: 0,
        severity: "error"
      },
      {
        code: "gltf_loader_required",
        message: "glTF nodes require an asset loader and primitive lowering before a WebGPU renderer can draw them.",
        nodeIndex: 1,
        passIndex: 0,
        severity: "warning"
      }
    ]);
  });
});

import {
  defaultTextureFallbackColor,
  type Material,
  type MeshNode,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextureRef,
  type Vec3
} from "@royal/renderer-core";
import {
  chooseRendererBackend,
  type RendererBackendChoice,
  type RendererBackendRequest,
  type RendererProbeSnapshot,
  type RoyalRendererFeature
} from "./capabilities";

export type WebGpuSceneProbeDiagnosticCode =
  | "asset_texture_loader_required"
  | "gltf_loader_required"
  | "material_pipeline_variant_required"
  | "text_lowering_required"
  | "unsupported_geometry"
  | "virtual_texture_lowering_required";

export type WebGpuSceneProbeDiagnostic = {
  readonly code: WebGpuSceneProbeDiagnosticCode;
  readonly message: string;
  readonly nodeIndex?: number | undefined;
  readonly passIndex?: number | undefined;
  readonly severity: "info" | "warning" | "error";
};

export type WebGpuBufferAttributeShape = {
  readonly format: "float32x2" | "float32x3" | "float32x4";
  readonly offset: number;
  readonly semantic: "normal" | "position" | "uv";
  readonly shaderLocation: number;
};

export type WebGpuMeshBufferShape = {
  readonly attributes: readonly WebGpuBufferAttributeShape[];
  readonly id: string;
  readonly indexCount: number;
  readonly indexFormat: "uint16" | "uint32";
  readonly requirements: readonly RoyalRendererFeature[];
  readonly source: {
    readonly geometryKind: string;
    readonly lowering: "builtin-box";
    readonly size: Vec3;
  };
  readonly topology: "triangle-list";
  readonly vertexCount: number;
  readonly vertexStride: number;
};

export type WebGpuUniformBindingShape = {
  readonly binding: number;
  readonly group: number;
  readonly label: string;
  readonly minBindingSize: number;
  readonly resource: "uniform-buffer";
};

export type WebGpuTextureBindingShape = {
  readonly binding: number;
  readonly group: number;
  readonly label: string;
  readonly resource: "sampler" | "texture";
};

export type WebGpuBufferBindingShape = WebGpuTextureBindingShape | WebGpuUniformBindingShape;

export type WebGpuMaterialBaseColorShape =
  | {
      readonly color: Rgba;
      readonly colorSpace: "linear" | "srgb";
      readonly kind: "inline-color";
    }
  | {
      readonly colorSpace: "linear" | "srgb";
      readonly fallbackColor?: Rgba | undefined;
      readonly id: string;
      readonly kind: "texture-asset";
      readonly uri: string;
    }
  | {
      readonly colorSpace: "linear" | "srgb";
      readonly fallbackColor: Rgba;
      readonly id: string;
      readonly kind: "virtual-texture-asset";
      readonly manifestId?: string | undefined;
      readonly manifestUri: string;
      readonly previewId?: string | undefined;
      readonly previewUri?: string | undefined;
    };

export type WebGpuMaterialBindingShape = {
  readonly baseColor: WebGpuMaterialBaseColorShape;
  readonly bindings: readonly WebGpuBufferBindingShape[];
  readonly id: string;
  readonly materialKind: Material["kind"];
  readonly pipelineVariant: "standard" | "unlit" | "wireframe";
  readonly requirements: readonly RoyalRendererFeature[];
};

export type WebGpuDrawProbe = {
  readonly bufferId: string;
  readonly materialId: string;
  readonly nodeIndex: number;
  readonly passIndex: number;
  readonly requirements: readonly RoyalRendererFeature[];
};

export type WebGpuSceneProbeOptions = {
  readonly capabilities: RendererProbeSnapshot;
  readonly request?: RendererBackendRequest | undefined;
};

export type WebGpuSceneProbeResult = {
  readonly backend: RendererBackendChoice;
  readonly buffers: readonly WebGpuMeshBufferShape[];
  readonly diagnostics: readonly WebGpuSceneProbeDiagnostic[];
  readonly draws: readonly WebGpuDrawProbe[];
  readonly kind: "webgpu_scene_probe";
  readonly materials: readonly WebGpuMaterialBindingShape[];
  readonly passCount: number;
  readonly requiredFeatures: readonly RoyalRendererFeature[];
};

const BOX_BUFFER_REQUIREMENTS = [
  "indexed-geometry",
  "uint32-indices"
] as const satisfies readonly RoyalRendererFeature[];

export const createWebGpuSceneProbe = (
  root: RenderRoot,
  options: WebGpuSceneProbeOptions
): WebGpuSceneProbeResult => {
  const diagnostics: WebGpuSceneProbeDiagnostic[] = [];
  const buffers: WebGpuMeshBufferShape[] = [];
  const materials: WebGpuMaterialBindingShape[] = [];
  const draws: WebGpuDrawProbe[] = [];
  const requiredFeatures = new Set<RoyalRendererFeature>(options.request?.requiredFeatures ?? []);

  root.children.forEach((renderPass, passIndex) => {
    renderPass.children.forEach((node, nodeIndex) => {
      switch (node.kind) {
        case "directional-light":
          break;
        case "gltf":
          diagnostics.push({
            code: "gltf_loader_required",
            message: "glTF nodes require an asset loader and primitive lowering before a WebGPU renderer can draw them.",
            nodeIndex,
            passIndex,
            severity: "warning"
          });
          break;
        case "mesh":
          {
            const buffer = meshBufferShape(node, passIndex, nodeIndex, diagnostics);
            if (buffer === undefined) break;

            const material = createMaterialBindingShape(
              node.material,
              `material:${passIndex}:${nodeIndex}`,
              { nodeIndex, passIndex },
              diagnostics
            );
            buffers.push(buffer);
            materials.push(material);
            const drawRequirements = uniqueFeatures([
              ...buffer.requirements,
              ...material.requirements
            ]);
            for (const feature of drawRequirements) requiredFeatures.add(feature);
            draws.push({
              bufferId: buffer.id,
              materialId: material.id,
              nodeIndex,
              passIndex,
              requirements: drawRequirements
            });
          }
          break;
        case "text":
          diagnostics.push({
            code: "text_lowering_required",
            message: "Text nodes require glyph atlas or vector outline lowering before a WebGPU renderer can draw them.",
            nodeIndex,
            passIndex,
            severity: "warning"
          });
          break;
        default:
          assertNever(node);
      }
    });
  });

  const combinedRequest = options.request === undefined
    ? { requiredFeatures: uniqueFeatures([...requiredFeatures]) }
    : {
        ...options.request,
        requiredFeatures: uniqueFeatures([...requiredFeatures])
      } satisfies RendererBackendRequest;
  const backend = chooseRendererBackend(options.capabilities, combinedRequest);

  return {
    backend,
    buffers,
    diagnostics,
    draws,
    kind: "webgpu_scene_probe",
    materials,
    passCount: root.children.length,
    requiredFeatures: combinedRequest.requiredFeatures
  };
};

export const createBoxMeshBufferShape = (
  size: Vec3,
  id = "box:0"
): WebGpuMeshBufferShape => ({
  attributes: [
    {
      format: "float32x3",
      offset: 0,
      semantic: "position",
      shaderLocation: 0
    },
    {
      format: "float32x3",
      offset: 12,
      semantic: "normal",
      shaderLocation: 1
    },
    {
      format: "float32x2",
      offset: 24,
      semantic: "uv",
      shaderLocation: 2
    }
  ],
  id,
  indexCount: 36,
  indexFormat: "uint16",
  requirements: BOX_BUFFER_REQUIREMENTS,
  source: {
    geometryKind: "box",
    lowering: "builtin-box",
    size
  },
  topology: "triangle-list",
  vertexCount: 24,
  vertexStride: 32
});

export const createMaterialBindingShape = (
  material: Material,
  id = "material:0",
  source: { readonly nodeIndex?: number; readonly passIndex?: number } = {},
  diagnostics: WebGpuSceneProbeDiagnostic[] = []
): WebGpuMaterialBindingShape => {
  const requirements = new Set<RoyalRendererFeature>();
  const bindings: WebGpuBufferBindingShape[] = [
    {
      binding: 0,
      group: 0,
      label: "material-uniforms",
      minBindingSize: material.kind === "wireframe" ? 32 : 16,
      resource: "uniform-buffer"
    }
  ];
  const baseColor = baseColorShape(material.baseColor, source, diagnostics);

  if (baseColor.kind === "texture-asset") {
    requirements.add("texture-asset");
    bindings.push(
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
    );
  }

  if (material.kind === "wireframe") {
    diagnostics.push({
      code: "material_pipeline_variant_required",
      message: "Wireframe material needs a backend-owned pipeline variant instead of a material-only switch.",
      ...source,
      severity: "info"
    });
  }

  return {
    baseColor,
    bindings,
    id,
    materialKind: material.kind,
    pipelineVariant: material.kind,
    requirements: uniqueFeatures([...requirements])
  };
};

const meshBufferShape = (
  node: MeshNode,
  passIndex: number,
  nodeIndex: number,
  diagnostics: WebGpuSceneProbeDiagnostic[]
): WebGpuMeshBufferShape | undefined => {
  if (!isBoxGeometry(node.geometry)) {
    diagnostics.push({
      code: "unsupported_geometry",
      message: `Geometry kind "${node.geometry.kind}" needs an explicit buffer/asset lowering contract before WebGPU upload.`,
      nodeIndex,
      passIndex,
      severity: "error"
    });
    return undefined;
  }

  return createBoxMeshBufferShape(node.geometry.size, `mesh-buffer:${passIndex}:${nodeIndex}`);
};

const baseColorShape = (
  texture: TextureRef,
  source: { readonly nodeIndex?: number; readonly passIndex?: number },
  diagnostics: WebGpuSceneProbeDiagnostic[]
): WebGpuMaterialBaseColorShape => {
  if (texture.kind === "solid") {
    return {
      color: texture.color,
      colorSpace: texture.colorSpace ?? "linear",
      kind: "inline-color"
    };
  }

  if (texture.kind === "virtual-asset") {
    diagnostics.push({
      code: "virtual_texture_lowering_required",
      message: "Virtual texture base color needs manifest/page-table lowering; the probe uses only its fallback color for now.",
      ...source,
      severity: "warning"
    });

    return {
      colorSpace: texture.colorSpace ?? "srgb",
      fallbackColor: texture.fallback?.color ?? texture.preview?.fallback?.color ?? defaultTextureFallbackColor,
      id: texture.id,
      kind: "virtual-texture-asset",
      ...(texture.manifestId === undefined ? {} : { manifestId: texture.manifestId }),
      manifestUri: texture.manifestUri,
      ...(texture.preview === undefined
        ? {}
        : {
          previewId: texture.preview.id,
          previewUri: texture.preview.uri
        })
    };
  }

  diagnostics.push({
    code: "asset_texture_loader_required",
    message: "Texture asset base color needs async image decode/upload; the probe can only describe the binding shape.",
    ...source,
    severity: "warning"
  });

  return {
    colorSpace: texture.colorSpace ?? "srgb",
    ...(texture.fallback === undefined ? {} : { fallbackColor: texture.fallback.color }),
    id: texture.id,
    kind: "texture-asset",
    uri: texture.uri
  };
};

const isBoxGeometry = (
  geometry: MeshNode["geometry"]
): geometry is MeshNode["geometry"] & { readonly kind: "box"; readonly size: Vec3 } => {
  const maybeGeometry = geometry as { readonly size?: unknown };
  return geometry.kind === "box" && isVec3(maybeGeometry.size);
};

const isVec3 = (value: unknown): value is Vec3 => {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === "number" && Number.isFinite(entry));
};

const uniqueFeatures = (
  features: readonly RoyalRendererFeature[]
): readonly RoyalRendererFeature[] => {
  return [...new Set(features)].sort();
};

const assertNever = (value: never): never => {
  throw new Error(`Unsupported render node kind: ${String((value as RenderNode).kind)}`);
};

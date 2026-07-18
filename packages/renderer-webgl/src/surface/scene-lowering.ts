import type {
  Direction3,
  GltfNode,
  LinearRgba,
  MeshNode,
  RenderRoot,
} from "@royal/renderer-core";
import {
  identityMat4,
  inverseMat4,
  multiplyMat4Into,
  transformMat4,
  type Mat4,
} from "../math/mat4";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import {
  prepareCanonicalMaterial,
  resolveCanonicalMaterialTexture,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";
import {
  prepareCanonicalGeometry,
  type CanonicalTriangleGeometry,
} from "./canonical-geometry";
import type { CanonicalCamera } from "./camera-source-owner";
import type { DecodedTextureSource } from "../texture/asset-owner";
import type { TextureSourceRef } from "../texture/asset-owner";

export type CanonicalDrawSurface = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instances?: Readonly<{
    count: number;
    key: string;
    localModels: Float32Array;
  }>;
  material: CanonicalSurfaceMaterial;
  model: Mat4;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode;
}>;

export type CanonicalPickSurface = Readonly<{
  inverseModel: Mat4 | undefined;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

export type CanonicalSurfaceScene = Readonly<{
  camera: CanonicalCamera;
  directionalLights: readonly CanonicalDirectionalLight[];
  exposure: number;
  gltfNodes: readonly GltfNode[];
  pickSurfaces: readonly CanonicalPickSurface[];
  surfaces: readonly CanonicalDrawSurface[];
  textureAssets: readonly TextureSourceRef[];
  toneMapping: "linear-clamp" | "pbr-neutral";
}>;

export type CanonicalDirectionalLight = Readonly<{
  color: LinearRgba;
  direction: Direction3;
}>;

export const MAX_CANONICAL_DIRECTIONAL_LIGHTS = 4;

const modelHandedness = (model: Mat4): 1 | -1 => {
  const determinant = model[0] * (model[5] * model[10] - model[6] * model[9])
    - model[4] * (model[1] * model[10] - model[2] * model[9])
    + model[8] * (model[1] * model[6] - model[2] * model[5]);
  return determinant < 0 ? -1 : 1;
};

const mat4At = (values: Float32Array, offset: number): Mat4 => [
  values[offset]!, values[offset + 1]!, values[offset + 2]!, values[offset + 3]!,
  values[offset + 4]!, values[offset + 5]!, values[offset + 6]!, values[offset + 7]!,
  values[offset + 8]!, values[offset + 9]!, values[offset + 10]!, values[offset + 11]!,
  values[offset + 12]!, values[offset + 13]!, values[offset + 14]!, values[offset + 15]!,
];

const staticCamera = (scene: RenderRoot): CanonicalCamera => {
  if (scene.camera.kind === "perspective-camera" || scene.camera.kind === "orthographic-camera") {
    return scene.camera;
  }
  throw new Error("Royal direct-surface slice does not yet support camera view resources");
};

const sceneExposure = (scene: RenderRoot): number => scene.exposureEv100 === undefined
  ? 1 / 1.2
  : 1 / (1.2 * 2 ** scene.exposureEv100);

/** Validates and lowers a complete direct scene before any GL resource work. */
export const prepareCanonicalSurfaceScene = (
  scene: RenderRoot,
  preparedGltf: (node: GltfNode) => PreparedStaticGltf | undefined = () => undefined,
  camera: CanonicalCamera = staticCamera(scene),
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined = () => undefined,
): CanonicalSurfaceScene => {
  let requiresLighting = false;
  for (const node of scene.nodes) {
    if (node.kind === "gltf" || (node.kind === "mesh" && node.material.kind === "standard")) {
      requiresLighting = true;
      break;
    }
  }
  if (requiresLighting && scene.environment !== undefined) {
    throw new Error("Royal canonical surface slice does not yet support scene environments");
  }
  const directionalLights: CanonicalDirectionalLight[] = [];
  const gltfNodes: GltfNode[] = [];
  const pickSurfaces: CanonicalPickSurface[] = [];
  const surfaces: CanonicalDrawSurface[] = [];
  const textureAssets: TextureSourceRef[] = [];
  for (const node of scene.nodes) {
    if (node.kind === "gltf") {
      gltfNodes.push(node);
      if (node.materialVariant !== undefined) {
        throw new Error("Royal static glTF slice does not yet support materialVariant");
      }
      const rootModel = transformMat4(node.transform);
      const proxyGeometry = node.pickingGeometry === undefined
        ? undefined
        : prepareCanonicalGeometry(node.pickingGeometry);
      if (proxyGeometry !== undefined) {
        pickSurfaces.push({
          inverseModel: inverseMat4(rootModel),
          modelHandedness: modelHandedness(rootModel),
          node,
          pickingGeometry: proxyGeometry,
        });
      }
      const prepared = preparedGltf(node);
      if (prepared === undefined) continue;
      textureAssets.push(...prepared.textureAssets);
      for (const primitive of prepared.primitives) {
        const instanceBatch = primitive.instanceBatch;
        const model = instanceBatch === undefined
          ? multiplyMat4Into(identityMat4(), rootModel, primitive.localModel)
          : rootModel;
        const surface: CanonicalDrawSurface = {
          geometry: primitive.geometry,
          ...(instanceBatch === undefined ? {} : {
            instances: {
              count: instanceBatch.localModels.length / 16,
              key: instanceBatch.key,
              localModels: instanceBatch.localModels,
            },
          }),
          material: resolveCanonicalMaterialTexture(primitive.material, decodedTexture),
          model,
          modelHandedness: instanceBatch === undefined
            ? modelHandedness(model)
            : (modelHandedness(rootModel) * instanceBatch.handedness) as 1 | -1,
          node,
        };
        if (proxyGeometry === undefined) {
          if (instanceBatch === undefined) {
            pickSurfaces.push({
              inverseModel: inverseMat4(model),
              modelHandedness: surface.modelHandedness,
              node,
              pickingGeometry: primitive.geometry,
            });
          } else {
            const localModels = instanceBatch.localModels;
            for (let offset = 0; offset < localModels.length; offset += 16) {
              const localModel = mat4At(localModels, offset);
              const instanceModel = multiplyMat4Into(identityMat4(), rootModel, localModel);
              pickSurfaces.push({
                inverseModel: inverseMat4(instanceModel),
                modelHandedness: surface.modelHandedness,
                node,
                pickingGeometry: primitive.geometry,
              });
            }
          }
          surfaces.push(surface);
        } else {
          surfaces.push(surface);
        }
      }
      continue;
    }
    if (node.kind !== "mesh") {
      if (node.kind === "directional-light") {
        if (!requiresLighting) continue;
        if (directionalLights.length === MAX_CANONICAL_DIRECTIONAL_LIGHTS) {
          throw new Error(
            `Royal canonical surface slice supports at most ${MAX_CANONICAL_DIRECTIONAL_LIGHTS} directional lights`,
          );
        }
        directionalLights.push({
          color: [
            node.color[0] * node.illuminanceLux,
            node.color[1] * node.illuminanceLux,
            node.color[2] * node.illuminanceLux,
            1,
          ],
          direction: node.direction,
        });
        continue;
      }
      if (!requiresLighting && (node.kind === "point-light" || node.kind === "spot-light")) {
        continue;
      }
      throw new Error(`Royal direct-surface slice does not yet support ${node.kind} nodes`);
    }
    const material = prepareCanonicalMaterial(node.material, decodedTexture);
    if (node.material.baseColor.kind === "asset") textureAssets.push(node.material.baseColor);
    const geometry = prepareCanonicalGeometry(
      node.geometry,
      material.requiresTextureCoordinates,
    );
    const model = transformMat4(node.transform);
    const surface = {
      geometry,
      inverseModel: inverseMat4(model),
      model,
      modelHandedness: modelHandedness(model),
      material,
      node,
      pickingGeometry: node.pickingGeometry === undefined
        ? geometry
        : prepareCanonicalGeometry(node.pickingGeometry),
    };
    surfaces.push(surface);
    pickSurfaces.push(surface);
  }
  return {
    camera,
    directionalLights,
    exposure: sceneExposure(scene),
    gltfNodes,
    pickSurfaces,
    surfaces,
    textureAssets,
    toneMapping: scene.toneMapping ?? "pbr-neutral",
  };
};

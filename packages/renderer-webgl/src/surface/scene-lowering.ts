import type {
  Direction3,
  GltfNode,
  LinearRgba,
  MeshNode,
  RenderRoot,
} from "@royal/renderer-core";
import {
  affineSurfaceNormalTransformInto,
  identityMat4,
  inverseMat4,
  multiplyMat4Into,
  transformDirection,
  transformMat4,
  transformPoint,
  type Mat4,
} from "../math/mat4";
import type { PreparedStaticGltf } from "../gltf/static-asset";
import {
  canonicalMaterialTextureKeys,
  prepareCanonicalMaterialSource,
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
import {
  emptyWorldBounds,
  includeTransformedBounds,
  transformedWorldBounds,
  type WorldBounds,
} from "./surface-visibility";

export type CanonicalDrawSurface = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instances?: Readonly<{
    count: number;
    key: string;
    localModels: Float32Array;
  }>;
  material: CanonicalSurfaceMaterial;
  materialSource: CanonicalSurfaceMaterial;
  model: Mat4;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode;
  normalTransform: Mat4;
  textureKeys: readonly string[];
  worldBounds: WorldBounds;
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
  environment?: CanonicalStudioEnvironment;
  exposure: number;
  gltfNodes: readonly GltfNode[];
  pickSurfaces: readonly CanonicalPickSurface[];
  punctualLights: readonly CanonicalPunctualLight[];
  surfaces: readonly CanonicalDrawSurface[];
  textureAssets: readonly TextureSourceRef[];
  toneMapping: "linear-clamp" | "pbr-neutral";
}>;

export type CanonicalDirectionalLight = Readonly<{
  color: LinearRgba;
  direction: Direction3;
}>;

export type CanonicalStudioEnvironment = Readonly<{
  radianceScaleNits: number;
  rotation: Mat4;
}>;

export type CanonicalPunctualLight = Readonly<{
  color: LinearRgba;
  direction: Direction3;
  innerConeCosine: number;
  kind: "point" | "spot";
  outerConeCosine: number;
  position: readonly [number, number, number];
  range: number;
}>;

export const MAX_CANONICAL_DIRECTIONAL_LIGHTS = 4;
export const MAX_CANONICAL_PUNCTUAL_LIGHTS = 8;

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

const normalizedDirection = (direction: Direction3): Direction3 => {
  const inverseLength = 1 / Math.hypot(direction[0], direction[1], direction[2]);
  return [
    direction[0] * inverseLength,
    direction[1] * inverseLength,
    direction[2] * inverseLength,
  ];
};

const prepareStudioEnvironment = (
  scene: RenderRoot,
  required: boolean,
): CanonicalStudioEnvironment | undefined => {
  const environment = scene.environment;
  if (!required || environment === undefined) return undefined;
  if (environment.source !== "studio") {
    throw new Error("Royal canonical surface slice does not yet support prefiltered environments");
  }
  return {
    radianceScaleNits: environment.radianceScaleNits,
    rotation: transformMat4({
      position: [0, 0, 0],
      rotation: environment.rotation,
      scale: [1, 1, 1],
    }),
  };
};

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
  const environment = prepareStudioEnvironment(scene, requiresLighting);
  const directionalLights: CanonicalDirectionalLight[] = [];
  const gltfNodes: GltfNode[] = [];
  const pickSurfaces: CanonicalPickSurface[] = [];
  const punctualLights: CanonicalPunctualLight[] = [];
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
      for (const light of prepared.lights) {
        const lightModel = multiplyMat4Into(identityMat4(), rootModel, light.localModel);
        const color: LinearRgba = [
          light.color[0] * light.intensity,
          light.color[1] * light.intensity,
          light.color[2] * light.intensity,
          1,
        ];
        const direction = transformDirection(lightModel, [0, 0, -1]);
        if (light.kind === "directional") {
          if (directionalLights.length === MAX_CANONICAL_DIRECTIONAL_LIGHTS) {
            throw new Error(
              `Royal canonical surface slice supports at most ${MAX_CANONICAL_DIRECTIONAL_LIGHTS} directional lights`,
            );
          }
          directionalLights.push({ color, direction });
        } else {
          if (punctualLights.length === MAX_CANONICAL_PUNCTUAL_LIGHTS) {
            throw new Error(
              `Royal canonical surface slice supports at most ${MAX_CANONICAL_PUNCTUAL_LIGHTS} punctual lights`,
            );
          }
          punctualLights.push({
            color,
            direction,
            innerConeCosine: Math.cos(light.innerConeAngle),
            kind: light.kind,
            outerConeCosine: Math.cos(light.outerConeAngle),
            position: transformPoint(lightModel, [0, 0, 0]),
            range: light.range,
          });
        }
      }
      for (const primitive of prepared.primitives) {
      const instanceBatch = primitive.instanceBatch;
      const model = instanceBatch === undefined
        ? multiplyMat4Into(identityMat4(), rootModel, primitive.localModel)
        : rootModel;
      const worldBounds = instanceBatch === undefined
        ? transformedWorldBounds(primitive.geometry.bounds, model)
        : emptyWorldBounds();
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
          materialSource: primitive.material,
          model,
          modelHandedness: instanceBatch === undefined
            ? modelHandedness(model)
            : (modelHandedness(rootModel) * instanceBatch.handedness) as 1 | -1,
          node,
          normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
          textureKeys: canonicalMaterialTextureKeys(primitive.material),
          worldBounds,
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
              includeTransformedBounds(worldBounds, primitive.geometry.bounds, instanceModel);
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
          if (instanceBatch !== undefined) {
            const localModels = instanceBatch.localModels;
            for (let offset = 0; offset < localModels.length; offset += 16) {
              const localModel = mat4At(localModels, offset);
              includeTransformedBounds(
                worldBounds,
                primitive.geometry.bounds,
                multiplyMat4Into(identityMat4(), rootModel, localModel),
              );
            }
          }
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
          direction: normalizedDirection(node.direction),
        });
        continue;
      }
      if (node.kind === "point-light" || node.kind === "spot-light") {
        if (!requiresLighting) continue;
        if (punctualLights.length === MAX_CANONICAL_PUNCTUAL_LIGHTS) {
          throw new Error(
            `Royal canonical surface slice supports at most ${MAX_CANONICAL_PUNCTUAL_LIGHTS} punctual lights`,
          );
        }
        const spot = node.kind === "spot-light";
        punctualLights.push({
          color: [
            node.color[0] * node.intensityCandela,
            node.color[1] * node.intensityCandela,
            node.color[2] * node.intensityCandela,
            1,
          ],
          direction: spot ? normalizedDirection(node.direction) : [0, 0, -1],
          innerConeCosine: spot ? Math.cos(node.innerConeAngle) : 1,
          kind: spot ? "spot" : "point",
          outerConeCosine: spot ? Math.cos(node.outerConeAngle) : -1,
          position: node.position,
          range: node.range ?? 0,
        });
        continue;
      }
      throw new Error(`Royal direct-surface slice does not yet support ${node.kind} nodes`);
    }
    const materialSource = prepareCanonicalMaterialSource(node.material);
    const material = resolveCanonicalMaterialTexture(materialSource, decodedTexture);
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
      materialSource,
      node,
      normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
      pickingGeometry: node.pickingGeometry === undefined
        ? geometry
        : prepareCanonicalGeometry(node.pickingGeometry),
      textureKeys: canonicalMaterialTextureKeys(materialSource),
      worldBounds: transformedWorldBounds(geometry.bounds, model),
    };
    surfaces.push(surface);
    pickSurfaces.push(surface);
  }
  return {
    camera,
    directionalLights,
    ...(environment === undefined ? {} : { environment }),
    exposure: sceneExposure(scene),
    gltfNodes,
    pickSurfaces,
    punctualLights,
    surfaces,
    textureAssets,
    toneMapping: scene.toneMapping ?? "pbr-neutral",
  };
};

/** Re-resolves only surfaces which claim one newly published decoded texture. */
export const refreshCanonicalSurfaceTexture = (
  scene: CanonicalSurfaceScene,
  textureKey: string,
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
): CanonicalSurfaceScene => {
  let surfaces: CanonicalDrawSurface[] | undefined;
  for (let index = 0; index < scene.surfaces.length; index += 1) {
    const surface = scene.surfaces[index]!;
    if (!surface.textureKeys.includes(textureKey)) continue;
    surfaces ??= scene.surfaces.slice();
    surfaces[index] = {
      ...surface,
      material: resolveCanonicalMaterialTexture(surface.materialSource, decodedTexture),
    };
  }
  return surfaces === undefined ? scene : { ...scene, surfaces };
};

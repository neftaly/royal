import type {
  Direction3,
  GltfInstancesNode,
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
import { prepareGltfInstanceBatches } from "../gltf/instance-transforms";
import {
  appendCanonicalMaterialTextureAssets,
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
  includeWorldBounds,
  transformedWorldBounds,
  type WorldBounds,
} from "./surface-visibility";
import type { LodMembership } from "./lod-selection";

export type CanonicalDrawSurface = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instances?: Readonly<{
    count: number;
    key: string;
    localModels: Float32Array;
    revision?: string;
    sourceIndices?: Uint32Array;
  }>;
  lods?: readonly LodMembership[];
  material: CanonicalSurfaceMaterial;
  materialSource: CanonicalSurfaceMaterial;
  model: Mat4;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode | GltfInstancesNode;
  normalTransform: Mat4;
  textureKeys: readonly string[];
  worldBounds: WorldBounds;
}>;

export type CanonicalPickSurface = Readonly<{
  instanceIndex?: number;
  inverseModel: Mat4 | undefined;
  lods?: readonly LodMembership[];
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode | GltfInstancesNode;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

export type CanonicalSurfaceScene = Readonly<{
  camera: CanonicalCamera;
  directionalLights: readonly CanonicalDirectionalLight[];
  environment?: CanonicalStudioEnvironment;
  exposure: number;
  gltfNodes: readonly (GltfNode | GltfInstancesNode)[];
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
  preparedGltf: (
    node: GltfNode | GltfInstancesNode,
  ) => PreparedStaticGltf | undefined = () => undefined,
  camera: CanonicalCamera = staticCamera(scene),
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined = () => undefined,
): CanonicalSurfaceScene => {
  let requiresLighting = false;
  for (const node of scene.nodes) {
    if (
      node.kind === "gltf"
      || node.kind === "gltf-instances"
      || (node.kind === "mesh" && node.material.kind === "standard")
    ) {
      requiresLighting = true;
      break;
    }
  }
  const environment = prepareStudioEnvironment(scene, requiresLighting);
  const directionalLights: CanonicalDirectionalLight[] = [];
  const gltfNodes: Array<GltfNode | GltfInstancesNode> = [];
  const pickSurfaces: CanonicalPickSurface[] = [];
  const punctualLights: CanonicalPunctualLight[] = [];
  const surfaces: CanonicalDrawSurface[] = [];
  const textureAssets: TextureSourceRef[] = [];
  const lodBounds = new Map<string, ReturnType<typeof emptyWorldBounds>>();
  let materialLodGroupIndex = 0;
  for (const node of scene.nodes) {
    if (node.kind === "gltf" || node.kind === "gltf-instances") {
      gltfNodes.push(node);
      const mountIndex = gltfNodes.length - 1;
      const rootModel = node.kind === "gltf" ? transformMat4(node.transform) : identityMat4();
      const proxyGeometry = node.pickingGeometry === undefined
        ? undefined
        : prepareCanonicalGeometry(node.pickingGeometry);
      if (proxyGeometry !== undefined) {
        if (node.kind === "gltf") {
          pickSurfaces.push({
            inverseModel: inverseMat4(rootModel),
            modelHandedness: modelHandedness(rootModel),
            node,
            pickingGeometry: proxyGeometry,
          });
        } else {
          const proxyBatches = prepareGltfInstanceBatches(node.instances, identityMat4(), 1);
          for (const batch of proxyBatches) {
            for (let offset = 0; offset < batch.localModels.length; offset += 16) {
              const instanceIndex = batch.sourceIndices[offset / 16]!;
              pickSurfaces.push({
                instanceIndex,
                inverseModel: inverseMat4(mat4At(batch.localModels, offset)),
                modelHandedness: batch.handedness,
                node,
                pickingGeometry: proxyGeometry,
              });
            }
          }
        }
      }
      const prepared = preparedGltf(node);
      if (prepared === undefined) continue;
      for (const light of prepared.lights) {
        const color: LinearRgba = [
          light.color[0] * light.intensity,
          light.color[1] * light.intensity,
          light.color[2] * light.intensity,
          1,
        ];
        const appendLight = (lightModel: Mat4): void => {
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
        };
        if (node.kind === "gltf") {
          appendLight(multiplyMat4Into(identityMat4(), rootModel, light.localModel));
        } else {
          const batches = prepareGltfInstanceBatches(node.instances, light.localModel, 1);
          for (const batch of batches) {
            for (let offset = 0; offset < batch.localModels.length; offset += 16) {
              appendLight(mat4At(batch.localModels, offset));
            }
          }
        }
      }
      for (const primitive of prepared.primitives) {
        const preparedInstanceBatches = node.kind === "gltf-instances"
          ? prepareGltfInstanceBatches(
            node.instances,
            primitive.instanceBatch?.localModels ?? primitive.localModel,
            primitive.instanceBatch?.localModels.length === undefined
              ? 1
              : primitive.instanceBatch.localModels.length / 16,
          ).map((batch, batchIndex) => ({
            ...batch,
            key: `${primitive.geometry.key}:mount:${mountIndex}:explicit:scale:${node.instances.scaleVersion}:hand:${batch.handedness}:${batchIndex}`,
            revision: String(node.instances.poseVersion),
          }))
          : [primitive.instanceBatch];
        for (const instanceBatch of preparedInstanceBatches) {
        const sourceIndices = instanceBatch !== undefined
          && "sourceIndices" in instanceBatch
          && instanceBatch.sourceIndices instanceof Uint32Array
          ? instanceBatch.sourceIndices
          : undefined;
        const instanceRevision = instanceBatch !== undefined
          && "revision" in instanceBatch
          && typeof instanceBatch.revision === "string"
          ? instanceBatch.revision
          : undefined;
        const materialSource = node.materialVariant === undefined
          ? primitive.material
          : primitive.materialVariants?.get(node.materialVariant) ?? primitive.material;
        const materialLod = node.materialVariant === undefined
          ? primitive.materialLod
          : primitive.materialVariants?.has(node.materialVariant) === true
            ? primitive.materialVariantLods?.get(node.materialVariant)
            : primitive.materialLod;
        const model = instanceBatch === undefined
          ? multiplyMat4Into(identityMat4(), rootModel, primitive.localModel)
          : rootModel;
        const worldBounds = instanceBatch === undefined
          ? transformedWorldBounds(primitive.geometry.bounds, model)
          : emptyWorldBounds();
        if (instanceBatch !== undefined) {
          const localModels = instanceBatch.localModels;
          for (let offset = 0; offset < localModels.length; offset += 16) {
            includeTransformedBounds(
              worldBounds,
              primitive.geometry.bounds,
              multiplyMat4Into(identityMat4(), rootModel, mat4At(localModels, offset)),
            );
          }
        }
        let geometryLods: LodMembership[] | undefined;
        if (primitive.lods !== undefined) {
          geometryLods = Array<LodMembership>(primitive.lods.length);
          for (let lodIndex = 0; lodIndex < primitive.lods.length; lodIndex += 1) {
            const primitiveLod = primitive.lods[lodIndex]!;
            let selectionBounds = lodBounds.get(primitiveLod.group);
            if (selectionBounds === undefined) {
              selectionBounds = emptyWorldBounds();
              lodBounds.set(primitiveLod.group, selectionBounds);
            }
            includeWorldBounds(selectionBounds, worldBounds);
            geometryLods[lodIndex] = { ...primitiveLod, selectionBounds };
          }
        }
        const handedness = instanceBatch === undefined
          ? modelHandedness(model)
          : (modelHandedness(rootModel) * instanceBatch.handedness) as 1 | -1;
        if (proxyGeometry === undefined) {
          if (instanceBatch === undefined) {
            pickSurfaces.push({
              inverseModel: inverseMat4(model),
              modelHandedness: handedness,
              node,
              ...(geometryLods === undefined ? {} : { lods: geometryLods }),
              pickingGeometry: primitive.geometry,
            });
          } else {
            const localModels = instanceBatch.localModels;
            for (let offset = 0; offset < localModels.length; offset += 16) {
              const localModel = mat4At(localModels, offset);
              const instanceModel = multiplyMat4Into(identityMat4(), rootModel, localModel);
              pickSurfaces.push({
                inverseModel: inverseMat4(instanceModel),
                ...(sourceIndices === undefined
                  ? {}
                  : { instanceIndex: sourceIndices[offset / 16]! }),
                modelHandedness: handedness,
                node,
                ...(geometryLods === undefined ? {} : { lods: geometryLods }),
                pickingGeometry: primitive.geometry,
              });
            }
          }
        }
        const materialLevelCount = materialLod?.levels.length ?? 1;
        const materialGroup = materialLod === undefined
          ? undefined
          : `${primitive.geometry.key}:mount:${materialLodGroupIndex++}:material-lod`;
        for (let materialLevel = 0; materialLevel < materialLevelCount; materialLevel += 1) {
          const levelMaterial = materialLod?.levels[materialLevel] ?? materialSource;
          appendCanonicalMaterialTextureAssets(textureAssets, levelMaterial);
          let lods = geometryLods;
          if (materialLod !== undefined && materialGroup !== undefined) {
            const materialMembership: LodMembership = {
              group: materialGroup,
              level: materialLevel,
              selectionBounds: worldBounds,
              thresholds: materialLod.thresholds,
            };
            lods = geometryLods === undefined
              ? [materialMembership]
              : [...geometryLods, materialMembership];
          }
          surfaces.push({
            geometry: primitive.geometry,
            ...(instanceBatch === undefined ? {} : {
            instances: {
              count: instanceBatch.localModels.length / 16,
              key: instanceBatch.key,
              localModels: instanceBatch.localModels,
              ...(instanceRevision === undefined
                ? {}
                : { revision: instanceRevision }),
              ...(sourceIndices === undefined ? {} : { sourceIndices }),
              },
            }),
            material: resolveCanonicalMaterialTexture(levelMaterial, decodedTexture),
            materialSource: levelMaterial,
            ...(lods === undefined ? {} : { lods }),
            model,
            modelHandedness: handedness,
            node,
            normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
            textureKeys: canonicalMaterialTextureKeys(levelMaterial),
            worldBounds,
          });
        }
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
      const unsupportedKind = (node as { readonly kind?: unknown }).kind;
      throw new Error(`Royal direct-surface slice does not yet support ${String(unsupportedKind)} nodes`);
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

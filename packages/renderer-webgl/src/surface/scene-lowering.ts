import type {
  Direction3,
  Geometry,
  GltfInstancesNode,
  GltfNode,
  LinearRgba,
  Material,
  MeshNode,
  Scene,
  VirtualTextureAssetRef,
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
  canonicalMaterialHasTransmission,
  canonicalMaterialHasVolume,
  canonicalMaterialTextureKeys,
  canonicalTextureSampler,
  prepareCanonicalMaterialSource,
  resolveCanonicalMaterialTexture,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";
import {
  prepareCanonicalGeometry,
  prepareCanonicalWireframeGeometry,
  type CanonicalTriangleGeometry,
} from "./canonical-geometry";
import type { CanonicalCamera } from "./camera-source-owner";
import {
  decodedTextureKey,
  textureStorageKey,
  type DecodedTextureSource,
  type TextureSourceRef,
} from "../texture/asset-owner";
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
  topology?: "lines";
  worldBounds: WorldBounds;
}>;

export type CanonicalPickSurface = Readonly<{
  alphaMaskSampler?: ReturnType<typeof canonicalTextureSampler>;
  doubleSided?: true;
  instanceIndex?: number;
  inverseModel: Mat4 | undefined;
  lods?: readonly LodMembership[];
  materialSource?: CanonicalSurfaceMaterial;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode | GltfInstancesNode;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

const canonicalPickMaterial = (
  material: CanonicalSurfaceMaterial,
): Pick<CanonicalPickSurface, "alphaMaskSampler" | "doubleSided" | "materialSource"> => ({
  ...(material.doubleSided === true ? { doubleSided: true as const } : {}),
  ...(material.alphaCutoff === undefined ? {} : {
    ...(material.baseColorAsset === undefined
      ? {}
      : { alphaMaskSampler: canonicalTextureSampler(material.baseColorAsset) }),
    materialSource: material,
  }),
});

export type CanonicalLodGroup = Readonly<{
  group: string;
  levels: readonly number[];
  selectionBounds: WorldBounds;
  surfaceIndices: readonly number[];
  thresholds: readonly number[];
}>;

export type CanonicalSurfaceScene = Readonly<{
  alphaMaskTextureAssets: readonly TextureSourceRef[];
  camera: CanonicalCamera;
  directionalLights: readonly CanonicalDirectionalLight[];
  environment?: CanonicalEnvironment;
  exposure: number;
  gltfNodes: readonly (GltfNode | GltfInstancesNode)[];
  lodGroups: readonly CanonicalLodGroup[];
  pickSurfaces: readonly CanonicalPickSurface[];
  punctualLights: readonly CanonicalPunctualLight[];
  surfaces: readonly CanonicalDrawSurface[];
  textureAssets: readonly TextureSourceRef[];
  textureSurfaceIndices: ReadonlyMap<string, readonly number[]>;
  virtualTextureAssets: readonly VirtualTextureAssetRef[];
  toneMapping: "linear-clamp" | "pbr-neutral";
}>;

const collectCanonicalAlphaMaskTextureAssets = (
  surfaces: readonly CanonicalPickSurface[],
): readonly TextureSourceRef[] => {
  const assets: TextureSourceRef[] = [];
  const claimed = new Set<string>();
  for (const surface of surfaces) {
    const material = surface.materialSource;
    const asset = material?.alphaCutoff === undefined ? undefined : material.baseColorAsset;
    if (asset === undefined) continue;
    const key = decodedTextureKey(asset);
    if (claimed.has(key)) continue;
    claimed.add(key);
    assets.push(asset);
  }
  return assets;
};

/** Collects display-defining color images before material-detail images. */
export const collectCanonicalSurfaceTextureAssets = (
  surfaces: readonly Pick<CanonicalDrawSurface, "materialSource">[],
): readonly TextureSourceRef[] => {
  const assets: TextureSourceRef[] = [];
  const claimed = new Set<string>();
  const add = (asset: TextureSourceRef | undefined): void => {
    if (asset === undefined) return;
    const key = textureStorageKey(asset);
    if (claimed.has(key)) return;
    claimed.add(key);
    assets.push(asset);
  };
  for (const { materialSource } of surfaces) {
    add(materialSource.baseColorAsset);
  }
  for (const { materialSource } of surfaces) {
    if (materialSource.kind === "unlit") continue;
    add(materialSource.emissiveAsset);
    add(materialSource.metallicRoughnessAsset);
    add(materialSource.normalAsset);
    add(materialSource.occlusionAsset);
    add(materialSource.specularColorAsset);
    add(materialSource.specularTextureAsset);
    if (canonicalMaterialHasVolume(materialSource)) add(materialSource.thicknessAsset);
    if (canonicalMaterialHasTransmission(materialSource)) add(materialSource.transmissionAsset);
  }
  return assets;
};

const indexSurfaceTextures = (
  surfaces: readonly CanonicalDrawSurface[],
): ReadonlyMap<string, readonly number[]> => {
  const indices = new Map<string, number[]>();
  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    for (const key of surfaces[surfaceIndex]!.textureKeys) {
      const claimed = indices.get(key);
      if (claimed === undefined) indices.set(key, [surfaceIndex]);
      else claimed.push(surfaceIndex);
    }
  }
  return indices;
};

const indexSurfaceLods = (
  surfaces: readonly CanonicalDrawSurface[],
): readonly CanonicalLodGroup[] => {
  const groups = new Map<string, {
    levels: number[];
    membership: LodMembership;
    surfaceIndices: number[];
  }>();
  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    for (const membership of surfaces[surfaceIndex]!.lods ?? []) {
      const group = groups.get(membership.group);
      if (group === undefined) {
        groups.set(membership.group, {
          levels: [membership.level],
          membership,
          surfaceIndices: [surfaceIndex],
        });
      } else {
        group.levels.push(membership.level);
        group.surfaceIndices.push(surfaceIndex);
      }
    }
  }
  return Array.from(groups, ([group, index]) => ({
    group,
    levels: index.levels,
    selectionBounds: index.membership.selectionBounds,
    surfaceIndices: index.surfaceIndices,
    thresholds: index.membership.thresholds,
  }));
};

export type CanonicalDirectionalLight = Readonly<{
  color: LinearRgba;
  direction: Direction3;
}>;

export type CanonicalEnvironment = Readonly<{
  radianceScaleNits: number;
  rotated: boolean;
  rotation: Mat4;
} & (
  | { source: "studio" }
  | {
    source: "royal-prefiltered-v1";
    src: string;
    version?: number | string;
  }
)>;

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

const staticCamera = (scene: Scene): CanonicalCamera => {
  if (scene.camera.kind === "perspective-camera" || scene.camera.kind === "orthographic-camera") {
    return scene.camera;
  }
  throw new Error(
    "Royal cannot snapshot a mutable camera resource without a renderer root; "
      + "render the scene through Canvas or createRendererRoot",
  );
};

const sceneExposure = (scene: Scene): number => scene.exposureEv100 === undefined
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

const prepareEnvironment = (
  scene: Scene,
  required: boolean,
): CanonicalEnvironment | undefined => {
  const environment = scene.environment;
  if (!required || environment === undefined) return undefined;
  return {
    radianceScaleNits: environment.radianceScaleNits,
    rotated: environment.rotation[0] !== 0
      || environment.rotation[1] !== 0
      || environment.rotation[2] !== 0,
    rotation: transformMat4({
      position: [0, 0, 0],
      rotation: environment.rotation,
      scale: [1, 1, 1],
    }),
    ...(environment.source === "studio"
      ? { source: "studio" as const }
      : {
        source: "royal-prefiltered-v1" as const,
        src: environment.src,
        ...(environment.version === undefined ? {} : { version: environment.version }),
      }),
  };
};

/** Validates and lowers a complete direct scene before any GL resource work. */
export const prepareCanonicalSurfaceScene = (
  scene: Scene,
  preparedGltf: (
    node: GltfNode | GltfInstancesNode,
  ) => PreparedStaticGltf | undefined = () => undefined,
  camera: CanonicalCamera = staticCamera(scene),
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined = () => undefined,
  texturePending: (asset: TextureSourceRef) => boolean = () => true,
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
  const environment = prepareEnvironment(scene, requiresLighting);
  const directionalLights: CanonicalDirectionalLight[] = [];
  const gltfNodes: Array<GltfNode | GltfInstancesNode> = [];
  const pickSurfaces: CanonicalPickSurface[] = [];
  const punctualLights: CanonicalPunctualLight[] = [];
  const surfaces: CanonicalDrawSurface[] = [];
  const virtualTextureAssets: VirtualTextureAssetRef[] = [];
  const lodBounds = new Map<string, ReturnType<typeof emptyWorldBounds>>();
  const directMaterials = new WeakMap<Material, CanonicalSurfaceMaterial>();
  const directPlainGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  const directTexturedGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  const directWireframeGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  let authoredGeometryIndex = 0;
  const directGeometry = (
    geometry: Geometry,
    textureCoordinates = false,
  ): CanonicalTriangleGeometry => {
    const retained = !textureCoordinates
      || (geometry.kind === "triangles" && geometry.textureCoordinates !== undefined)
      ? directPlainGeometry
      : directTexturedGeometry;
    let canonical = retained.get(geometry);
    if (canonical === undefined) {
      const authoredKey = geometry.kind === "triangles"
        ? `triangles:${authoredGeometryIndex++}`
        : "";
      canonical = prepareCanonicalGeometry(
        geometry,
        textureCoordinates,
        authoredKey,
      );
      retained.set(geometry, canonical);
    }
    return canonical;
  };
  const wireframeGeometry = (geometry: Geometry): CanonicalTriangleGeometry => {
    let canonical = directWireframeGeometry.get(geometry);
    if (canonical === undefined) {
      canonical = prepareCanonicalWireframeGeometry(directGeometry(geometry));
      directWireframeGeometry.set(geometry, canonical);
    }
    return canonical;
  };
  let materialLodGroupIndex = 0;
  for (const node of scene.nodes) {
    if (node.kind === "gltf" || node.kind === "gltf-instances") {
      gltfNodes.push(node);
      const mountIndex = gltfNodes.length - 1;
      const rootModel = node.kind === "gltf" ? transformMat4(node.transform) : identityMat4();
      const proxyGeometry = node.pickingGeometry === undefined
        ? undefined
        : directGeometry(node.pickingGeometry);
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
                `Royal scenes support at most ${MAX_CANONICAL_DIRECTIONAL_LIGHTS} directional lights`,
              );
            }
            directionalLights.push({ color, direction });
          } else {
            if (punctualLights.length === MAX_CANONICAL_PUNCTUAL_LIGHTS) {
              throw new Error(
                `Royal scenes support at most ${MAX_CANONICAL_PUNCTUAL_LIGHTS} point and spot lights`,
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
        const materialLevelCount = materialLod?.levels.length ?? 1;
        const materialGroup = materialLod === undefined
          ? undefined
          : `${primitive.geometry.key}:mount:${materialLodGroupIndex++}:material-lod`;
        for (let materialLevel = 0; materialLevel < materialLevelCount; materialLevel += 1) {
          const levelMaterial = materialLod?.levels[materialLevel] ?? materialSource;
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
            material: resolveCanonicalMaterialTexture(levelMaterial, decodedTexture, texturePending),
            materialSource: levelMaterial,
            ...(lods === undefined ? {} : { lods }),
            model,
            modelHandedness: handedness,
            node,
            normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
            textureKeys: canonicalMaterialTextureKeys(levelMaterial),
            worldBounds,
          });
          if (proxyGeometry === undefined) {
            if (instanceBatch === undefined) {
              pickSurfaces.push({
                ...canonicalPickMaterial(levelMaterial),
                inverseModel: inverseMat4(model),
                modelHandedness: handedness,
                node,
                ...(lods === undefined ? {} : { lods }),
                pickingGeometry: primitive.geometry,
              });
            } else {
              const localModels = instanceBatch.localModels;
              for (let offset = 0; offset < localModels.length; offset += 16) {
                const instanceModel = multiplyMat4Into(
                  identityMat4(),
                  rootModel,
                  mat4At(localModels, offset),
                );
                pickSurfaces.push({
                  ...canonicalPickMaterial(levelMaterial),
                  inverseModel: inverseMat4(instanceModel),
                  ...(sourceIndices === undefined
                    ? {}
                    : { instanceIndex: sourceIndices[offset / 16]! }),
                  modelHandedness: handedness,
                  node,
                  ...(lods === undefined ? {} : { lods }),
                  pickingGeometry: primitive.geometry,
                });
              }
            }
          }
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
            `Royal scenes support at most ${MAX_CANONICAL_DIRECTIONAL_LIGHTS} directional lights`,
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
            `Royal scenes support at most ${MAX_CANONICAL_PUNCTUAL_LIGHTS} point and spot lights`,
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
      throw new Error(`Royal scenes do not support nodes with kind ${JSON.stringify(unsupportedKind)}`);
    }
    let materialSource = directMaterials.get(node.material);
    if (materialSource === undefined) {
      materialSource = prepareCanonicalMaterialSource(node.material);
      directMaterials.set(node.material, materialSource);
    }
    const material = resolveCanonicalMaterialTexture(materialSource, decodedTexture, texturePending);
    if (node.material.baseColor.kind === "virtual-asset") {
      virtualTextureAssets.push(node.material.baseColor);
    }
    const pickingGeometry = node.pickingGeometry === undefined
      ? directGeometry(node.geometry)
      : directGeometry(node.pickingGeometry);
    const wireframe = node.material.kind === "wireframe";
    const geometry = wireframe
      ? wireframeGeometry(node.geometry)
      : directGeometry(node.geometry, material.requiresTextureCoordinates);
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
      pickingGeometry,
      textureKeys: canonicalMaterialTextureKeys(materialSource),
      ...(wireframe ? { topology: "lines" as const } : {}),
      worldBounds: transformedWorldBounds(geometry.bounds, model),
    };
    surfaces.push(surface);
    pickSurfaces.push(node.pickingGeometry === undefined ? {
      ...surface,
      ...canonicalPickMaterial(materialSource),
    } : {
      ...(materialSource.doubleSided === true ? { doubleSided: true as const } : {}),
      inverseModel: surface.inverseModel,
      modelHandedness: surface.modelHandedness,
      node,
      pickingGeometry: surface.pickingGeometry,
    });
  }
  return {
    alphaMaskTextureAssets: collectCanonicalAlphaMaskTextureAssets(pickSurfaces),
    camera,
    directionalLights,
    ...(environment === undefined ? {} : { environment }),
    exposure: sceneExposure(scene),
    gltfNodes,
    lodGroups: indexSurfaceLods(surfaces),
    pickSurfaces,
    punctualLights,
    surfaces,
    textureAssets: collectCanonicalSurfaceTextureAssets(surfaces),
    textureSurfaceIndices: indexSurfaceTextures(surfaces),
    virtualTextureAssets,
    toneMapping: scene.toneMapping ?? "pbr-neutral",
  };
};

/** Re-resolves only surfaces which claim one newly published decoded texture. */
export const refreshCanonicalSurfaceTexture = (
  scene: CanonicalSurfaceScene,
  textureKey: string,
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
  texturePending: (asset: TextureSourceRef) => boolean = () => true,
): CanonicalSurfaceScene => {
  const affected = scene.textureSurfaceIndices.get(textureKey);
  if (affected === undefined) return scene;
  const surfaces = scene.surfaces.slice();
  for (const index of affected) {
    const surface = scene.surfaces[index]!;
    surfaces[index] = {
      ...surface,
      material: resolveCanonicalMaterialTexture(
        surface.materialSource,
        decodedTexture,
        texturePending,
      ),
    };
  }
  return { ...scene, surfaces };
};

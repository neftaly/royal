import type {
  Direction3,
  Geometry,
  GltfAssetRef,
  GltfInstanceTransforms,
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
import type {
  PreparedStaticGltf,
  PreparedStaticGltfPrimitive,
  PreparedStaticMaterialLod,
} from "../gltf/static-asset";
import {
  prepareGltfInstanceBatches,
  type IndexedStaticInstanceBatch,
} from "../gltf/instance-transforms";
import {
  canonicalMaterialHasTransmission,
  canonicalMaterialHasVolume,
  canonicalMaterialTextureKeys,
  prepareCanonicalMaterialSource,
  resolveCanonicalMaterialTexture,
  tintCanonicalMaterial,
  type CanonicalSurfaceMaterial,
} from "./canonical-material";
import { canonicalTextureSampler } from "../texture/sampler";
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
} from "../texture/source";
import {
  emptyWorldBounds,
  includeTransformedBounds,
  includeWorldBounds,
  transformedWorldBounds,
  type WorldBounds,
} from "./surface-visibility";
import type { LodGroupId, LodMembership } from "./lod-selection";
import { automaticallyInstanceCanonicalSurfaces } from "./automatic-surface-instancing";
import {
  prepareCanonicalBoundedVolume,
  type CanonicalBoundedVolume,
} from './bounded-volume-scene';

export type CanonicalDrawSurface = Readonly<{
  geometry: CanonicalTriangleGeometry;
  /** Dense mounted glTF occurrence identity; distinct even if one descriptor is repeated. */
  gltfOccurrence?: number;
  instances?: {
    /** Source occurrence for each same-index automatic `localModels` matrix. */
    automaticSourceOccurrences?: readonly Readonly<{
      asset: GltfAssetRef;
      geometryKey: string;
      gltfOccurrence: number;
    }>[];
    count: number;
    innerCount?: number;
    innerIndices?: Uint32Array;
    innerModels?: ArrayLike<number>;
    key: string;
    localModels: Float32Array;
    revision?: number | string;
    source?: GltfInstanceTransforms;
    sourceIndices?: Uint32Array;
    sourceOrdered?: boolean;
    updateCount?: number;
    updateStart?: number;
  };
  /** Material-LOD level whose base presentation must be resident before selection. */
  materialLodLevel?: true;
  lods?: readonly LodMembership[];
  material: CanonicalSurfaceMaterial;
  materialSource: CanonicalSurfaceMaterial;
  model: Mat4;
  modelHandedness: 1 | -1;
  node: MeshNode | GltfNode | GltfInstancesNode;
  normalTransform: Mat4;
  /** Asset-local transform composed after an imperative render-object transform. */
  objectLocalModel?: Mat4;
  textureKeys: readonly string[];
  topology?: "lines";
  worldBounds: WorldBounds;
}>;

type PreparedExplicitInstanceBatch = IndexedStaticInstanceBatch & Readonly<{
  innerCount: number;
  innerModels: ArrayLike<number>;
  key: string;
  revision: number;
  source: GltfInstanceTransforms;
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
  /** Asset-local transform composed after an imperative render-object transform. */
  objectLocalModel?: Mat4;
  pickingGeometry: CanonicalTriangleGeometry;
}>;

export type CanonicalRenderObjectLightBinding = Readonly<{
  index: number;
  kind: "directional" | "punctual";
  localModel: Mat4;
}>;

export type CanonicalRenderObjectBinding = Readonly<{
  lights: readonly CanonicalRenderObjectLightBinding[];
  pickSurfaceIndices: readonly number[];
  surfaceIndices: readonly number[];
}>;

const EMPTY_RENDER_OBJECTS: ReadonlyMap<
  MeshNode | GltfNode,
  CanonicalRenderObjectBinding
> = new Map();

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
  group: LodGroupId;
  levels: readonly number[];
  selectionBounds: WorldBounds;
  surfaceIndices: readonly number[];
  thresholds: readonly number[];
}>;

export type CanonicalSurfaceScene = Readonly<{
  alphaMaskTextureAssets: readonly TextureSourceRef[];
  camera: CanonicalCamera;
  directionalLights: readonly CanonicalDirectionalLight[];
  instanceLightSources: ReadonlySet<GltfInstanceTransforms>;
  environment?: CanonicalEnvironment;
  exposure: number;
  gltfNodes: readonly (GltfNode | GltfInstancesNode)[];
  lodGroups: readonly CanonicalLodGroup[];
  pickSurfaces: readonly CanonicalPickSurface[];
  punctualLights: readonly CanonicalPunctualLight[];
  renderObjects: ReadonlyMap<MeshNode | GltfNode, CanonicalRenderObjectBinding>;
  surfaces: readonly CanonicalDrawSurface[];
  textureAssets: readonly TextureSourceRef[];
  textureSurfaceIndices: ReadonlyMap<string, readonly number[]>;
  virtualTextureAssets: readonly VirtualTextureAssetRef[];
  toneMapping: "linear-clamp" | "pbr-neutral";
  volumes: readonly CanonicalBoundedVolume[];
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
  const groups: Array<{
    group: LodGroupId;
    levels: number[];
    selectionBounds: WorldBounds;
    surfaceIndices: number[];
    thresholds: readonly number[];
  }> = [];
  for (let surfaceIndex = 0; surfaceIndex < surfaces.length; surfaceIndex += 1) {
    for (const membership of surfaces[surfaceIndex]!.lods ?? []) {
      const group = groups[membership.group];
      if (group === undefined) {
        groups[membership.group] = {
          group: membership.group,
          levels: [membership.level],
          selectionBounds: membership.selectionBounds,
          surfaceIndices: [surfaceIndex],
          thresholds: membership.thresholds,
        };
      } else {
        group.levels.push(membership.level);
        group.surfaceIndices.push(surfaceIndex);
      }
    }
  }
  return groups;
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

export type CanonicalSurfacePreparationOptions = Readonly<{
  /** @defaultValue `true` */
  automaticInstancing?: boolean;
  /** @defaultValue `true` */
  includeLighting?: boolean;
  /** @defaultValue `true` */
  includePicking?: boolean;
}>;

export const canonicalModelHandedness = (model: Mat4): 1 | -1 => {
  const determinant = model[0] * (model[5] * model[10] - model[6] * model[9])
    - model[4] * (model[1] * model[10] - model[2] * model[9])
    + model[8] * (model[1] * model[6] - model[2] * model[5]);
  return determinant < 0 ? -1 : 1;
};

const IDENTITY_OBJECT_LOCAL_MODEL = identityMat4();

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

type SelectedStaticMaterial = CanonicalSurfaceMaterial | PreparedStaticMaterialLod;

/** One variant/LOD selection rule shared by lighting demand and surface emission. */
const selectStaticPrimitiveMaterial = (
  primitive: PreparedStaticGltfPrimitive,
  variant: string | undefined,
): SelectedStaticMaterial => {
  if (variant === undefined) return primitive.materialLod ?? primitive.material;
  const material = primitive.materialVariants?.get(variant);
  if (material === undefined) return primitive.materialLod ?? primitive.material;
  return primitive.materialVariantLods?.get(variant) ?? material;
};

const selectedStaticPrimitiveIsLit = (
  primitive: PreparedStaticGltfPrimitive,
  variant: string | undefined,
): boolean => {
  const material = selectStaticPrimitiveMaterial(primitive, variant);
  return "levels" in material
    ? material.levels.some((level) => level.kind === "standard")
    : material.kind === "standard";
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
  options: CanonicalSurfacePreparationOptions = {},
): CanonicalSurfaceScene => {
  const includeLighting = options.includeLighting !== false;
  const includePicking = options.includePicking !== false;
  let requiresLighting = false;
  for (const node of includeLighting ? scene.nodes : []) {
    if (node.kind === "mesh" && node.material.kind === "standard") {
      requiresLighting = true;
      break;
    }
    if (node.kind !== "gltf" && node.kind !== "gltf-instances") continue;
    const prepared = preparedGltf(node);
    // Preserve eager IBL preparation while the asset's selected materials are unknown.
    if (
      prepared === undefined
      || prepared.primitives.some((primitive) =>
        selectedStaticPrimitiveIsLit(primitive, node.materialVariant))
    ) {
      requiresLighting = true;
      break;
    }
  }
  const volumes: CanonicalBoundedVolume[] = [];
  const environment = prepareEnvironment(scene, requiresLighting);
  const directionalLights: CanonicalDirectionalLight[] = [];
  const instanceLightSources = new Set<GltfInstanceTransforms>();
  const gltfNodes: Array<GltfNode | GltfInstancesNode> = [];
  const pickSurfaces: CanonicalPickSurface[] = [];
  const punctualLights: CanonicalPunctualLight[] = [];
  const renderObjectLights: Array<Readonly<{
    binding: CanonicalRenderObjectLightBinding;
    node: GltfNode;
  }>> = [];
  const emittedSurfaces: CanonicalDrawSurface[] = [];
  let surfaces: readonly CanonicalDrawSurface[] = emittedSurfaces;
  const virtualTextureAssets: VirtualTextureAssetRef[] = [];
  const lodBounds: ReturnType<typeof emptyWorldBounds>[] = [];
  const geometryLodGroupIds: LodGroupId[] = [];
  const directMaterials = new WeakMap<Material, CanonicalSurfaceMaterial>();
  const directPlainGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  const directTexturedGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  const directWireframeGeometry = new WeakMap<Geometry, CanonicalTriangleGeometry>();
  const tintedGltfMaterials = new WeakMap<
    CanonicalSurfaceMaterial,
    Map<string, CanonicalSurfaceMaterial>
  >();
  const presentedGltfMaterial = (
    material: CanonicalSurfaceMaterial,
    tint: LinearRgba | undefined,
    tintKey: string | undefined,
  ): CanonicalSurfaceMaterial => {
    if (tint === undefined || tintKey === undefined) return material;
    let variants = tintedGltfMaterials.get(material);
    if (variants === undefined) {
      variants = new Map();
      tintedGltfMaterials.set(material, variants);
    }
    let presented = variants.get(tintKey);
    if (presented === undefined) {
      presented = tintCanonicalMaterial(material, tint);
      variants.set(tintKey, presented);
    }
    return presented;
  };
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
      canonical = prepareCanonicalGeometry(
        geometry,
        textureCoordinates,
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
  let nextLodGroupId: LodGroupId = 0;
  for (const node of scene.nodes) {
    if (node.kind === 'bounded-volume') {
      volumes.push(prepareCanonicalBoundedVolume(node));
      continue;
    }
    if (node.kind === "gltf" || node.kind === "gltf-instances") {
      gltfNodes.push(node);
      const mountIndex = gltfNodes.length - 1;
      const tintKey = node.tint === undefined ? undefined : JSON.stringify(node.tint);
      const rootModel = node.kind === "gltf" ? transformMat4(node.transform) : identityMat4();
      const proxyGeometry = !includePicking || node.pickingGeometry === undefined
        ? undefined
        : directGeometry(node.pickingGeometry);
      if (proxyGeometry !== undefined) {
        if (node.kind === "gltf") {
          pickSurfaces.push({
            inverseModel: inverseMat4(rootModel),
            modelHandedness: canonicalModelHandedness(rootModel),
            node,
            ...(node.ref === undefined
              ? {}
              : { objectLocalModel: IDENTITY_OBJECT_LOCAL_MODEL }),
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
      if (requiresLighting && node.kind === "gltf-instances" && prepared.lights.length > 0) {
        instanceLightSources.add(node.instances);
      }
      geometryLodGroupIds.length = 0;
      for (const light of prepared.lights) {
        if (!requiresLighting) break;
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
            const index = directionalLights.length;
            directionalLights.push({ color, direction });
            if (node.kind === "gltf" && node.ref !== undefined) {
              renderObjectLights.push({
                binding: {
                  index,
                  kind: "directional",
                  localModel: light.localModel,
                },
                node,
              });
            }
          } else {
            if (punctualLights.length === MAX_CANONICAL_PUNCTUAL_LIGHTS) {
              throw new Error(
                `Royal scenes support at most ${MAX_CANONICAL_PUNCTUAL_LIGHTS} point and spot lights`,
              );
            }
            const index = punctualLights.length;
            punctualLights.push({
              color,
              direction,
              innerConeCosine: Math.cos(light.innerConeAngle),
              kind: light.kind,
              outerConeCosine: Math.cos(light.outerConeAngle),
              position: transformPoint(lightModel, [0, 0, 0]),
              range: light.range,
            });
            if (node.kind === "gltf" && node.ref !== undefined) {
              renderObjectLights.push({
                binding: {
                  index,
                  kind: "punctual",
                  localModel: light.localModel,
                },
                node,
              });
            }
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
        const explicitInnerModels = primitive.instanceBatch?.localModels ?? primitive.localModel;
        const explicitInnerCount = primitive.instanceBatch?.localModels.length === undefined
          ? 1
          : primitive.instanceBatch.localModels.length / 16;
        const preparedInstanceBatches = node.kind === "gltf-instances"
          ? prepareGltfInstanceBatches(
            node.instances,
            explicitInnerModels,
            explicitInnerCount,
          ).map((batch, batchIndex) => ({
            ...batch,
            innerCount: explicitInnerCount,
            innerModels: explicitInnerModels,
            key: `${primitive.geometry.key}:mount:${mountIndex}:explicit:scale:${node.instances.scaleVersion}:hand:${batch.handedness}:${batchIndex}`,
            revision: node.instances.poseVersion,
            source: node.instances,
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
          && (typeof instanceBatch.revision === "number"
            || typeof instanceBatch.revision === "string")
          ? instanceBatch.revision
          : undefined;
        const explicitBatch = node.kind === "gltf-instances"
          ? instanceBatch as PreparedExplicitInstanceBatch
          : undefined;
        const selectedMaterial = selectStaticPrimitiveMaterial(
          primitive,
          node.materialVariant,
        );
        const materialLod = "levels" in selectedMaterial ? selectedMaterial : undefined;
        const materialSource = "levels" in selectedMaterial
          ? selectedMaterial.levels[0]!
          : selectedMaterial;
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
            let group = geometryLodGroupIds[primitiveLod.group];
            if (group === undefined) {
              group = nextLodGroupId;
              nextLodGroupId += 1;
              geometryLodGroupIds[primitiveLod.group] = group;
            }
            let selectionBounds = lodBounds[group];
            if (selectionBounds === undefined) {
              selectionBounds = emptyWorldBounds();
              lodBounds[group] = selectionBounds;
            }
            includeWorldBounds(selectionBounds, worldBounds);
            geometryLods[lodIndex] = { ...primitiveLod, group, selectionBounds };
          }
        }
        const handedness = instanceBatch === undefined
          ? canonicalModelHandedness(model)
          : (canonicalModelHandedness(rootModel) * instanceBatch.handedness) as 1 | -1;
        const materialLevelCount = materialLod?.levels.length ?? 1;
        const materialGroup = materialLod === undefined
          ? undefined
          : nextLodGroupId++;
        for (let materialLevel = 0; materialLevel < materialLevelCount; materialLevel += 1) {
          const levelMaterial = materialLod?.levels[materialLevel] ?? materialSource;
          const presentedMaterial = presentedGltfMaterial(levelMaterial, node.tint, tintKey);
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
          emittedSurfaces.push({
            geometry: primitive.geometry,
            gltfOccurrence: mountIndex,
            ...(instanceBatch === undefined ? {} : {
            instances: {
              count: instanceBatch.localModels.length / 16,
              key: instanceBatch.key,
              localModels: instanceBatch.localModels,
              ...(instanceRevision === undefined
                ? {}
                : { revision: instanceRevision }),
              ...(explicitBatch === undefined ? {} : {
                innerCount: explicitBatch.innerCount,
                ...(explicitBatch.innerIndices === undefined
                  ? {}
                  : { innerIndices: explicitBatch.innerIndices }),
                innerModels: explicitBatch.innerModels,
                source: explicitBatch.source,
                sourceOrdered: explicitBatch.sourceOrdered,
              }),
              ...(sourceIndices === undefined ? {} : { sourceIndices }),
              },
            }),
            material: resolveCanonicalMaterialTexture(
              presentedMaterial,
              decodedTexture,
              texturePending,
            ),
            ...(materialLod === undefined ? {} : { materialLodLevel: true as const }),
            materialSource: presentedMaterial,
            ...(lods === undefined ? {} : { lods }),
            model,
            modelHandedness: handedness,
            node,
            normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
            ...(node.kind !== "gltf" || node.ref === undefined ? {} : {
              objectLocalModel: instanceBatch === undefined
                ? primitive.localModel
                : IDENTITY_OBJECT_LOCAL_MODEL,
            }),
            textureKeys: canonicalMaterialTextureKeys(presentedMaterial),
            worldBounds,
          });
          if (includePicking && proxyGeometry === undefined) {
            if (instanceBatch === undefined) {
              pickSurfaces.push({
                ...canonicalPickMaterial(presentedMaterial),
                inverseModel: inverseMat4(model),
                modelHandedness: handedness,
                node,
                ...(lods === undefined ? {} : { lods }),
                ...(node.kind !== "gltf" || node.ref === undefined
                  ? {}
                  : { objectLocalModel: primitive.localModel }),
                pickingGeometry: primitive.geometry,
              });
            } else {
              const localModels = instanceBatch.localModels;
              for (let offset = 0; offset < localModels.length; offset += 16) {
                const objectLocalModel = mat4At(localModels, offset);
                const instanceModel = multiplyMat4Into(
                  identityMat4(),
                  rootModel,
                  objectLocalModel,
                );
                pickSurfaces.push({
                  ...canonicalPickMaterial(presentedMaterial),
                  inverseModel: inverseMat4(instanceModel),
                  ...(sourceIndices === undefined
                    ? {}
                    : { instanceIndex: sourceIndices[offset / 16]! }),
                  modelHandedness: handedness,
                  node,
                  ...(lods === undefined ? {} : { lods }),
                  ...(node.kind !== "gltf" || node.ref === undefined
                    ? {}
                    : { objectLocalModel }),
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
    const wireframe = node.material.kind === "wireframe";
    const geometry = wireframe
      ? wireframeGeometry(node.geometry)
      : directGeometry(node.geometry, material.requiresTextureCoordinates);
    const model = transformMat4(node.transform);
    const inverseModel = includePicking ? inverseMat4(model) : undefined;
    const surface = {
      geometry,
      model,
      modelHandedness: canonicalModelHandedness(model),
      material,
      materialSource,
      node,
      normalTransform: affineSurfaceNormalTransformInto(identityMat4(), model),
      ...(node.ref === undefined
        ? {}
        : { objectLocalModel: IDENTITY_OBJECT_LOCAL_MODEL }),
      textureKeys: canonicalMaterialTextureKeys(materialSource),
      ...(wireframe ? { topology: "lines" as const } : {}),
      worldBounds: transformedWorldBounds(geometry.bounds, model),
    };
    emittedSurfaces.push(surface);
    if (includePicking) {
      const pickingGeometry = node.pickingGeometry === undefined
        ? directGeometry(node.geometry)
        : directGeometry(node.pickingGeometry);
      pickSurfaces.push(node.pickingGeometry === undefined ? {
        ...canonicalPickMaterial(materialSource),
        inverseModel,
        modelHandedness: surface.modelHandedness,
        node,
        ...(node.ref === undefined
          ? {}
          : { objectLocalModel: IDENTITY_OBJECT_LOCAL_MODEL }),
        pickingGeometry,
      } : {
        ...(materialSource.doubleSided === true ? { doubleSided: true as const } : {}),
        inverseModel,
        modelHandedness: surface.modelHandedness,
        node,
        ...(node.ref === undefined
          ? {}
          : { objectLocalModel: IDENTITY_OBJECT_LOCAL_MODEL }),
        pickingGeometry,
      });
    }
  }
  if (options.automaticInstancing !== false) {
    surfaces = automaticallyInstanceCanonicalSurfaces(surfaces);
  }
  type MutableRenderObjectBinding = {
    lights: CanonicalRenderObjectLightBinding[];
    pickSurfaceIndices: number[];
    surfaceIndices: number[];
  };
  let renderObjects: Map<MeshNode | GltfNode, MutableRenderObjectBinding> | undefined;
  const renderObjectBinding = (node: MeshNode | GltfNode) => {
    renderObjects ??= new Map();
    let binding = renderObjects.get(node);
    if (binding === undefined) {
      binding = { lights: [], pickSurfaceIndices: [], surfaceIndices: [] };
      renderObjects.set(node, binding);
    }
    return binding;
  };
  for (const node of scene.nodes) {
    if ((node.kind === "mesh" || node.kind === "gltf") && node.ref !== undefined) {
      renderObjectBinding(node);
    }
  }
  for (let index = 0; index < surfaces.length; index += 1) {
    const node = surfaces[index]!.node;
    if ((node.kind === "mesh" || node.kind === "gltf") && node.ref !== undefined) {
      renderObjectBinding(node).surfaceIndices.push(index);
    }
  }
  for (let index = 0; index < pickSurfaces.length; index += 1) {
    const node = pickSurfaces[index]!.node;
    if ((node.kind === "mesh" || node.kind === "gltf") && node.ref !== undefined) {
      renderObjectBinding(node).pickSurfaceIndices.push(index);
    }
  }
  for (const { binding, node } of renderObjectLights) {
    renderObjectBinding(node).lights.push(binding);
  }
  return {
    alphaMaskTextureAssets: collectCanonicalAlphaMaskTextureAssets(pickSurfaces),
    camera,
    directionalLights,
    instanceLightSources,
    ...(environment === undefined ? {} : { environment }),
    exposure: sceneExposure(scene),
    gltfNodes,
    lodGroups: indexSurfaceLods(surfaces),
    pickSurfaces,
    punctualLights,
    renderObjects: renderObjects ?? EMPTY_RENDER_OBJECTS,
    surfaces,
    textureAssets: collectCanonicalSurfaceTextureAssets(surfaces),
    textureSurfaceIndices: indexSurfaceTextures(surfaces),
    virtualTextureAssets,
    toneMapping: scene.toneMapping ?? "pbr-neutral",
    volumes,
  };
};

/** Re-resolves each surface affected by a batch of newly published decoded textures once. */
export const refreshCanonicalSurfaceTextures = (
  scene: CanonicalSurfaceScene,
  textureKeys: Iterable<string>,
  decodedTexture: (asset: TextureSourceRef) => DecodedTextureSource | undefined,
  texturePending: (asset: TextureSourceRef) => boolean = () => true,
): CanonicalSurfaceScene => {
  const affected = new Set<number>();
  for (const textureKey of textureKeys) {
    const indices = scene.textureSurfaceIndices.get(textureKey);
    if (indices === undefined) continue;
    for (const index of indices) affected.add(index);
  }
  if (affected.size === 0) return scene;
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

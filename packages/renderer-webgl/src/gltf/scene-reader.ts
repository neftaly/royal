import type { LinearRgba, TextureContentKey, TextureSampler } from "@royal/renderer-core";
import {
  identityMat4,
  multiplyMat4,
  transformDirection,
  transformPoint,
  type Mat4,
} from "../math/mat4";
import { worldBounds, type Bounds3, type MutableBounds3 } from "../math/picking";
import { normalizeLodThresholds, type LodLevelMembership } from "../lod";
import { resolveResourceUri } from "../resource-io";
import {
  createGltfAccessorReader,
  gltfComponentCount,
  type GltfAccessorReader,
} from "./accessors";
import type { DecodedGltfDracoPrimitive } from "./codecs/draco";
import { readGltfSceneImageBasedLight } from "./image-based-light";
import { gltfImageLoadKey, type GltfImageKind } from "./image-keys";
import type {
  GltfContentExtras,
  GltfDocument,
  GltfImage,
  GltfMeshPrimitive,
  GltfPunctualLight,
  GltfSampler,
  GltfSceneNode,
  GltfTexture,
  GltfTextureInfo,
} from "./schema";
import { gltfTextureCoordinates } from "./texture-coordinates";
import {
  gltfInstanceTransformMat4,
  gltfInstancingAttributeCount,
  gltfNodeMat4,
} from "./transforms";
import type {
  GltfGeometryDrawMode,
  LoadedGltfMaterialTextureSlot,
  LoadedGltfPrimitive,
  LoadedGltfPrimitiveMaterial,
} from "./prepared-asset";
import {
  createGltfMaterialReader,
  readGltfMaterial,
  readGltfMaterialLod,
  readGltfMaterialVariants,
  type GltfMaterialReader,
} from "./material-reader";
import { finiteNumber, positiveFiniteNumber } from "./numbers";
import type { SurfaceImageBasedLight, SurfaceLight } from "../webgl/lights";

export type GltfSceneReaderDiagnosticSink = {
  readonly recordDiagnostic: (message: string, dedupeKey?: string) => void;
};

export type GltfSceneFacts = {
  /** Aggregate asset-space bounds after authored node and instance transforms. */
  readonly bounds?: Bounds3;
  readonly hasMaterialLod: boolean;
  readonly hasMaterialVariants: boolean;
  readonly hasNodeLod: boolean;
  readonly imageBasedLight?: SurfaceImageBasedLight;
  readonly lights: readonly SurfaceLight[];
  readonly primitives: readonly LoadedGltfPrimitive[];
  readonly variants: readonly string[];
};

const aggregateSceneBounds = (
  primitives: readonly LoadedGltfPrimitive[],
): Bounds3 | undefined => {
  let aggregate: MutableBounds3 | undefined;
  for (const primitive of primitives) {
    for (const bounds of primitive.localBounds) {
      if (bounds === undefined) continue;
      if (aggregate === undefined) {
        aggregate = {
          max: [...bounds.max] as [number, number, number],
          min: [...bounds.min] as [number, number, number],
        };
        continue;
      }
      aggregate.max[0] = Math.max(aggregate.max[0], bounds.max[0]);
      aggregate.max[1] = Math.max(aggregate.max[1], bounds.max[1]);
      aggregate.max[2] = Math.max(aggregate.max[2], bounds.max[2]);
      aggregate.min[0] = Math.min(aggregate.min[0], bounds.min[0]);
      aggregate.min[1] = Math.min(aggregate.min[1], bounds.min[1]);
      aggregate.min[2] = Math.min(aggregate.min[2], bounds.min[2]);
    }
  }
  return aggregate;
};

export type ReadGltfSceneInput = {
  readonly assetKey: string;
  readonly buffers: readonly ArrayBuffer[];
  readonly diagnostics: GltfSceneReaderDiagnosticSink;
  readonly document: GltfDocument;
  readonly dracoPrimitives: ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>;
  readonly src: string;
};

type GltfTextureImageSelection = {
  readonly imageIndex: number;
  readonly kind: GltfImageKind;
};

const gltfSamplerMagFilter = (value: number | undefined): NonNullable<TextureSampler["magFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    default:
      return "linear";
  }
};

const gltfSamplerMinFilter = (value: number | undefined): NonNullable<TextureSampler["minFilter"]> => {
  switch (value) {
    case 9728:
      return "nearest";
    case 9729:
      return "linear";
    case 9984:
      return "nearest-mipmap-nearest";
    case 9985:
      return "linear-mipmap-nearest";
    case 9986:
      return "nearest-mipmap-linear";
    default:
      return "linear-mipmap-linear";
  }
};

const gltfSamplerWrap = (value: number | undefined): NonNullable<TextureSampler["wrapS"]> => {
  switch (value) {
    case 33071:
      return "clamp-to-edge";
    case 33648:
      return "mirrored-repeat";
    default:
      return "repeat";
  }
};

const gltfTextureSampler = (sampler: GltfSampler | undefined): TextureSampler => ({
  magFilter: gltfSamplerMagFilter(sampler?.magFilter),
  minFilter: gltfSamplerMinFilter(sampler?.minFilter),
  wrapS: gltfSamplerWrap(sampler?.wrapS),
  wrapT: gltfSamplerWrap(sampler?.wrapT),
});

const gltfTextureIdentity = (
  assetKey: string,
  src: string,
  textureIndex: number,
  imageIndex: number | undefined,
  image: GltfImage,
  kind: GltfImageKind,
): string => {
  if (image.uri !== undefined) {
    const prefix = kind === "basisu" ? "basisu-uri" : kind === "svg" ? "svg-uri" : "image-uri";
    return `${assetKey}:${prefix}:${resolveResourceUri(src, image.uri)}`;
  }
  if (image.bufferView !== undefined) {
    const prefix = kind === "basisu" ? "basisu-buffer-view" : kind === "svg" ? "svg-buffer-view" : "image-buffer-view";
    return `${assetKey}:${prefix}:${image.bufferView}:${image.mimeType ?? ""}`;
  }
  return `${assetKey}:texture-index:${textureIndex}:image-index:${imageIndex ?? ""}`;
};

const gltfContentKeyFromExtras = (extras: GltfContentExtras | undefined): TextureContentKey | undefined => {
  const contentKey = extras?.contentKey;
  return typeof contentKey === "number" || typeof contentKey === "string" ? contentKey : undefined;
};

const gltfTextureContentKey = (
  texture: GltfTexture | undefined,
  image: GltfImage | undefined,
): TextureContentKey | undefined =>
  gltfContentKeyFromExtras(texture?.extras) ?? gltfContentKeyFromExtras(image?.extras);

const gltfImageSourceUri = (src: string, image: GltfImage | undefined): string | undefined =>
  image?.uri === undefined ? undefined : resolveResourceUri(src, image.uri);

const gltfImageIsSvg = (image: GltfImage | undefined): boolean => {
  if (image?.mimeType?.toLowerCase() === "image/svg+xml") return true;
  if (image?.uri === undefined) return false;
  if (/^data:/iu.test(image.uri)) {
    return /^data:image\/svg\+xml(?:[;,])/iu.test(image.uri);
  }
  return /\.svg(?:$|[?#])/iu.test(image.uri);
};

const gltfTextureImageSelection = (
  document: GltfDocument,
  texture: GltfTexture | undefined,
): GltfTextureImageSelection | undefined => {
  const basisuSource = texture?.extensions?.KHR_texture_basisu?.source;
  if (basisuSource !== undefined) return { imageIndex: basisuSource, kind: "basisu" };
  const webpSource = texture?.extensions?.EXT_texture_webp?.source;
  const imageIndex = webpSource ?? texture?.source;
  return imageIndex === undefined
    ? undefined
    : { imageIndex, kind: gltfImageIsSvg(document.images?.[imageIndex]) ? "svg" : "image" };
};

const gltfMaterialTextureSlot = (
  document: GltfDocument,
  assetKey: string,
  src: string,
  textureInfo: GltfTextureInfo | undefined,
): LoadedGltfMaterialTextureSlot | undefined => {
  if (textureInfo === undefined) return undefined;
  const textureIndex = textureInfo.index;
  const texture = textureIndex === undefined ? undefined : document.textures?.[textureIndex];
  const imageSelection = gltfTextureImageSelection(document, texture);
  const imageIndex = imageSelection?.imageIndex;
  const imageKind = imageSelection?.kind ?? "image";
  const image = imageIndex === undefined ? undefined : document.images?.[imageIndex];
  const imageUri = image === undefined ? undefined : gltfImageLoadKey(assetKey, src, imageIndex, image, imageKind);
  const sampler = texture === undefined
    ? undefined
    : gltfTextureSampler(texture.sampler === undefined ? undefined : document.samplers?.[texture.sampler]);
  const textureUri = textureIndex === undefined || image === undefined
    ? undefined
    : gltfTextureIdentity(assetKey, src, textureIndex, imageIndex, image, imageKind);
  const contentKey = gltfTextureContentKey(texture, image);
  const sourceUri = gltfImageSourceUri(src, image);
  if (contentKey === undefined && imageUri === undefined && sampler === undefined
    && sourceUri === undefined && textureUri === undefined) return undefined;
  return {
    ...(contentKey === undefined ? {} : { contentKey }),
    ...(imageUri === undefined ? {} : { imageUri }),
    ...(sampler === undefined ? {} : { sampler }),
    ...(sourceUri === undefined ? {} : { sourceUri }),
    ...(textureUri === undefined ? {} : { textureUri }),
    coordinates: gltfTextureCoordinates(textureInfo),
  };
};

const gltfLightColor = (light: GltfPunctualLight): LinearRgba => {
  const intensity = Math.max(0, finiteNumber(light.intensity, 1));
  return [
    (light.color?.[0] ?? 1) * intensity,
    (light.color?.[1] ?? 1) * intensity,
    (light.color?.[2] ?? 1) * intensity,
    1,
  ];
};

const gltfSpotConeAngles = (light: GltfPunctualLight): { readonly innerConeAngle: number; readonly outerConeAngle: number } => {
  const outerConeAngle = Math.min(Math.PI / 2, Math.max(0.0001, finiteNumber(light.spot?.outerConeAngle, Math.PI / 4)));
  const innerConeAngle = Math.min(outerConeAngle - 0.0001, Math.max(0, finiteNumber(light.spot?.innerConeAngle, 0)));
  return { innerConeAngle, outerConeAngle };
};

const gltfPrimitiveMode = (mode: number | undefined): GltfGeometryDrawMode | undefined => {
  switch (mode ?? 4) {
    case 0: return "points";
    case 1: return "lines";
    case 2: return "line-loop";
    case 3: return "line-strip";
    case 4: return "triangles";
    case 5: return "triangle-strip";
    case 6: return "triangle-fan";
    default: return undefined;
  }
};

const gltfPrimitiveTexCoords = (
  accessors: GltfAccessorReader,
  primitive: GltfMeshPrimitive,
  set: 0 | 1,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const semantic = `TEXCOORD_${set}`;
  const decodedTexCoords = decodedAttributes?.get(semantic);
  if (decodedTexCoords !== undefined) return decodedTexCoords;
  const accessor = primitive.attributes?.[semantic];
  return accessor === undefined ? undefined : accessors.float(accessor);
};

const gltfVertexColors = (
  document: GltfDocument,
  accessors: GltfAccessorReader,
  primitive: GltfMeshPrimitive,
  positions: Float32Array,
  decodedAttributes: ReadonlyMap<string, Float32Array> | undefined,
): Float32Array | undefined => {
  const colorAccessor = primitive.attributes?.COLOR_0;
  const colors = decodedAttributes?.get("COLOR_0")
    ?? (colorAccessor === undefined ? undefined : accessors.float(colorAccessor));
  if (colors === undefined) return undefined;
  const vertexCount = positions.length / 3;
  const accessorComponentCount = colorAccessor === undefined
    ? undefined
    : gltfComponentCount(document.accessors?.[colorAccessor]?.type ?? "VEC4");
  const componentCount = accessorComponentCount ?? colors.length / Math.max(vertexCount, 1);
  if (componentCount === 4 && colors.length === vertexCount * 4) return colors;
  if (componentCount !== 3 || colors.length !== vertexCount * 3) return undefined;
  const output = new Float32Array(vertexCount * 4);
  for (let index = 0; index < vertexCount; index += 1) {
    output.set([colors[index * 3] ?? 1, colors[index * 3 + 1] ?? 1, colors[index * 3 + 2] ?? 1, 1], index * 4);
  }
  return output;
};

const mat4OrientationDeterminant = (matrix: Mat4): number =>
  matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
  - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
  + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

const gltfNodeInstanceTransforms = (
  document: GltfDocument,
  accessors: GltfAccessorReader,
  sceneNode: GltfSceneNode,
  nodeIndex: number,
  diagnostics: GltfSceneReaderDiagnosticSink,
): readonly Mat4[] => {
  const attributes = sceneNode.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (attributes === undefined) return [identityMat4()];
  const entries = Object.entries(attributes);
  if (entries.length === 0) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing has no attributes`);
  for (const [semantic, accessorIndex] of entries) {
    if (typeof accessorIndex !== "number" || !Number.isInteger(accessorIndex) || accessorIndex < 0
      || document.accessors?.[accessorIndex] === undefined) {
      throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} references invalid accessor ${accessorIndex}`);
    }
  }
  const typedEntries = entries as [string, number][];
  const counts = typedEntries.map(([, accessorIndex]) => gltfInstancingAttributeCount(document, accessorIndex)!);
  if (new Set(counts).size !== 1) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing attributes must have matching counts`);
  const instanceCount = counts[0]!;
  const supported = new Set(["ROTATION", "SCALE", "TRANSLATION"]);
  const unsupported = typedEntries.map(([semantic]) => semantic).filter((semantic) => !supported.has(semantic));
  if (unsupported.length > 0) diagnostics.recordDiagnostic(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ignored custom attributes: ${unsupported.join(", ")}`);
  const validate = (semantic: "ROTATION" | "SCALE" | "TRANSLATION"): void => {
    const accessorIndex = attributes[semantic];
    if (accessorIndex === undefined) return;
    const accessor = document.accessors![accessorIndex]!;
    const valid = semantic === "ROTATION"
      ? accessor.type === "VEC4" && (accessor.componentType === 5126
        || ((accessor.componentType === 5120 || accessor.componentType === 5122) && accessor.normalized === true))
      : accessor.type === "VEC3" && accessor.componentType === 5126 && accessor.normalized !== true;
    if (!valid) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} has an invalid accessor format`);
  };
  validate("TRANSLATION");
  validate("ROTATION");
  validate("SCALE");
  const translations = attributes.TRANSLATION === undefined ? undefined : accessors.float(attributes.TRANSLATION);
  const rotations = attributes.ROTATION === undefined ? undefined : accessors.float(attributes.ROTATION);
  const scales = attributes.SCALE === undefined ? undefined : accessors.float(attributes.SCALE);
  for (const [semantic, values] of [["TRANSLATION", translations], ["ROTATION", rotations], ["SCALE", scales]] as const) {
    if (values?.some((value) => !Number.isFinite(value)) === true) {
      throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ${semantic} contains non-finite values`);
    }
  }
  if (rotations !== undefined) {
    for (let index = 0; index < instanceCount; index += 1) {
      const offset = index * 4;
      const lengthSquared = rotations[offset]! ** 2 + rotations[offset + 1]! ** 2
        + rotations[offset + 2]! ** 2 + rotations[offset + 3]! ** 2;
      if (!(lengthSquared > 1e-12)) throw new Error(`glTF node ${nodeIndex} EXT_mesh_gpu_instancing ROTATION ${index} is a zero quaternion`);
    }
  }
  return Array.from({ length: instanceCount }, (_, index) => gltfInstanceTransformMat4(translations, rotations, scales, index));
};

type TraversalContext = ReadGltfSceneInput & {
  readonly accessors: GltfAccessorReader;
  readonly lights: SurfaceLight[];
  readonly materialReader: GltfMaterialReader;
  readonly primitives: LoadedGltfPrimitive[];
  readonly referencedLodNodes: ReadonlySet<number>;
  readonly variantCount: number;
};

const appendNodeLight = (
  context: TraversalContext,
  sceneNode: GltfSceneNode,
  nodeIndex: number,
  nodeModel: Mat4,
): void => {
  const lightIndex = sceneNode.extensions?.KHR_lights_punctual?.light;
  if (lightIndex === undefined) return;
  if (!Number.isInteger(lightIndex) || lightIndex < 0) {
    context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: invalid light index ${lightIndex}`);
    return;
  }
  const light = context.document.extensions?.KHR_lights_punctual?.lights?.[lightIndex];
  if (light === undefined) {
    context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: missing light ${lightIndex}`);
    return;
  }
  const color = gltfLightColor(light);
  const direction = transformDirection(nodeModel, [0, 0, -1]);
  const position = transformPoint(nodeModel, [0, 0, 0]);
  const range = positiveFiniteNumber(light.range);
  switch (light.type) {
    case "directional":
      context.lights.push({ color, direction, kind: "directional" });
      return;
    case "point":
      context.lights.push({ color, kind: "point", position, ...(range === undefined ? {} : { range }) });
      return;
    case "spot": {
      const { innerConeAngle, outerConeAngle } = gltfSpotConeAngles(light);
      context.lights.push({ color, direction, innerConeAngle, kind: "spot", outerConeAngle, position, ...(range === undefined ? {} : { range }) });
      return;
    }
    default:
      context.diagnostics.recordDiagnostic(`glTF node ${nodeIndex} KHR_lights_punctual skipped: unsupported light type ${light.type ?? "missing"}`);
  }
};

const appendNodeTreePrimitives = (
  context: TraversalContext,
  nodeIndex: number,
  parentModel: Mat4,
  parentPath: readonly number[],
  nodeLod?: LodLevelMembership,
  applyOwnLod = true,
): void => {
  const sceneNode = context.document.nodes?.[nodeIndex];
  if (sceneNode === undefined) return;
  if (parentPath.includes(nodeIndex)) {
    context.diagnostics.recordDiagnostic(
      `glTF node tree cycle skipped at node ${nodeIndex}`,
      `gltf-node-cycle:${context.assetKey}:${[...parentPath, nodeIndex].join(":")}`,
    );
    return;
  }
  const lodIds = applyOwnLod
    ? (sceneNode.extensions?.MSFT_lod?.ids ?? [])
      .filter((id) => Number.isInteger(id) && id >= 0 && context.document.nodes?.[id] !== undefined)
    : [];
  if (lodIds.length > 0) {
    const levelCount = lodIds.length + 1;
    const thresholds = normalizeLodThresholds(sceneNode.extras?.MSFT_screencoverage, levelCount);
    const group = `node:${nodeIndex}`;
    appendNodeTreePrimitives(context, nodeIndex, parentModel, parentPath, { group, level: 0, levelCount, thresholds }, false);
    for (const [lodIndex, lodNodeIndex] of lodIds.entries()) {
      appendNodeTreePrimitives(context, lodNodeIndex, parentModel, parentPath, {
        group,
        level: lodIndex + 1,
        levelCount,
        thresholds,
      }, false);
    }
    return;
  }
  const nodePath = [...parentPath, nodeIndex];
  const nodeModel = multiplyMat4(parentModel, gltfNodeMat4(sceneNode));
  appendNodeLight(context, sceneNode, nodeIndex, nodeModel);
  const instanceTransforms = gltfNodeInstanceTransforms(context.document, context.accessors, sceneNode, nodeIndex, context.diagnostics);
  const localModels = instanceTransforms.map((transform) => multiplyMat4(nodeModel, transform));
  const localModelDeterminants = localModels.map(mat4OrientationDeterminant);
  const mesh = sceneNode.mesh === undefined ? undefined : context.document.meshes?.[sceneNode.mesh];
  for (const [primitiveIndex, primitive] of (mesh?.primitives ?? []).entries()) {
    const dracoPrimitive = context.dracoPrimitives.get(primitive);
    const decodedAttributes = dracoPrimitive?.attributes;
    const positionAccessor = primitive.attributes?.POSITION;
    const positions = decodedAttributes?.get("POSITION")
      ?? (positionAccessor === undefined ? undefined : context.accessors.float(positionAccessor));
    if (positions === undefined) continue;
    const mode = gltfPrimitiveMode(primitive.mode);
    if (mode === undefined) {
      const unsupportedMode = primitive.mode ?? 4;
      context.diagnostics.recordDiagnostic(
        `glTF primitive ${nodeIndex}:${primitiveIndex} skipped: unsupported primitive mode ${unsupportedMode}`,
        `gltf-primitive-mode:${context.assetKey}:${unsupportedMode}`,
      );
      continue;
    }
    const normalAccessor = primitive.attributes?.NORMAL;
    const tangentAccessor = primitive.attributes?.TANGENT;
    const baseNormals = decodedAttributes?.get("NORMAL")
      ?? (normalAccessor === undefined ? undefined : context.accessors.float(normalAccessor));
    const tangents = decodedAttributes?.get("TANGENT")
      ?? (tangentAccessor === undefined ? undefined : context.accessors.float(tangentAccessor));
    const colors = gltfVertexColors(context.document, context.accessors, primitive, positions, decodedAttributes);
    const texCoords0 = gltfPrimitiveTexCoords(context.accessors, primitive, 0, decodedAttributes);
    const texCoords1 = gltfPrimitiveTexCoords(context.accessors, primitive, 1, decodedAttributes);
    const indices = dracoPrimitive?.indices
      ?? (primitive.indices === undefined ? undefined : context.accessors.indices(primitive.indices));
    const normals = baseNormals;
    const material = readGltfMaterial(context.materialReader, primitive.material);
    const materialLod = readGltfMaterialLod(context.materialReader, primitive.material);
    const materialVariants = readGltfMaterialVariants(
      context.materialReader,
      primitive,
      context.variantCount,
    );
    const baseMaterial: LoadedGltfPrimitiveMaterial = {
      material,
      ...(materialLod === undefined ? {} : { materialLod }),
      selectionKey: "base",
    };
    context.primitives.push({
      baseMaterial,
      ...(colors === undefined ? {} : { colors }),
      ...(indices === undefined ? {} : { indices }),
      instanceTransforms,
      key: `node:${nodeIndex}:primitive:${primitiveIndex}`,
      localBounds: localModels.map((model) => worldBounds(positions, model)),
      localModelDeterminants,
      localModels,
      material,
      ...(materialLod === undefined ? {} : { materialLod }),
      ...(materialVariants.length === 0 ? {} : { materialVariants }),
      mode,
      meshNodeIndex: nodeIndex,
      nodePath,
      ...(nodeLod === undefined ? {} : { nodeLod }),
      ...(normals === undefined ? {} : { normals }),
      objectBounds: worldBounds(positions, identityMat4()),
      positions,
      ...(tangents === undefined ? {} : { tangents }),
      ...(texCoords0 === undefined ? {} : { texCoords0 }),
      ...(texCoords1 === undefined ? {} : { texCoords1 }),
    });
  }
  for (const childIndex of sceneNode.children ?? []) {
    if (context.referencedLodNodes.has(childIndex)) continue;
    appendNodeTreePrimitives(context, childIndex, nodeModel, nodePath, nodeLod, nodeLod === undefined);
  }
};

/** Reads decoded glTF data into renderer-ready, WebGL-independent scene facts. */
export const readGltfScene = (input: ReadGltfSceneInput): GltfSceneFacts => {
  const lights: SurfaceLight[] = [];
  const primitives: LoadedGltfPrimitive[] = [];
  const variants = Object.freeze((input.document.extensions?.KHR_materials_variants?.variants ?? [])
    .map((variant, index) => typeof variant.name === "string" ? variant.name : String(index)));
  const sceneIndex = input.document.scene ?? 0;
  const imageBasedLight = readGltfSceneImageBasedLight(input.document, input.src, input.assetKey, sceneIndex, {
    recordDiagnostic: (message) => input.diagnostics.recordDiagnostic(message),
    recordUnsupportedGltfImageBasedLight: (message) =>
      input.diagnostics.recordDiagnostic(message, `gltf-image-based-light:${message}`),
  });
  const referencedLodNodes = new Set<number>();
  for (const node of input.document.nodes ?? []) {
    for (const id of node.extensions?.MSFT_lod?.ids ?? []) {
      if (Number.isInteger(id) && id >= 0) referencedLodNodes.add(id);
    }
  }
  const context: TraversalContext = {
    ...input,
    accessors: createGltfAccessorReader(input.document, input.buffers),
    lights,
    materialReader: createGltfMaterialReader(
      input.document,
      (textureInfo) => gltfMaterialTextureSlot(
        input.document,
        input.assetKey,
        input.src,
        textureInfo,
      ),
    ),
    primitives,
    referencedLodNodes,
    variantCount: variants.length,
  };
  for (const nodeIndex of input.document.scenes?.[sceneIndex]?.nodes ?? []) {
    if (!referencedLodNodes.has(nodeIndex)) appendNodeTreePrimitives(context, nodeIndex, identityMat4(), []);
  }
  const bounds = aggregateSceneBounds(primitives);
  return {
    ...(bounds === undefined ? {} : { bounds }),
    hasMaterialLod: primitives.some((primitive) => primitive.materialLod !== undefined
      || primitive.materialVariants?.some((variant) => variant.materialLod !== undefined) === true),
    hasMaterialVariants: primitives.some((primitive) => primitive.materialVariants !== undefined),
    hasNodeLod: primitives.some((primitive) => primitive.nodeLod !== undefined),
    ...(imageBasedLight === undefined ? {} : { imageBasedLight }),
    lights,
    primitives,
    variants,
  };
};

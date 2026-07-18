import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { TextureSampler } from "@royal/renderer-core";
import type {
  EmbeddedTextureAssetRef,
  TextureSourceRef,
} from "../texture/asset-owner";
import type { DecodedDracoPrimitive } from "./draco";
import { parseGlb } from "./glb";
import {
  prepareStaticInstanceBatches,
  type StaticInstanceBatch,
} from "./instance-transforms";

export type PreparedStaticGltfPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  instanceBatch?: StaticInstanceBatch & Readonly<{ key: string }>;
  localModel: Mat4;
  material: CanonicalSurfaceMaterial;
}>;

export type PreparedStaticGltf = Readonly<{
  primitives: readonly PreparedStaticGltfPrimitive[];
  textureAssets: readonly TextureSourceRef[];
}>;

type JsonObject = Record<string, unknown>;
type IndexArray = Uint8Array | Uint16Array | Uint32Array;
type StaticDracoDecoder = (
  primitive: JsonObject,
  path: string,
) => DecodedDracoPrimitive;

const fail = (label: string, path: string, detail: string): never => {
  throw new Error(`${label} ${path}: ${detail}`);
};

const object = (value: unknown, label: string, path: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    fail(label, path, "must be an object");
  }
  return value as JsonObject;
};

const array = (value: unknown, label: string, path: string): unknown[] => {
  if (!Array.isArray(value)) fail(label, path, "must be an array");
  return value as unknown[];
};

const optionalArray = (value: unknown, label: string, path: string): unknown[] =>
  value === undefined ? [] : array(value, label, path);

const integer = (value: unknown, label: string, path: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    fail(label, path, "must be a safe integer");
  }
  return value as number;
};

const nonNegativeInteger = (value: unknown, label: string, path: string): number => {
  const result = integer(value, label, path);
  if (result < 0) fail(label, path, "must not be negative");
  return result;
};

const index = (value: unknown, values: readonly unknown[], label: string, path: string): number => {
  const result = nonNegativeInteger(value, label, path);
  if (result >= values.length) fail(label, path, `index ${result} is out of range`);
  return result;
};

const finiteTuple = (
  value: unknown,
  length: number,
  fallback: readonly number[],
  label: string,
  path: string,
): number[] => {
  if (value === undefined) return [...fallback];
  const values = array(value, label, path);
  if (values.length !== length) fail(label, path, `must contain ${length} numbers`);
  return values.map((component, componentIndex) => {
    if (typeof component !== "number" || !Number.isFinite(component)) {
      fail(label, `${path}[${componentIndex}]`, "must be finite");
    }
    return component as number;
  });
};

const nodeLocalMatrix = (node: JsonObject, label: string, path: string): Mat4 => {
  if (node.matrix !== undefined) {
    if (node.translation !== undefined || node.rotation !== undefined || node.scale !== undefined) {
      fail(label, path, "matrix cannot be combined with translation, rotation, or scale");
    }
    return finiteTuple(node.matrix, 16, [], label, `${path}.matrix`) as unknown as Mat4;
  }
  const translation = finiteTuple(
    node.translation, 3, [0, 0, 0], label, `${path}.translation`,
  );
  const rotation = finiteTuple(node.rotation, 4, [0, 0, 0, 1], label, `${path}.rotation`);
  const scale = finiteTuple(node.scale, 3, [1, 1, 1], label, `${path}.scale`);
  const length = Math.hypot(rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!);
  if (!(length > 0)) fail(label, `${path}.rotation`, "must be a non-zero quaternion");
  const x = rotation[0]! / length;
  const y = rotation[1]! / length;
  const z = rotation[2]! / length;
  const w = rotation[3]! / length;
  const xx = x * x; const xy = x * y; const xz = x * z; const xw = x * w;
  const yy = y * y; const yz = y * z; const yw = y * w;
  const zz = z * z; const zw = z * w;
  return [
    (1 - 2 * (yy + zz)) * scale[0]!,
    2 * (xy + zw) * scale[0]!,
    2 * (xz - yw) * scale[0]!,
    0,
    2 * (xy - zw) * scale[1]!,
    (1 - 2 * (xx + zz)) * scale[1]!,
    2 * (yz + xw) * scale[1]!,
    0,
    2 * (xz + yw) * scale[2]!,
    2 * (yz - xw) * scale[2]!,
    (1 - 2 * (xx + yy)) * scale[2]!,
    0,
    translation[0]!, translation[1]!, translation[2]!, 1,
  ];
};

type AccessorContext = Readonly<{
  accessors: unknown[];
  binary: Uint8Array;
  bufferByteLength: number;
  bufferViews: unknown[];
  label: string;
}>;

type AccessorLayout = Readonly<{
  absoluteOffset: number;
  componentType: number;
  count: number;
  dataView: DataView;
  stride: number;
}>;

const accessorLayout = (
  context: AccessorContext,
  accessorIndex: number,
  expectedType: string,
  componentBytes: number,
  componentCount: number,
  allowNormalized = false,
): AccessorLayout & { accessor: JsonObject } => {
  const path = `accessors[${accessorIndex}]`;
  const accessor = object(context.accessors[accessorIndex], context.label, path);
  if (accessor.type !== expectedType) fail(context.label, `${path}.type`, `must be ${expectedType}`);
  if (accessor.sparse !== undefined) fail(context.label, `${path}.sparse`, "is not in the static profile yet");
  if (accessor.normalized === true && !allowNormalized) {
    fail(context.label, `${path}.normalized`, "is invalid for this accessor");
  }
  const count = nonNegativeInteger(accessor.count, context.label, `${path}.count`);
  const viewIndex = index(
    accessor.bufferView, context.bufferViews, context.label, `${path}.bufferView`,
  );
  const bufferViewPath = `bufferViews[${viewIndex}]`;
  const bufferView = object(context.bufferViews[viewIndex], context.label, bufferViewPath);
  if (bufferView.buffer !== 0) fail(context.label, `${bufferViewPath}.buffer`, "must reference GLB buffer 0");
  const viewOffset = bufferView.byteOffset === undefined
    ? 0
    : nonNegativeInteger(bufferView.byteOffset, context.label, `${bufferViewPath}.byteOffset`);
  const viewLength = nonNegativeInteger(
    bufferView.byteLength, context.label, `${bufferViewPath}.byteLength`,
  );
  if (viewOffset + viewLength > context.bufferByteLength) {
    fail(context.label, bufferViewPath, "exceeds the declared GLB buffer");
  }
  const accessorOffset = accessor.byteOffset === undefined
    ? 0
    : nonNegativeInteger(accessor.byteOffset, context.label, `${path}.byteOffset`);
  const elementBytes = componentCount * componentBytes;
  const stride = bufferView.byteStride === undefined
    ? elementBytes
    : nonNegativeInteger(bufferView.byteStride, context.label, `${bufferViewPath}.byteStride`);
  if (stride < elementBytes || stride % componentBytes !== 0) {
    fail(context.label, `${bufferViewPath}.byteStride`, "is incompatible with the accessor");
  }
  const requiredBytes = count === 0 ? 0 : (count - 1) * stride + elementBytes;
  if (!Number.isSafeInteger(requiredBytes) || accessorOffset + requiredBytes > viewLength) {
    fail(context.label, path, "exceeds its bufferView");
  }
  const absoluteOffset = viewOffset + accessorOffset;
  if (absoluteOffset % componentBytes !== 0) fail(context.label, path, "is misaligned");
  return {
    absoluteOffset,
    accessor,
    componentType: integer(accessor.componentType, context.label, `${path}.componentType`),
    count,
    dataView: new DataView(
      context.binary.buffer,
      context.binary.byteOffset,
      context.binary.byteLength,
    ),
    stride,
  };
};

type InstanceVectorStream = Readonly<{
  count: number;
  values: Float32Array;
}>;

const readInstanceVectors = (
  context: AccessorContext,
  accessorIndex: number,
  expectedType: "VEC3" | "VEC4",
  componentCount: 3 | 4,
  semantic: "ROTATION" | "SCALE" | "TRANSLATION",
): InstanceVectorStream => {
  const path = `accessors[${accessorIndex}]`;
  const accessor = object(context.accessors[accessorIndex], context.label, path);
  const componentType = integer(accessor.componentType, context.label, `${path}.componentType`);
  const normalizedInteger = semantic === "ROTATION"
    && accessor.normalized === true
    && (componentType === 5120 || componentType === 5122);
  if (componentType !== 5126 && !normalizedInteger) {
    fail(
      context.label,
      `${path}.componentType`,
      semantic === "ROTATION"
        ? "must be FLOAT or normalized BYTE/SHORT"
        : `must be FLOAT for ${semantic}`,
    );
  }
  if (componentType === 5126 && accessor.normalized === true) {
    fail(context.label, `${path}.normalized`, "must be omitted for FLOAT");
  }
  const componentBytes = componentType === 5120 ? 1 : componentType === 5122 ? 2 : 4;
  const layout = accessorLayout(
    context,
    accessorIndex,
    expectedType,
    componentBytes,
    componentCount,
    true,
  );
  if (layout.count === 0) fail(context.label, `${path}.count`, "must be positive");
  const values = new Float32Array(layout.count * componentCount);
  const divisor = componentType === 5120 ? 127 : componentType === 5122 ? 32_767 : 1;
  for (let item = 0; item < layout.count; item += 1) {
    const source = layout.absoluteOffset + item * layout.stride;
    const target = item * componentCount;
    for (let component = 0; component < componentCount; component += 1) {
      const componentOffset = source + component * componentBytes;
      const raw = componentType === 5120
        ? layout.dataView.getInt8(componentOffset)
        : componentType === 5122
          ? layout.dataView.getInt16(componentOffset, true)
          : layout.dataView.getFloat32(componentOffset, true);
      const value = normalizedInteger ? Math.max(raw / divisor, -1) : raw;
      if (!Number.isFinite(value)) {
        fail(context.label, path, `${semantic} ${item} is not finite`);
      }
      values[target + component] = value;
    }
  }
  return { count: layout.count, values };
};

const readPositions = (
  context: AccessorContext,
  accessorIndex: number,
): Pick<CanonicalTriangleGeometry, "bounds" | "positions"> => {
  const layout = accessorLayout(context, accessorIndex, "VEC3", 4, 3);
  if (layout.componentType !== 5126) {
    fail(context.label, `accessors[${accessorIndex}].componentType`, "must be FLOAT");
  }
  const positions = layout.stride === 12
    ? new Float32Array(
      context.binary.buffer,
      context.binary.byteOffset + layout.absoluteOffset,
      layout.count * 3,
    )
    : new Float32Array(layout.count * 3);
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let vertex = 0; vertex < layout.count; vertex += 1) {
    const source = layout.absoluteOffset + vertex * layout.stride;
    const target = vertex * 3;
    const x = layout.dataView.getFloat32(source, true);
    const y = layout.dataView.getFloat32(source + 4, true);
    const z = layout.dataView.getFloat32(source + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      fail(context.label, `accessors[${accessorIndex}]`, `position ${vertex} is not finite`);
    }
    if (layout.stride !== 12) {
      positions[target] = x;
      positions[target + 1] = y;
      positions[target + 2] = z;
    }
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  if (layout.count === 0) fail(context.label, `accessors[${accessorIndex}].count`, "must be positive");
  return {
    bounds: { max: [maxX, maxY, maxZ], min: [minX, minY, minZ] },
    positions,
  };
};

const decodedPositions = (
  values: Float32Array,
  label: string,
  path: string,
): Pick<CanonicalTriangleGeometry, "bounds" | "positions"> => {
  if (values.length === 0 || values.length % 3 !== 0) {
    fail(label, path, "decoded POSITION size is invalid");
  }
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let offset = 0; offset < values.length; offset += 3) {
    const x = values[offset]!; const y = values[offset + 1]!; const z = values[offset + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      fail(label, path, `decoded position ${offset / 3} is not finite`);
    }
    minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
  }
  return {
    bounds: { max: [maxX, maxY, maxZ], min: [minX, minY, minZ] },
    positions: values,
  };
};

const validateDecodedVectors = (
  values: Float32Array,
  componentCount: 2 | 3 | 4,
  label: string,
  path: string,
): Float32Array => {
  if (values.length === 0 || values.length % componentCount !== 0) {
    fail(label, path, "decoded attribute size is invalid");
  }
  for (let offset = 0; offset < values.length; offset += 1) {
    if (!Number.isFinite(values[offset])) {
      fail(label, path, `decoded component ${offset} is not finite`);
    }
  }
  return values;
};

const readFloatVectors = (
  context: AccessorContext,
  accessorIndex: number,
  expectedType: "VEC2" | "VEC3" | "VEC4",
  componentCount: 2 | 3 | 4,
  semantic: string,
): Float32Array => {
  const layout = accessorLayout(context, accessorIndex, expectedType, 4, componentCount);
  if (layout.componentType !== 5126) {
    fail(context.label, `accessors[${accessorIndex}].componentType`, `${semantic} must use FLOAT`);
  }
  if (layout.count === 0) {
    fail(context.label, `accessors[${accessorIndex}].count`, "must be positive");
  }
  const elementBytes = componentCount * 4;
  const values = layout.stride === elementBytes
    ? new Float32Array(
      context.binary.buffer,
      context.binary.byteOffset + layout.absoluteOffset,
      layout.count * componentCount,
    )
    : new Float32Array(layout.count * componentCount);
  for (let item = 0; item < layout.count; item += 1) {
    const source = layout.absoluteOffset + item * layout.stride;
    const target = item * componentCount;
    for (let component = 0; component < componentCount; component += 1) {
      const value = layout.dataView.getFloat32(source + component * 4, true);
      if (!Number.isFinite(value)) {
        fail(context.label, `accessors[${accessorIndex}]`, `${semantic} ${item} is not finite`);
      }
      if (layout.stride !== elementBytes) values[target + component] = value;
    }
  }
  return values;
};

const sequentialIndices = (count: number): IndexArray => {
  const indices: IndexArray = count <= 0x100
    ? new Uint8Array(count)
    : count <= 0x1_00_00 ? new Uint16Array(count) : new Uint32Array(count);
  for (let index = 0; index < count; index += 1) indices[index] = index;
  return indices;
};

const readIndices = (
  context: AccessorContext,
  accessorIndex: number | undefined,
  vertexCount: number,
): IndexArray => {
  if (accessorIndex === undefined) return sequentialIndices(vertexCount);
  const preliminary = object(
    context.accessors[accessorIndex], context.label, `accessors[${accessorIndex}]`,
  );
  const componentType = integer(
    preliminary.componentType, context.label, `accessors[${accessorIndex}].componentType`,
  );
  const componentBytes = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  if (componentType !== 5121 && componentType !== 5123 && componentType !== 5125) {
    fail(context.label, `accessors[${accessorIndex}].componentType`, "must be an unsigned integer");
  }
  const layout = accessorLayout(context, accessorIndex, "SCALAR", componentBytes, 1);
  if (layout.stride !== componentBytes) {
    fail(context.label, `accessors[${accessorIndex}]`, "index accessors cannot be interleaved");
  }
  const byteOffset = context.binary.byteOffset + layout.absoluteOffset;
  const indices: IndexArray = componentType === 5121
    ? new Uint8Array(context.binary.buffer, byteOffset, layout.count)
    : componentType === 5123
      ? new Uint16Array(context.binary.buffer, byteOffset, layout.count)
      : new Uint32Array(context.binary.buffer, byteOffset, layout.count);
  for (let item = 0; item < indices.length; item += 1) {
    if (indices[item]! >= vertexCount) {
      fail(context.label, `accessors[${accessorIndex}][${item}]`, "vertex index is out of range");
    }
  }
  return indices;
};

const factor01 = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  if (value < 0 || value > 1) fail(label, path, "must be within 0..1");
  return value;
};

const finiteFactor = (
  value: unknown,
  fallback: number,
  label: string,
  path: string,
): number => {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fail(label, path, "must be finite");
  }
  return value;
};

const resolveAssetUri = (baseUri: string, uri: string): string => {
  try {
    return new URL(uri, baseUri).href;
  } catch {
    const base = baseUri.split("#", 1)[0]!.split("?", 1)[0]!;
    const directory = base.slice(0, base.lastIndexOf("/") + 1);
    const resolved = new URL(uri, `https://royal.invalid/${directory.replace(/^\/+/, "")}`);
    return resolved.origin === "https://royal.invalid"
      ? `${resolved.pathname}${resolved.search}${resolved.hash}`
      : resolved.href;
  }
};

const gltfSampler = (value: JsonObject, label: string, path: string): TextureSampler => {
  const magFilter = value.magFilter === undefined
    ? "linear"
    : value.magFilter === 9728 ? "nearest"
      : value.magFilter === 9729 ? "linear"
        : fail(label, `${path}.magFilter`, "must be NEAREST or LINEAR");
  const minFilters = new Map<number, NonNullable<TextureSampler["minFilter"]>>([
    [9728, "nearest"],
    [9729, "linear"],
    [9984, "nearest-mipmap-nearest"],
    [9985, "linear-mipmap-nearest"],
    [9986, "nearest-mipmap-linear"],
    [9987, "linear-mipmap-linear"],
  ]);
  const minFilter = value.minFilter === undefined
    ? "linear-mipmap-linear"
    : minFilters.get(integer(value.minFilter, label, `${path}.minFilter`))
      ?? fail(label, `${path}.minFilter`, "is not a core glTF filter");
  const readWrap = (input: unknown, field: string): NonNullable<TextureSampler["wrapS"]> => {
    if (input === undefined || input === 10497) return "repeat";
    if (input === 33071) return "clamp-to-edge";
    if (input === 33648) return "mirrored-repeat";
    return fail(label, `${path}.${field}`, "is not a core glTF wrap mode");
  };
  return {
    magFilter,
    minFilter,
    wrapS: readWrap(value.wrapS, "wrapS"),
    wrapT: readWrap(value.wrapT, "wrapT"),
  };
};

const createTextureAssetReader = (
  document: JsonObject,
  binary: Uint8Array,
  bufferByteLength: number,
  bufferViews: readonly unknown[],
  contentKey: string,
  sourceUri: string,
  label: string,
): ((
  value: unknown,
  path: string,
  colorSpace?: "linear" | "srgb",
) => TextureSourceRef) => {
  const images = optionalArray(document.images, label, "images");
  const samplers = optionalArray(document.samplers, label, "samplers");
  const textures = optionalArray(document.textures, label, "textures");
  const prepared = new Map<string, TextureSourceRef>();
  return (value, path, colorSpace = "srgb") => {
    const textureIndex = index(value, textures, label, path);
    const preparedKey = `${textureIndex}:${colorSpace}`;
    const retained = prepared.get(preparedKey);
    if (retained !== undefined) return retained;
    const textureValue = textures[textureIndex];
    const texturePath = `textures[${textureIndex}]`;
    const texture = object(textureValue, label, texturePath);
    const textureExtensions = texture.extensions === undefined
      ? {}
      : object(texture.extensions, label, `${texturePath}.extensions`);
    const avifExtension = textureExtensions.EXT_texture_avif === undefined
      ? undefined
      : object(
        textureExtensions.EXT_texture_avif,
        label,
        `${texturePath}.extensions.EXT_texture_avif`,
      );
    const sourceValue = avifExtension?.source ?? texture.source;
    const sourcePath = avifExtension === undefined
      ? `${texturePath}.source`
      : `${texturePath}.extensions.EXT_texture_avif.source`;
    const imageIndex = index(sourceValue, images, label, sourcePath);
    const imagePath = `images[${imageIndex}]`;
    const image = object(images[imageIndex], label, imagePath);
    if ((image.uri === undefined) === (image.bufferView === undefined)) {
      fail(label, imagePath, "must contain exactly one of uri or bufferView");
    }
    let sampler: TextureSampler;
    if (texture.sampler === undefined) {
      sampler = gltfSampler({}, label, `${texturePath}.sampler`);
    } else {
      const samplerIndex = index(texture.sampler, samplers, label, `${texturePath}.sampler`);
      const samplerPath = `samplers[${samplerIndex}]`;
      sampler = gltfSampler(
        object(samplers[samplerIndex], label, samplerPath),
        label,
        samplerPath,
      );
    }
    let asset: TextureSourceRef;
    if (image.bufferView === undefined) {
      if (typeof image.uri !== "string" || image.uri.length === 0) {
        fail(label, `${imagePath}.uri`, "must be a non-empty URI");
      }
      asset = {
        colorSpace,
        contentKey: `${contentKey}:image:${imageIndex}`,
        kind: "asset",
        sampler,
        src: resolveAssetUri(sourceUri, image.uri as string),
      };
    } else {
      if (
        image.mimeType !== "image/avif"
        && image.mimeType !== "image/jpeg"
        && image.mimeType !== "image/png"
      ) {
        fail(label, `${imagePath}.mimeType`, "must be image/avif, image/jpeg, or image/png");
      }
      const mimeType = image.mimeType as "image/avif" | "image/jpeg" | "image/png";
      const viewIndex = index(image.bufferView, bufferViews, label, `${imagePath}.bufferView`);
      const viewPath = `bufferViews[${viewIndex}]`;
      const view = object(bufferViews[viewIndex], label, viewPath);
      if (view.buffer !== 0) fail(label, `${viewPath}.buffer`, "must reference GLB buffer 0");
      const byteOffset = view.byteOffset === undefined
        ? 0
        : nonNegativeInteger(view.byteOffset, label, `${viewPath}.byteOffset`);
      const byteLength = nonNegativeInteger(view.byteLength, label, `${viewPath}.byteLength`);
      if (byteLength === 0 || byteOffset + byteLength > bufferByteLength) {
        fail(label, viewPath, "embedded image bytes exceed the declared GLB buffer");
      }
      const bytes = new Uint8Array(
        binary.buffer,
        binary.byteOffset + byteOffset,
        byteLength,
      );
      asset = {
        bytes,
        colorSpace,
        contentKey: `${contentKey}:image:${imageIndex}`,
        kind: "embedded-asset",
        label: `${label} ${imagePath}`,
        mimeType,
        sampler,
      } satisfies EmbeddedTextureAssetRef;
    }
    prepared.set(preparedKey, asset);
    return asset;
  };
};

const prepareMaterial = (
  materials: unknown[],
  textureAsset: (
    value: unknown,
    path: string,
    colorSpace?: "linear" | "srgb",
  ) => TextureSourceRef,
  materialIndex: unknown,
  label: string,
  path: string,
): CanonicalSurfaceMaterial => {
  if (materialIndex === undefined) {
    return {
      baseColor: [1, 1, 1, 1],
      emissiveFactor: [0, 0, 0],
      kind: "standard",
      metallicFactor: 1,
      normalScale: 1,
      occlusionStrength: 1,
      requiresTextureCoordinates: false,
      roughnessFactor: 1,
    };
  }
  const resolvedIndex = index(materialIndex, materials, label, `${path}.material`);
  const material = object(materials[resolvedIndex], label, `materials[${resolvedIndex}]`);
  const materialPath = `materials[${resolvedIndex}]`;
  const extensions = material.extensions === undefined
    ? {}
    : object(material.extensions, label, `${materialPath}.extensions`);
  const unlit = extensions.KHR_materials_unlit !== undefined;
  if (unlit) object(
    extensions.KHR_materials_unlit,
    label,
    `${materialPath}.extensions.KHR_materials_unlit`,
  );
  if (
    material.alphaMode !== undefined
    && material.alphaMode !== "OPAQUE"
    && material.alphaMode !== "MASK"
  ) {
    fail(label, `${materialPath}.alphaMode`, "must be OPAQUE or MASK");
  }
  if (material.doubleSided !== undefined && typeof material.doubleSided !== "boolean") {
    fail(label, `${materialPath}.doubleSided`, "must be boolean");
  }
  const alphaCutoff = material.alphaMode === "MASK"
    ? factor01(material.alphaCutoff, 0.5, label, `${materialPath}.alphaCutoff`)
    : undefined;
  const pbr = material.pbrMetallicRoughness === undefined
    ? {}
    : object(material.pbrMetallicRoughness, label, `${materialPath}.pbrMetallicRoughness`);
  const materialTexture = (
    value: unknown,
    textureInfoPath: string,
    colorSpace: "linear" | "srgb",
  ): TextureSourceRef | undefined => {
    if (value === undefined) return undefined;
    const textureInfo = object(value, label, textureInfoPath);
    if (textureInfo.texCoord !== undefined && textureInfo.texCoord !== 0) {
      fail(label, `${textureInfoPath}.texCoord`, "must select TEXCOORD_0");
    }
    return textureAsset(
      textureInfo.index,
      `${textureInfoPath}.index`,
      colorSpace,
    );
  };
  const baseColorAsset = materialTexture(
    pbr.baseColorTexture,
    `${materialPath}.pbrMetallicRoughness.baseColorTexture`,
    "srgb",
  );
  const color = finiteTuple(
    pbr.baseColorFactor,
    4,
    [1, 1, 1, 1],
    label,
    `${materialPath}.pbrMetallicRoughness.baseColorFactor`,
  );
  for (let channel = 0; channel < 4; channel += 1) {
    if (color[channel]! < 0 || color[channel]! > 1) {
      fail(label, `${materialPath}.pbrMetallicRoughness.baseColorFactor[${channel}]`, "must be within 0..1");
    }
  }
  const baseColor = [color[0]!, color[1]!, color[2]!, color[3]!] as const;
  const presentation = {
    ...(alphaCutoff === undefined ? {} : { alphaCutoff }),
    ...(material.doubleSided === true ? { doubleSided: true as const } : {}),
  };
  if (unlit) return {
    ...presentation,
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    kind: "unlit",
    requiresTextureCoordinates: baseColorAsset !== undefined,
  };
  const metallicRoughnessAsset = materialTexture(
    pbr.metallicRoughnessTexture,
    `${materialPath}.pbrMetallicRoughness.metallicRoughnessTexture`,
    "linear",
  );
  const normalAsset = materialTexture(
    material.normalTexture,
    `${materialPath}.normalTexture`,
    "linear",
  );
  const occlusionAsset = materialTexture(
    material.occlusionTexture,
    `${materialPath}.occlusionTexture`,
    "linear",
  );
  const emissiveAsset = materialTexture(
    material.emissiveTexture,
    `${materialPath}.emissiveTexture`,
    "srgb",
  );
  const emissive = finiteTuple(
    material.emissiveFactor,
    3,
    [0, 0, 0],
    label,
    `${materialPath}.emissiveFactor`,
  );
  for (let channel = 0; channel < 3; channel += 1) {
    if (emissive[channel]! < 0 || emissive[channel]! > 1) {
      fail(label, `${materialPath}.emissiveFactor[${channel}]`, "must be within 0..1");
    }
  }
  const emissiveStrengthExtension = extensions.KHR_materials_emissive_strength === undefined
    ? undefined
    : object(
      extensions.KHR_materials_emissive_strength,
      label,
      `${materialPath}.extensions.KHR_materials_emissive_strength`,
    );
  const emissiveStrength = finiteFactor(
    emissiveStrengthExtension?.emissiveStrength,
    1,
    label,
    `${materialPath}.extensions.KHR_materials_emissive_strength.emissiveStrength`,
  );
  if (emissiveStrength < 0) {
    fail(
      label,
      `${materialPath}.extensions.KHR_materials_emissive_strength.emissiveStrength`,
      "must not be negative",
    );
  }
  const normalTexture = material.normalTexture === undefined
    ? undefined
    : object(material.normalTexture, label, `${materialPath}.normalTexture`);
  const occlusionTexture = material.occlusionTexture === undefined
    ? undefined
    : object(material.occlusionTexture, label, `${materialPath}.occlusionTexture`);
  return {
    ...presentation,
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    emissiveFactor: [
      emissive[0]! * emissiveStrength,
      emissive[1]! * emissiveStrength,
      emissive[2]! * emissiveStrength,
    ],
    ...(emissiveAsset === undefined ? {} : { emissiveAsset }),
    kind: "standard",
    metallicFactor: factor01(pbr.metallicFactor, 1, label, `${materialPath}.pbrMetallicRoughness.metallicFactor`),
    ...(metallicRoughnessAsset === undefined ? {} : { metallicRoughnessAsset }),
    ...(normalAsset === undefined ? {} : { normalAsset }),
    normalScale: normalTexture === undefined
      ? 1
      : finiteFactor(normalTexture.scale, 1, label, `${materialPath}.normalTexture.scale`),
    ...(occlusionAsset === undefined ? {} : { occlusionAsset }),
    occlusionStrength: occlusionTexture === undefined
      ? 1
      : factor01(occlusionTexture.strength, 1, label, `${materialPath}.occlusionTexture.strength`),
    requiresTextureCoordinates: baseColorAsset !== undefined
      || metallicRoughnessAsset !== undefined
      || normalAsset !== undefined
      || occlusionAsset !== undefined
      || emissiveAsset !== undefined,
    roughnessFactor: factor01(pbr.roughnessFactor, 1, label, `${materialPath}.pbrMetallicRoughness.roughnessFactor`),
  };
};

type PreparedMeshPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  material: CanonicalSurfaceMaterial;
}>;

const prepareStaticDocument = (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  sourceUri: string,
  decodeDraco?: StaticDracoDecoder,
): PreparedStaticGltf => {
  if (contentKey.length === 0) throw new TypeError("Royal glTF contentKey must not be empty");
  const asset = object(document.asset, label, "asset");
  if (asset.version !== "2.0") fail(label, "asset.version", "must be 2.0");
  // Static ingestion intentionally ignores animation declarations. The current
  // node transforms are the bind/default pose; animation support can layer over
  // this canonical result without making otherwise renderable assets fail.
  optionalArray(document.animations, label, "animations");
  if (optionalArray(document.skins, label, "skins").length > 0) {
    fail(label, "skins", "are not supported yet");
  }
  const requiredExtensions = optionalArray(
    document.extensionsRequired, label, "extensionsRequired",
  );
  for (let extensionIndex = 0; extensionIndex < requiredExtensions.length; extensionIndex += 1) {
    const extension = requiredExtensions[extensionIndex];
    if (
      extension !== "KHR_materials_unlit"
      && extension !== "KHR_materials_emissive_strength"
      && extension !== "EXT_texture_avif"
      && extension !== "EXT_mesh_gpu_instancing"
      && !(extension === "KHR_draco_mesh_compression" && decodeDraco !== undefined)
      && !(extension === "KHR_mesh_quantization" && decodeDraco !== undefined)
    ) {
      fail(label, `extensionsRequired[${extensionIndex}]`, "is unsupported");
    }
  }

  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly one buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (container === "glb" && buffer.uri !== undefined) {
    fail(label, "buffers[0].uri", "must be omitted for a GLB BIN chunk");
  }
  if (container === "gltf" && (typeof buffer.uri !== "string" || buffer.uri.length === 0)) {
    fail(label, "buffers[0].uri", "must be a non-empty external or data URI");
  }
  const bufferByteLength = nonNegativeInteger(buffer.byteLength, label, "buffers[0].byteLength");
  const padding = binary.byteLength - bufferByteLength;
  if (padding < 0 || (container === "glb" ? padding > 3 : padding !== 0)) {
    fail(
      label,
      "buffers[0].byteLength",
      container === "glb" ? "does not match the padded GLB BIN chunk" : "does not match the external buffer",
    );
  }
  const accessors = array(document.accessors, label, "accessors");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const meshes = array(document.meshes, label, "meshes");
  const materials = optionalArray(document.materials, label, "materials");
  const textureAsset = createTextureAssetReader(
    document,
    binary,
    bufferByteLength,
    bufferViews,
    contentKey,
    sourceUri,
    label,
  );
  const nodes = array(document.nodes, label, "nodes");
  const scenes = array(document.scenes, label, "scenes");
  const context: AccessorContext = {
    accessors,
    binary,
    bufferByteLength,
    bufferViews,
    label,
  };
  const preparedMeshes: Array<readonly PreparedMeshPrimitive[] | undefined> = [];
  const prepareMesh = (meshIndex: number): readonly PreparedMeshPrimitive[] => {
    const retained = preparedMeshes[meshIndex];
    if (retained !== undefined) return retained;
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], label, meshPath);
    if (mesh.weights !== undefined) fail(label, `${meshPath}.weights`, "are not supported yet");
    const primitives = array(mesh.primitives, label, `${meshPath}.primitives`);
    const prepared = primitives.map((primitiveValue, primitiveIndex): PreparedMeshPrimitive => {
      const path = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitiveValue, label, path);
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        fail(label, `${path}.mode`, "must be TRIANGLES in the static profile");
      }
      if (primitive.targets !== undefined) fail(label, `${path}.targets`, "are not supported yet");
      const attributes = object(primitive.attributes, label, `${path}.attributes`);
      const extensions = primitive.extensions === undefined
        ? {}
        : object(primitive.extensions, label, `${path}.extensions`);
      const hasDraco = extensions.KHR_draco_mesh_compression !== undefined;
      const decoded = hasDraco
        ? decodeDraco?.(primitive, path)
          ?? fail(label, `${path}.extensions.KHR_draco_mesh_compression`, "is unsupported")
        : undefined;
      const positionAccessor = index(
        attributes.POSITION, accessors, label, `${path}.attributes.POSITION`,
      );
      const decodedPositionValues = decoded?.attributes.get("POSITION");
      const { bounds, positions } = decodedPositionValues === undefined
        ? readPositions(context, positionAccessor)
        : decodedPositions(decodedPositionValues, label, `${path}.attributes.POSITION`);
      const vertexCount = positions.length / 3;
      const decodedNormalValues = decoded?.attributes.get("NORMAL");
      const normals = attributes.NORMAL === undefined
        ? undefined
        : decodedNormalValues === undefined
          ? readFloatVectors(
            context,
            index(attributes.NORMAL, accessors, label, `${path}.attributes.NORMAL`),
            "VEC3",
            3,
            "NORMAL",
          )
          : validateDecodedVectors(
            decodedNormalValues,
            3,
            label,
            `${path}.attributes.NORMAL`,
          );
      if (normals !== undefined && normals.length / 3 !== vertexCount) {
        fail(label, `${path}.attributes.NORMAL`, "count must match POSITION");
      }
      const decodedTextureCoordinates = decoded?.attributes.get("TEXCOORD_0");
      const textureCoordinates0 = attributes.TEXCOORD_0 === undefined
        ? undefined
        : decodedTextureCoordinates === undefined
          ? readFloatVectors(
            context,
            index(attributes.TEXCOORD_0, accessors, label, `${path}.attributes.TEXCOORD_0`),
            "VEC2",
            2,
            "TEXCOORD_0",
          )
          : validateDecodedVectors(
            decodedTextureCoordinates,
            2,
            label,
            `${path}.attributes.TEXCOORD_0`,
          );
      if (textureCoordinates0 !== undefined && textureCoordinates0.length / 2 !== vertexCount) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "count must match POSITION");
      }
      const decodedTangents = decoded?.attributes.get("TANGENT");
      const tangents = attributes.TANGENT === undefined
        ? undefined
        : decodedTangents === undefined
          ? readFloatVectors(
            context,
            index(attributes.TANGENT, accessors, label, `${path}.attributes.TANGENT`),
            "VEC4",
            4,
            "TANGENT",
          )
          : validateDecodedVectors(
            decodedTangents,
            4,
            label,
            `${path}.attributes.TANGENT`,
          );
      if (tangents !== undefined && tangents.length / 4 !== vertexCount) {
        fail(label, `${path}.attributes.TANGENT`, "count must match POSITION");
      }
      const indexAccessor = primitive.indices === undefined
        ? undefined
        : index(primitive.indices, accessors, label, `${path}.indices`);
      const indices = decoded?.indices ?? readIndices(context, indexAccessor, vertexCount);
      if (indices.length < 3 || indices.length % 3 !== 0) {
        fail(label, path, "triangle index count must be a positive multiple of 3");
      }
      for (let item = 0; item < indices.length; item += 1) {
        if (indices[item]! >= vertexCount) {
          fail(label, `${path}.indices[${item}]`, "decoded vertex index is out of range");
        }
      }
      const material = prepareMaterial(
        materials,
        textureAsset,
        primitive.material,
        label,
        path,
      );
      if (material.requiresTextureCoordinates && textureCoordinates0 === undefined) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "is required by the base color texture");
      }
      return {
        geometry: {
          bounds,
          indices,
          key: `${contentKey}:mesh:${meshIndex}:primitive:${primitiveIndex}`,
          ...(normals === undefined ? {} : { normals }),
          positions,
          ...(tangents === undefined ? {} : { tangents }),
          ...(textureCoordinates0 === undefined ? {} : { textureCoordinates0 }),
        },
        material,
      };
    });
    preparedMeshes[meshIndex] = prepared;
    return prepared;
  };

  const prepareNodeInstances = (
    node: JsonObject,
    nodeModel: Mat4,
    path: string,
  ): readonly StaticInstanceBatch[] | undefined => {
    if (node.extensions === undefined) return undefined;
    const extensions = object(node.extensions, label, `${path}.extensions`);
    if (extensions.EXT_mesh_gpu_instancing === undefined) return undefined;
    const extensionPath = `${path}.extensions.EXT_mesh_gpu_instancing`;
    const extension = object(extensions.EXT_mesh_gpu_instancing, label, extensionPath);
    const attributes = object(extension.attributes, label, `${extensionPath}.attributes`);
    for (const semantic of Object.keys(attributes)) {
      if (semantic !== "TRANSLATION" && semantic !== "ROTATION" && semantic !== "SCALE") {
        fail(label, `${extensionPath}.attributes.${semantic}`, "is unsupported");
      }
    }
    const translation = attributes.TRANSLATION === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.TRANSLATION, accessors, label, `${extensionPath}.attributes.TRANSLATION`),
        "VEC3",
        3,
        "TRANSLATION",
      );
    const rotation = attributes.ROTATION === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.ROTATION, accessors, label, `${extensionPath}.attributes.ROTATION`),
        "VEC4",
        4,
        "ROTATION",
      );
    const scale = attributes.SCALE === undefined
      ? undefined
      : readInstanceVectors(
        context,
        index(attributes.SCALE, accessors, label, `${extensionPath}.attributes.SCALE`),
        "VEC3",
        3,
        "SCALE",
      );
    const count = translation?.count ?? rotation?.count ?? scale?.count
      ?? fail(label, `${extensionPath}.attributes`, "must not be empty");
    if (
      (translation !== undefined && translation.count !== count)
      || (rotation !== undefined && rotation.count !== count)
      || (scale !== undefined && scale.count !== count)
    ) fail(label, `${extensionPath}.attributes`, "accessor counts must match");
    try {
      return prepareStaticInstanceBatches(nodeModel, {
        count,
        ...(rotation === undefined ? {} : { rotations: rotation.values }),
        ...(scale === undefined ? {} : { scales: scale.values }),
        ...(translation === undefined ? {} : { translations: translation.values }),
      });
    } catch (error) {
      return fail(
        label,
        extensionPath,
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const sceneIndex = document.scene === undefined ? 0 : index(document.scene, scenes, label, "scene");
  const selectedScene = object(scenes[sceneIndex], label, `scenes[${sceneIndex}]`);
  const roots = array(selectedScene.nodes, label, `scenes[${sceneIndex}].nodes`);
  const claimed = new Set<number>();
  const primitives: PreparedStaticGltfPrimitive[] = [];
  const visit = (nodeIndex: number, parentModel: Mat4): void => {
    if (claimed.has(nodeIndex)) fail(label, `nodes[${nodeIndex}]`, "is cyclic or has multiple parents");
    claimed.add(nodeIndex);
    const path = `nodes[${nodeIndex}]`;
    const node = object(nodes[nodeIndex], label, path);
    if (node.skin !== undefined) fail(label, `${path}.skin`, "is not supported yet");
    const localModel = nodeLocalMatrix(node, label, path);
    const worldModel = multiplyMat4Into(identityMat4(), parentModel, localModel);
    const instanceBatches = prepareNodeInstances(node, worldModel, path);
    if (node.mesh !== undefined) {
      const meshIndex = index(node.mesh, meshes, label, `${path}.mesh`);
      for (const primitive of prepareMesh(meshIndex)) {
        if (instanceBatches === undefined) {
          primitives.push({ ...primitive, localModel: worldModel });
          continue;
        }
        for (let batch = 0; batch < instanceBatches.length; batch += 1) {
          primitives.push({
            ...primitive,
            instanceBatch: {
              ...instanceBatches[batch]!,
              key: `${contentKey}:node:${nodeIndex}:instances:${batch}`,
            },
            localModel: worldModel,
          });
        }
      }
    }
    const children = optionalArray(node.children, label, `${path}.children`);
    for (let child = 0; child < children.length; child += 1) {
      visit(index(children[child], nodes, label, `${path}.children[${child}]`), worldModel);
    }
  };
  for (let root = 0; root < roots.length; root += 1) {
    visit(index(roots[root], nodes, label, `scenes[${sceneIndex}].nodes[${root}]`), identityMat4());
  }
  if (primitives.length === 0) fail(label, `scenes[${sceneIndex}]`, "has no renderable primitives");
  const claimedTextures = new Map<string, TextureSourceRef>();
  for (const primitive of primitives) {
    const material = primitive.material;
    const assets = material.kind === "unlit"
      ? [material.baseColorAsset]
      : [
        material.baseColorAsset,
        material.metallicRoughnessAsset,
        material.normalAsset,
        material.occlusionAsset,
        material.emissiveAsset,
      ];
    for (const asset of assets) {
      if (asset !== undefined) {
        claimedTextures.set(`${asset.contentKey as string}:${asset.colorSpace ?? "srgb"}`, asset);
      }
    }
  }
  return { primitives, textureAssets: [...claimedTextures.values()] };
};

/** Validates and lowers the first static GLB profile without browser or GL resource work. */
export const prepareStaticGlb = (
  bytes: Uint8Array,
  contentKey: string,
  label = "glTF asset",
  sourceUri = "asset.glb",
): PreparedStaticGltf => {
  const parsed = parseGlb(bytes, label);
  const document = object(parsed.document, label, "document");
  const binary = parsed.binaryChunk
    ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
  return prepareStaticDocument(document, binary, "glb", contentKey, label, sourceUri);
};

const prepareDocumentWithCodecs = async (
  document: JsonObject,
  binary: Uint8Array,
  container: "glb" | "gltf",
  contentKey: string,
  label: string,
  sourceUri: string,
): Promise<PreparedStaticGltf> => {
  const extensionsUsed = optionalArray(document.extensionsUsed, label, "extensionsUsed");
  const extensionsRequired = optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  );
  const usesDraco = extensionsUsed.includes("KHR_draco_mesh_compression")
    || extensionsRequired.includes("KHR_draco_mesh_compression");
  const decodeDraco = usesDraco
    ? (await import("./draco")).createStaticDracoDecoder(document, binary, label)
    : undefined;
  return prepareStaticDocument(
    document,
    binary,
    container,
    contentKey,
    label,
    sourceUri,
    decodeDraco,
  );
};

const parseJsonDocument = (bytes: Uint8Array, label: string): JsonObject => {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(label, "document", `is not valid UTF-8 JSON: ${detail}`);
  }
  return object(value, label, "document");
};

/** Selects GLB or JSON glTF ingestion and fetches only the declared external buffer. */
export const prepareStaticGltfSource = async (
  bytes: Uint8Array,
  contentKey: string,
  label: string,
  sourceUri: string,
  read: (uri: string) => Promise<Uint8Array>,
): Promise<PreparedStaticGltf> => {
  if (
    bytes.byteLength >= 4
    && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46_54_6c_67
  ) {
    const parsed = parseGlb(bytes, label);
    const document = object(parsed.document, label, "document");
    const binary = parsed.binaryChunk
      ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
    return prepareDocumentWithCodecs(
      document,
      binary,
      "glb",
      contentKey,
      label,
      sourceUri,
    );
  }
  const document = parseJsonDocument(bytes, label);
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly one buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (typeof buffer.uri !== "string" || buffer.uri.length === 0) {
    fail(label, "buffers[0].uri", "must be a non-empty external or data URI");
  }
  const binary = await read(resolveAssetUri(sourceUri, buffer.uri as string));
  return prepareDocumentWithCodecs(
    document,
    binary,
    "gltf",
    contentKey,
    label,
    sourceUri,
  );
};

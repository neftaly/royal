import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import type { CanonicalSurfaceMaterial } from "../surface/canonical-material";
import type { TextureAssetRef, TextureSampler } from "@royal/renderer-core";
import { parseGlb } from "./glb";

export type PreparedStaticGltfPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  localModel: Mat4;
  material: CanonicalSurfaceMaterial;
}>;

export type PreparedStaticGltf = Readonly<{
  primitives: readonly PreparedStaticGltfPrimitive[];
  textureAssets: readonly TextureAssetRef[];
}>;

type JsonObject = Record<string, unknown>;
type IndexArray = Uint8Array | Uint16Array | Uint32Array;

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
): AccessorLayout & { accessor: JsonObject } => {
  const path = `accessors[${accessorIndex}]`;
  const accessor = object(context.accessors[accessorIndex], context.label, path);
  if (accessor.type !== expectedType) fail(context.label, `${path}.type`, `must be ${expectedType}`);
  if (accessor.sparse !== undefined) fail(context.label, `${path}.sparse`, "is not in the static profile yet");
  if (accessor.normalized === true) fail(context.label, `${path}.normalized`, "is invalid for this accessor");
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

const readFloatVectors = (
  context: AccessorContext,
  accessorIndex: number,
  expectedType: "VEC2" | "VEC3",
  componentCount: 2 | 3,
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

const resolveAssetUri = (baseUri: string, uri: string): string => {
  try {
    return new URL(uri, baseUri).href;
  } catch {
    const base = baseUri.split("#", 1)[0]!.split("?", 1)[0]!;
    const directory = base.slice(0, base.lastIndexOf("/") + 1);
    const resolved = new URL(uri, `https://royal.invalid/${directory.replace(/^\/+/, "")}`);
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
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
  contentKey: string,
  sourceUri: string,
  label: string,
): ((value: unknown, path: string) => TextureAssetRef) => {
  const images = optionalArray(document.images, label, "images");
  const samplers = optionalArray(document.samplers, label, "samplers");
  const textures = optionalArray(document.textures, label, "textures");
  const prepared: Array<TextureAssetRef | undefined> = [];
  return (value, path) => {
    const textureIndex = index(value, textures, label, path);
    const retained = prepared[textureIndex];
    if (retained !== undefined) return retained;
    const textureValue = textures[textureIndex];
    const texturePath = `textures[${textureIndex}]`;
    const texture = object(textureValue, label, texturePath);
    const imageIndex = index(texture.source, images, label, `${texturePath}.source`);
    const imagePath = `images[${imageIndex}]`;
    const image = object(images[imageIndex], label, imagePath);
    if (image.bufferView !== undefined) {
      fail(label, `${imagePath}.bufferView`, "embedded images are not supported yet");
    }
    if (typeof image.uri !== "string" || image.uri.length === 0) {
      fail(label, `${imagePath}.uri`, "must be a non-empty external URI");
    }
    const imageUri = image.uri as string;
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
    const asset: TextureAssetRef = {
      colorSpace: "srgb",
      contentKey: `${contentKey}:image:${imageIndex}`,
      kind: "asset",
      sampler,
      src: resolveAssetUri(sourceUri, imageUri),
    };
    prepared[textureIndex] = asset;
    return asset;
  };
};

const prepareMaterial = (
  materials: unknown[],
  textureAsset: (value: unknown, path: string) => TextureAssetRef,
  materialIndex: unknown,
  label: string,
  path: string,
): CanonicalSurfaceMaterial => {
  if (materialIndex === undefined) {
    return {
      baseColor: [1, 1, 1, 1],
      kind: "standard",
      metallicFactor: 1,
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
  if (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE") {
    fail(label, `${materialPath}.alphaMode`, "must be OPAQUE in the static profile");
  }
  if (material.doubleSided === true) {
    fail(label, `${materialPath}.doubleSided`, "is not in the static profile yet");
  }
  const pbr = material.pbrMetallicRoughness === undefined
    ? {}
    : object(material.pbrMetallicRoughness, label, `${materialPath}.pbrMetallicRoughness`);
  let baseColorAsset: TextureAssetRef | undefined;
  if (pbr.baseColorTexture !== undefined) {
    const textureInfoPath = `${materialPath}.pbrMetallicRoughness.baseColorTexture`;
    const textureInfo = object(pbr.baseColorTexture, label, textureInfoPath);
    if (textureInfo.texCoord !== undefined && textureInfo.texCoord !== 0) {
      fail(label, `${textureInfoPath}.texCoord`, "must select TEXCOORD_0");
    }
    baseColorAsset = textureAsset(
      textureInfo.index,
      `${textureInfoPath}.index`,
    );
  }
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
  const baseColor = [color[0]!, color[1]!, color[2]!, 1] as const;
  if (unlit) return {
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    kind: "unlit",
    requiresTextureCoordinates: baseColorAsset !== undefined,
  };
  return {
    baseColor,
    ...(baseColorAsset === undefined ? {} : { baseColorAsset }),
    kind: "standard",
    metallicFactor: factor01(pbr.metallicFactor, 1, label, `${materialPath}.pbrMetallicRoughness.metallicFactor`),
    requiresTextureCoordinates: baseColorAsset !== undefined,
    roughnessFactor: factor01(pbr.roughnessFactor, 1, label, `${materialPath}.pbrMetallicRoughness.roughnessFactor`),
  };
};

type PreparedMeshPrimitive = Readonly<{
  geometry: CanonicalTriangleGeometry;
  material: CanonicalSurfaceMaterial;
}>;

/** Validates and lowers the first static GLB profile without creating browser or GL resources. */
export const prepareStaticGlb = (
  bytes: Uint8Array,
  contentKey: string,
  label = "glTF asset",
  sourceUri = "asset.glb",
): PreparedStaticGltf => {
  if (contentKey.length === 0) throw new TypeError("Royal glTF contentKey must not be empty");
  const parsed = parseGlb(bytes, label);
  const document = object(parsed.document, label, "document");
  const asset = object(document.asset, label, "asset");
  if (asset.version !== "2.0") fail(label, "asset.version", "must be 2.0");
  if (optionalArray(document.animations, label, "animations").length > 0) {
    fail(label, "animations", "are not supported yet");
  }
  if (optionalArray(document.skins, label, "skins").length > 0) {
    fail(label, "skins", "are not supported yet");
  }
  const requiredExtensions = optionalArray(
    document.extensionsRequired, label, "extensionsRequired",
  );
  for (let extensionIndex = 0; extensionIndex < requiredExtensions.length; extensionIndex += 1) {
    if (requiredExtensions[extensionIndex] !== "KHR_materials_unlit") {
      fail(label, `extensionsRequired[${extensionIndex}]`, "is unsupported");
    }
  }

  const binary = parsed.binaryChunk
    ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length !== 1) fail(label, "buffers", "must contain exactly the GLB buffer");
  const buffer = object(buffers[0], label, "buffers[0]");
  if (buffer.uri !== undefined) fail(label, "buffers[0].uri", "must be omitted for a GLB BIN chunk");
  const bufferByteLength = nonNegativeInteger(buffer.byteLength, label, "buffers[0].byteLength");
  if (bufferByteLength > binary.byteLength || binary.byteLength - bufferByteLength > 3) {
    fail(label, "buffers[0].byteLength", "does not match the padded GLB BIN chunk");
  }
  const accessors = array(document.accessors, label, "accessors");
  const bufferViews = array(document.bufferViews, label, "bufferViews");
  const meshes = array(document.meshes, label, "meshes");
  const materials = optionalArray(document.materials, label, "materials");
  const textureAsset = createTextureAssetReader(document, contentKey, sourceUri, label);
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
      for (const semantic of Object.keys(attributes)) {
        if (semantic !== "POSITION" && semantic !== "NORMAL" && semantic !== "TEXCOORD_0") {
          fail(label, `${path}.attributes.${semantic}`, "is not in the static profile yet");
        }
      }
      const positionAccessor = index(
        attributes.POSITION, accessors, label, `${path}.attributes.POSITION`,
      );
      const { bounds, positions } = readPositions(context, positionAccessor);
      const vertexCount = positions.length / 3;
      const normals = attributes.NORMAL === undefined
        ? undefined
        : readFloatVectors(
          context,
          index(attributes.NORMAL, accessors, label, `${path}.attributes.NORMAL`),
          "VEC3",
          3,
          "NORMAL",
        );
      if (normals !== undefined && normals.length / 3 !== vertexCount) {
        fail(label, `${path}.attributes.NORMAL`, "count must match POSITION");
      }
      const textureCoordinates0 = attributes.TEXCOORD_0 === undefined
        ? undefined
        : readFloatVectors(
          context,
          index(attributes.TEXCOORD_0, accessors, label, `${path}.attributes.TEXCOORD_0`),
          "VEC2",
          2,
          "TEXCOORD_0",
        );
      if (textureCoordinates0 !== undefined && textureCoordinates0.length / 2 !== vertexCount) {
        fail(label, `${path}.attributes.TEXCOORD_0`, "count must match POSITION");
      }
      const indexAccessor = primitive.indices === undefined
        ? undefined
        : index(primitive.indices, accessors, label, `${path}.indices`);
      const indices = readIndices(context, indexAccessor, vertexCount);
      if (indices.length < 3 || indices.length % 3 !== 0) {
        fail(label, path, "triangle index count must be a positive multiple of 3");
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
          ...(textureCoordinates0 === undefined ? {} : { textureCoordinates0 }),
        },
        material,
      };
    });
    preparedMeshes[meshIndex] = prepared;
    return prepared;
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
    if (node.mesh !== undefined) {
      const meshIndex = index(node.mesh, meshes, label, `${path}.mesh`);
      for (const primitive of prepareMesh(meshIndex)) {
        primitives.push({ ...primitive, localModel: worldModel });
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
  const claimedTextures = new Map<string, TextureAssetRef>();
  for (const primitive of primitives) {
    const asset = primitive.material.baseColorAsset;
    if (asset !== undefined) claimedTextures.set(asset.contentKey as string, asset);
  }
  return { primitives, textureAssets: [...claimedTextures.values()] };
};

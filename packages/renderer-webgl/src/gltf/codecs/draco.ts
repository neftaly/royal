import { decodeDracoMesh, type Mesh } from "minidraco";
import { gltfComponentCount, type GltfIndexArray } from "../accessors";
import type {
  GltfAccessor,
  GltfDocument,
  GltfDracoMeshCompressionExtension,
  GltfMeshPrimitive,
} from "../schema";

export type DecodedGltfDracoPrimitive = {
  readonly attributes: ReadonlyMap<string, Float32Array>;
  readonly indices: GltfIndexArray;
};

const COMPONENT_BYTE = 5120;
const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_SHORT = 5122;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;

const COLOR_SEMANTIC_PATTERN = /^COLOR_\d+$/u;
const TEXCOORD_SEMANTIC_PATTERN = /^TEXCOORD_\d+$/u;

const assertNonNegativeInteger = (label: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
};

const compressedPrimitiveBytes = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  extension: GltfDracoMeshCompressionExtension,
  label: string,
): Uint8Array => {
  assertNonNegativeInteger(`${label} KHR_draco_mesh_compression bufferView`, extension.bufferView);

  const bufferView = document.bufferViews?.[extension.bufferView];
  if (bufferView === undefined) {
    throw new Error(`${label} KHR_draco_mesh_compression references missing bufferView ${extension.bufferView}`);
  }

  const buffer = buffers[bufferView.buffer ?? 0];
  const offset = bufferView.byteOffset ?? 0;
  if (buffer === undefined || offset + bufferView.byteLength > buffer.byteLength) {
    throw new Error(`${label} KHR_draco_mesh_compression source bufferView is unavailable`);
  }

  return new Uint8Array(buffer, offset, bufferView.byteLength);
};

const dracoIndexArray = (
  componentType: number | undefined,
  count: number,
  pointCount: number,
): GltfIndexArray => {
  if (componentType === COMPONENT_UNSIGNED_BYTE && pointCount <= 255) return new Uint8Array(count);
  if (componentType === COMPONENT_UNSIGNED_SHORT && pointCount <= 65535) return new Uint16Array(count);
  if (componentType === COMPONENT_UNSIGNED_INT) return new Uint32Array(count);

  return pointCount <= 65535 ? new Uint16Array(count) : new Uint32Array(count);
};

const defaultComponentCount = (semantic: string): number | undefined => {
  if (semantic === "POSITION" || semantic === "NORMAL") return 3;
  if (semantic === "TANGENT") return 4;
  if (TEXCOORD_SEMANTIC_PATTERN.test(semantic)) return 2;

  return undefined;
};

const normalizeDecodedAttributeValues = (
  values: Float32Array,
  accessor: GltfAccessor | undefined,
): Float32Array => {
  if (accessor?.normalized !== true) return values;

  switch (accessor.componentType) {
    case COMPONENT_BYTE:
      for (let index = 0; index < values.length; index += 1) values[index] = Math.max(values[index]! / 127, -1);
      return values;
    case COMPONENT_UNSIGNED_BYTE:
      for (let index = 0; index < values.length; index += 1) values[index] = values[index]! / 255;
      return values;
    case COMPONENT_SHORT:
      for (let index = 0; index < values.length; index += 1) values[index] = Math.max(values[index]! / 32767, -1);
      return values;
    case COMPONENT_UNSIGNED_SHORT:
      for (let index = 0; index < values.length; index += 1) values[index] = values[index]! / 65535;
      return values;
    default:
      return values;
  }
};

const decodeAttributes = (
  document: GltfDocument,
  primitive: GltfMeshPrimitive,
  extension: GltfDracoMeshCompressionExtension,
  mesh: Mesh,
  label: string,
): ReadonlyMap<string, Float32Array> => {
  const attributes = new Map<string, Float32Array>();
  const pointCount = mesh.numPoints();
  for (const semantic in extension.attributes) {
    const uniqueId = extension.attributes[semantic];
    if (typeof uniqueId !== "number") {
      throw new Error(`${label} KHR_draco_mesh_compression ${semantic} attribute must be a number`);
    }
    assertNonNegativeInteger(`${label} KHR_draco_mesh_compression ${semantic} attribute`, uniqueId);

    const accessorIndex = primitive.attributes?.[semantic];
    const accessor = accessorIndex === undefined ? undefined : document.accessors?.[accessorIndex];
    const componentCount = accessor === undefined ? defaultComponentCount(semantic) : gltfComponentCount(accessor.type);
    if (componentCount === undefined && !COLOR_SEMANTIC_PATTERN.test(semantic)) continue;

    const attribute = mesh.getAttributeByUniqueId(uniqueId);
    if (attribute === null) {
      throw new Error(`${label} KHR_draco_mesh_compression missing ${semantic} attribute ${uniqueId}`);
    }
    const expectedComponentCount = componentCount ?? attribute.numComponents;
    if (accessor !== undefined && accessor.count !== pointCount) {
      throw new Error(
        `${label} KHR_draco_mesh_compression ${semantic} decodes ${pointCount} points, expected ${accessor.count}`,
      );
    }
    if (attribute.numComponents !== expectedComponentCount) {
      throw new Error(
        `${label} KHR_draco_mesh_compression ${semantic} has ${attribute.numComponents} components, expected ${expectedComponentCount}`,
      );
    }

    const values = attribute.extractTo(Float32Array, pointCount);
    if (values.length !== pointCount * expectedComponentCount) {
      throw new Error(`${label} KHR_draco_mesh_compression decoded invalid ${semantic} size`);
    }

    attributes.set(semantic, normalizeDecodedAttributeValues(values, accessor));
  }

  return attributes;
};

const decodeIndices = (
  mesh: Mesh,
  componentType: number | undefined,
): GltfIndexArray => {
  const count = mesh.numFaces() * 3;
  const indices = dracoIndexArray(componentType, count, mesh.numPoints());
  indices.set(mesh.faces_.subarray(0, count));

  return indices;
};

const decodePrimitive = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  extension: GltfDracoMeshCompressionExtension,
  label: string,
): DecodedGltfDracoPrimitive => {
  let mesh: Mesh;
  try {
    mesh = decodeDracoMesh(compressedPrimitiveBytes(document, buffers, extension, label));
  } catch (error) {
    throw new Error(
      `${label} KHR_draco_mesh_compression decode failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  return {
    attributes: decodeAttributes(document, primitive, extension, mesh, label),
    indices: decodeIndices(mesh, primitive.indices === undefined ? undefined : document.accessors?.[primitive.indices]?.componentType),
  };
};

export const decodeGltfDracoPrimitives = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
): ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive> => {
  const decoded = new Map<GltfMeshPrimitive, DecodedGltfDracoPrimitive>();
  for (const [meshIndex, mesh] of (document.meshes ?? []).entries()) {
    for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
      const extension = primitive.extensions?.KHR_draco_mesh_compression;
      if (extension === undefined) continue;

      decoded.set(
        primitive,
        decodePrimitive(
          document,
          buffers,
          primitive,
          extension,
          `glTF mesh ${meshIndex} primitive ${primitiveIndex}`,
        ),
      );
    }
  }

  return decoded;
};

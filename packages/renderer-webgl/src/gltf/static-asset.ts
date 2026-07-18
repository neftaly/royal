import type { LinearRgba } from "@royal/renderer-core";
import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../math/mat4";
import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import { parseGlb } from "./glb";

export type PreparedStaticGltfPrimitive = Readonly<{
  color: LinearRgba;
  geometry: CanonicalTriangleGeometry;
  localModel: Mat4;
}>;

export type PreparedStaticGltf = Readonly<{
  primitives: readonly PreparedStaticGltfPrimitive[];
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

const index = (value: unknown, values: unknown[], label: string, path: string): number => {
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
  const elementComponents = expectedType === "VEC3" ? 3 : 1;
  const elementBytes = elementComponents * componentBytes;
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
  const layout = accessorLayout(context, accessorIndex, "VEC3", 4);
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
  const layout = accessorLayout(context, accessorIndex, "SCALAR", componentBytes);
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

const materialColor = (
  materials: unknown[],
  materialIndex: unknown,
  label: string,
  path: string,
): LinearRgba => {
  const resolvedIndex = index(materialIndex, materials, label, `${path}.material`);
  const material = object(materials[resolvedIndex], label, `materials[${resolvedIndex}]`);
  const extensions = object(material.extensions, label, `materials[${resolvedIndex}].extensions`);
  object(
    extensions.KHR_materials_unlit,
    label,
    `materials[${resolvedIndex}].extensions.KHR_materials_unlit`,
  );
  if (material.alphaMode !== undefined && material.alphaMode !== "OPAQUE") {
    fail(label, `materials[${resolvedIndex}].alphaMode`, "must be OPAQUE in the static profile");
  }
  if (material.doubleSided === true) {
    fail(label, `materials[${resolvedIndex}].doubleSided`, "is not in the static profile yet");
  }
  const pbr = material.pbrMetallicRoughness === undefined
    ? {}
    : object(material.pbrMetallicRoughness, label, `materials[${resolvedIndex}].pbrMetallicRoughness`);
  if (pbr.baseColorTexture !== undefined) {
    fail(label, `materials[${resolvedIndex}].pbrMetallicRoughness.baseColorTexture`, "is not in the static profile yet");
  }
  const color = finiteTuple(
    pbr.baseColorFactor,
    4,
    [1, 1, 1, 1],
    label,
    `materials[${resolvedIndex}].pbrMetallicRoughness.baseColorFactor`,
  );
  for (let channel = 0; channel < 4; channel += 1) {
    if (color[channel]! < 0 || color[channel]! > 1) {
      fail(label, `materials[${resolvedIndex}].pbrMetallicRoughness.baseColorFactor[${channel}]`, "must be within 0..1");
    }
  }
  return color as unknown as LinearRgba;
};

type PreparedMeshPrimitive = Readonly<{
  color: LinearRgba;
  geometry: CanonicalTriangleGeometry;
}>;

/** Validates and lowers the first static GLB profile without creating browser or GL resources. */
export const prepareStaticGlb = (
  bytes: Uint8Array,
  contentKey: string,
  label = "glTF asset",
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
  const materials = array(document.materials, label, "materials");
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
      const positionAccessor = index(
        attributes.POSITION, accessors, label, `${path}.attributes.POSITION`,
      );
      const { bounds, positions } = readPositions(context, positionAccessor);
      const indexAccessor = primitive.indices === undefined
        ? undefined
        : index(primitive.indices, accessors, label, `${path}.indices`);
      const indices = readIndices(context, indexAccessor, positions.length / 3);
      if (indices.length < 3 || indices.length % 3 !== 0) {
        fail(label, path, "triangle index count must be a positive multiple of 3");
      }
      return {
        color: materialColor(materials, primitive.material, label, path),
        geometry: {
          bounds,
          indices,
          key: `${contentKey}:mesh:${meshIndex}:primitive:${primitiveIndex}`,
          positions,
        },
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
  return { primitives };
};

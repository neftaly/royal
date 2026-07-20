import type { CanonicalTriangleGeometry } from "../surface/canonical-geometry";
import {
  fail,
  index,
  integer,
  nonNegativeInteger,
  object,
  type JsonObject,
} from "./gltf-values";

type IndexArray = Uint8Array | Uint16Array | Uint32Array;

export type AccessorContext = Readonly<{
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
  hasBase: boolean;
  hasSparse: boolean;
  stride: number;
}>;

const binaryDataView = (context: AccessorContext): DataView => new DataView(
  context.binary.buffer,
  context.binary.byteOffset,
  context.binary.byteLength,
);

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
  if (accessor.normalized === true && !allowNormalized) {
    fail(context.label, `${path}.normalized`, "is invalid for this accessor");
  }
  const count = nonNegativeInteger(accessor.count, context.label, `${path}.count`);
  const elementBytes = componentCount * componentBytes;
  const dataView = binaryDataView(context);
  if (accessor.bufferView === undefined) {
    if (accessor.byteOffset !== undefined) {
      fail(context.label, `${path}.byteOffset`, "requires a bufferView");
    }
    return {
      absoluteOffset: 0,
      accessor,
      componentType: integer(accessor.componentType, context.label, `${path}.componentType`),
      count,
      dataView,
      hasBase: false,
      hasSparse: accessor.sparse !== undefined,
      stride: elementBytes,
    };
  }
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
    dataView,
    hasBase: true,
    hasSparse: accessor.sparse !== undefined,
    stride,
  };
};

const sparseRange = (
  context: AccessorContext,
  bufferViewIndex: unknown,
  byteOffsetValue: unknown,
  byteLength: number,
  alignment: number,
  path: string,
): number => {
  const viewIndex = index(bufferViewIndex, context.bufferViews, context.label, `${path}.bufferView`);
  const viewPath = `bufferViews[${viewIndex}]`;
  const view = object(context.bufferViews[viewIndex], context.label, viewPath);
  if (view.buffer !== 0) fail(context.label, `${viewPath}.buffer`, "must reference GLB buffer 0");
  if (view.target !== undefined) fail(context.label, `${viewPath}.target`, "is invalid for sparse data");
  if (view.byteStride !== undefined) fail(context.label, `${viewPath}.byteStride`, "is invalid for sparse data");
  const viewOffset = view.byteOffset === undefined
    ? 0
    : nonNegativeInteger(view.byteOffset, context.label, `${viewPath}.byteOffset`);
  const viewLength = nonNegativeInteger(view.byteLength, context.label, `${viewPath}.byteLength`);
  if (viewOffset + viewLength > context.bufferByteLength) {
    fail(context.label, viewPath, "exceeds the declared GLB buffer");
  }
  const byteOffset = byteOffsetValue === undefined
    ? 0
    : nonNegativeInteger(byteOffsetValue, context.label, `${path}.byteOffset`);
  if (!Number.isSafeInteger(byteLength) || byteOffset + byteLength > viewLength) {
    fail(context.label, path, "exceeds its bufferView");
  }
  const absoluteOffset = viewOffset + byteOffset;
  if (absoluteOffset % alignment !== 0) fail(context.label, path, "is misaligned");
  return absoluteOffset;
};

const visitSparseComponents = (
  context: AccessorContext,
  accessorIndex: number,
  componentBytes: number,
  componentCount: number,
  visit: (item: number, component: number, source: number, dataView: DataView) => void,
): void => {
  const path = `accessors[${accessorIndex}]`;
  const accessor = object(context.accessors[accessorIndex], context.label, path);
  if (accessor.sparse === undefined) return;
  const sparsePath = `${path}.sparse`;
  const sparse = object(accessor.sparse, context.label, sparsePath);
  const accessorCount = nonNegativeInteger(accessor.count, context.label, `${path}.count`);
  const count = nonNegativeInteger(sparse.count, context.label, `${sparsePath}.count`);
  if (count === 0 || count > accessorCount) {
    fail(context.label, `${sparsePath}.count`, "must be positive and not exceed the accessor count");
  }
  const indicesPath = `${sparsePath}.indices`;
  const indices = object(sparse.indices, context.label, indicesPath);
  const indexComponentType = integer(
    indices.componentType,
    context.label,
    `${indicesPath}.componentType`,
  );
  const indexBytes = indexComponentType === 5121 ? 1 : indexComponentType === 5123 ? 2 : 4;
  if (indexComponentType !== 5121 && indexComponentType !== 5123 && indexComponentType !== 5125) {
    fail(context.label, `${indicesPath}.componentType`, "must be an unsigned integer");
  }
  const indicesOffset = sparseRange(
    context,
    indices.bufferView,
    indices.byteOffset,
    count * indexBytes,
    indexBytes,
    indicesPath,
  );
  const valuesPath = `${sparsePath}.values`;
  const values = object(sparse.values, context.label, valuesPath);
  const elementBytes = componentBytes * componentCount;
  const valuesOffset = sparseRange(
    context,
    values.bufferView,
    values.byteOffset,
    count * elementBytes,
    componentBytes,
    valuesPath,
  );
  const dataView = binaryDataView(context);
  let previous = -1;
  for (let sparseItem = 0; sparseItem < count; sparseItem += 1) {
    const indexOffset = indicesOffset + sparseItem * indexBytes;
    const item = indexComponentType === 5121
      ? dataView.getUint8(indexOffset)
      : indexComponentType === 5123
        ? dataView.getUint16(indexOffset, true)
        : dataView.getUint32(indexOffset, true);
    if (item <= previous || item >= accessorCount) {
      fail(context.label, `${indicesPath}[${sparseItem}]`, "must be strictly increasing and in range");
    }
    previous = item;
    const elementOffset = valuesOffset + sparseItem * elementBytes;
    for (let component = 0; component < componentCount; component += 1) {
      visit(item, component, elementOffset + component * componentBytes, dataView);
    }
  }
};

export type InstanceVectorStream = Readonly<{
  count: number;
  values: Float32Array;
}>;

export const readInstanceVectors = (
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
  const readComponent = (dataView: DataView, offset: number): number => {
    const raw = componentType === 5120
      ? dataView.getInt8(offset)
      : componentType === 5122
        ? dataView.getInt16(offset, true)
        : dataView.getFloat32(offset, true);
    return normalizedInteger ? Math.max(raw / divisor, -1) : raw;
  };
  if (layout.hasBase) {
    for (let item = 0; item < layout.count; item += 1) {
      const source = layout.absoluteOffset + item * layout.stride;
      const target = item * componentCount;
      for (let component = 0; component < componentCount; component += 1) {
        values[target + component] = readComponent(
          layout.dataView,
          source + component * componentBytes,
        );
      }
    }
  }
  visitSparseComponents(context, accessorIndex, componentBytes, componentCount, (
    item,
    component,
    source,
    dataView,
  ) => {
    values[item * componentCount + component] = readComponent(dataView, source);
  });
  for (let item = 0; item < layout.count; item += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      if (!Number.isFinite(values[item * componentCount + component])) {
        fail(context.label, path, `${semantic} ${item} is not finite`);
      }
    }
  }
  return { count: layout.count, values };
};

export const readPositions = (
  context: AccessorContext,
  accessorIndex: number,
): Pick<CanonicalTriangleGeometry, "bounds" | "positions"> => {
  const layout = accessorLayout(context, accessorIndex, "VEC3", 4, 3);
  if (layout.componentType !== 5126) {
    fail(context.label, `accessors[${accessorIndex}].componentType`, "must be FLOAT");
  }
  const positions = layout.hasBase && !layout.hasSparse && layout.stride === 12
    ? new Float32Array(
      context.binary.buffer,
      context.binary.byteOffset + layout.absoluteOffset,
      layout.count * 3,
    )
    : new Float32Array(layout.count * 3);
  if (layout.hasBase && (layout.hasSparse || layout.stride !== 12)) {
    for (let vertex = 0; vertex < layout.count; vertex += 1) {
      const source = layout.absoluteOffset + vertex * layout.stride;
      const target = vertex * 3;
      positions[target] = layout.dataView.getFloat32(source, true);
      positions[target + 1] = layout.dataView.getFloat32(source + 4, true);
      positions[target + 2] = layout.dataView.getFloat32(source + 8, true);
    }
  }
  visitSparseComponents(context, accessorIndex, 4, 3, (item, component, source, dataView) => {
    positions[item * 3 + component] = dataView.getFloat32(source, true);
  });
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let vertex = 0; vertex < layout.count; vertex += 1) {
    const target = vertex * 3;
    const x = positions[target]!;
    const y = positions[target + 1]!;
    const z = positions[target + 2]!;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      fail(context.label, `accessors[${accessorIndex}]`, `position ${vertex} is not finite`);
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

export const decodedPositions = (
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

export const validateDecodedVectors = (
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

export const readFloatVectors = (
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
  const values = layout.hasBase && !layout.hasSparse && layout.stride === elementBytes
    ? new Float32Array(
      context.binary.buffer,
      context.binary.byteOffset + layout.absoluteOffset,
      layout.count * componentCount,
    )
    : new Float32Array(layout.count * componentCount);
  if (layout.hasBase && (layout.hasSparse || layout.stride !== elementBytes)) {
    for (let item = 0; item < layout.count; item += 1) {
      const source = layout.absoluteOffset + item * layout.stride;
      const target = item * componentCount;
      for (let component = 0; component < componentCount; component += 1) {
        values[target + component] = layout.dataView.getFloat32(source + component * 4, true);
      }
    }
  }
  visitSparseComponents(context, accessorIndex, 4, componentCount, (
    item,
    component,
    source,
    dataView,
  ) => {
    values[item * componentCount + component] = dataView.getFloat32(source, true);
  });
  for (let item = 0; item < layout.count; item += 1) {
    for (let component = 0; component < componentCount; component += 1) {
      if (!Number.isFinite(values[item * componentCount + component])) {
        fail(context.label, `accessors[${accessorIndex}]`, `${semantic} ${item} is not finite`);
      }
    }
  }
  return values;
};

const canonicalColorValues = (
  source: Float32Array,
  componentCount: 3 | 4,
  label: string,
  path: string,
): Float32Array => {
  if (source.length === 0 || source.length % componentCount !== 0) {
    fail(label, path, "COLOR_0 decoded attribute size is invalid");
  }
  const colors = new Float32Array(source.length / componentCount * 4);
  for (let sourceOffset = 0, targetOffset = 0; sourceOffset < source.length;
    sourceOffset += componentCount, targetOffset += 4) {
    for (let component = 0; component < componentCount; component += 1) {
      const value = source[sourceOffset + component]!;
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        fail(label, path, `COLOR_0 component ${sourceOffset + component} must be between 0 and 1`);
      }
      colors[targetOffset + component] = value;
    }
    if (componentCount === 3) colors[targetOffset + 3] = 1;
  }
  return colors;
};

/** Normalizes every legal glTF COLOR_0 representation to canonical linear RGBA floats. */
export const readVertexColors = (
  context: AccessorContext,
  accessorIndex: number,
  decoded?: Float32Array,
): Float32Array => {
  const path = `accessors[${accessorIndex}]`;
  const accessor = object(context.accessors[accessorIndex], context.label, path);
  const componentCount: 3 | 4 = accessor.type === "VEC3"
    ? 3
    : accessor.type === "VEC4"
      ? 4
      : fail(context.label, `${path}.type`, "must be VEC3 or VEC4 for COLOR_0");
  const componentType = integer(accessor.componentType, context.label, `${path}.componentType`);
  const integerColor = componentType === 5121 || componentType === 5123;
  if (componentType !== 5126 && !integerColor) {
    fail(context.label, `${path}.componentType`, "must be FLOAT, UNSIGNED_BYTE, or UNSIGNED_SHORT for COLOR_0");
  }
  if (integerColor !== (accessor.normalized === true)) {
    fail(
      context.label,
      `${path}.normalized`,
      integerColor ? "must be true for integer COLOR_0" : "must be omitted for FLOAT COLOR_0",
    );
  }
  const count = nonNegativeInteger(accessor.count, context.label, `${path}.count`);
  if (decoded !== undefined) {
    if (decoded.length !== count * componentCount) {
      fail(context.label, path, "decoded COLOR_0 count does not match its accessor");
    }
    return canonicalColorValues(decoded, componentCount, context.label, path);
  }
  const componentBytes = componentType === 5121 ? 1 : componentType === 5123 ? 2 : 4;
  const layout = accessorLayout(
    context,
    accessorIndex,
    accessor.type as "VEC3" | "VEC4",
    componentBytes,
    componentCount,
    true,
  );
  const values = new Float32Array(layout.count * componentCount);
  const divisor = componentType === 5121 ? 255 : componentType === 5123 ? 65_535 : 1;
  const readComponent = (dataView: DataView, offset: number): number => (
    componentType === 5121
      ? dataView.getUint8(offset) / divisor
      : componentType === 5123
        ? dataView.getUint16(offset, true) / divisor
        : dataView.getFloat32(offset, true)
  );
  if (layout.hasBase) {
    for (let item = 0; item < layout.count; item += 1) {
      const source = layout.absoluteOffset + item * layout.stride;
      const target = item * componentCount;
      for (let component = 0; component < componentCount; component += 1) {
        values[target + component] = readComponent(
          layout.dataView,
          source + component * componentBytes,
        );
      }
    }
  }
  visitSparseComponents(context, accessorIndex, componentBytes, componentCount, (
    item,
    component,
    source,
    dataView,
  ) => {
    values[item * componentCount + component] = readComponent(dataView, source);
  });
  return canonicalColorValues(values, componentCount, context.label, path);
};

const sequentialIndices = (count: number): IndexArray => {
  const indices: IndexArray = count <= 0x100
    ? new Uint8Array(count)
    : count <= 0x1_00_00 ? new Uint16Array(count) : new Uint32Array(count);
  for (let index = 0; index < count; index += 1) indices[index] = index;
  return indices;
};

export const readIndices = (
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
    ? layout.hasBase && !layout.hasSparse
      ? new Uint8Array(context.binary.buffer, byteOffset, layout.count)
      : new Uint8Array(layout.count)
    : componentType === 5123
      ? layout.hasBase && !layout.hasSparse
        ? new Uint16Array(context.binary.buffer, byteOffset, layout.count)
        : new Uint16Array(layout.count)
      : layout.hasBase && !layout.hasSparse
        ? new Uint32Array(context.binary.buffer, byteOffset, layout.count)
        : new Uint32Array(layout.count);
  if (layout.hasBase && layout.hasSparse) {
    for (let item = 0; item < layout.count; item += 1) {
      const source = layout.absoluteOffset + item * componentBytes;
      indices[item] = componentType === 5121
        ? layout.dataView.getUint8(source)
        : componentType === 5123
          ? layout.dataView.getUint16(source, true)
          : layout.dataView.getUint32(source, true);
    }
  }
  visitSparseComponents(context, accessorIndex, componentBytes, 1, (
    item,
    _component,
    source,
    dataView,
  ) => {
    indices[item] = componentType === 5121
      ? dataView.getUint8(source)
      : componentType === 5123
        ? dataView.getUint16(source, true)
        : dataView.getUint32(source, true);
  });
  const restartSentinel = componentType === 5121 ? 0xff : componentType === 5123 ? 0xffff : 0xffff_ffff;
  for (let item = 0; item < indices.length; item += 1) {
    if (indices[item] === restartSentinel) {
      fail(context.label, `accessors[${accessorIndex}][${item}]`, "must not use the primitive-restart sentinel");
    }
    if (indices[item]! >= vertexCount) {
      fail(context.label, `accessors[${accessorIndex}][${item}]`, "vertex index is out of range");
    }
  }
  return indices;
};

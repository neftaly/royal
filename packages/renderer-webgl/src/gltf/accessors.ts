import type { GltfAccessor, GltfDocument } from "./schema";

export type GltfIndexArray = Uint8Array | Uint16Array | Uint32Array;

const COMPONENT_BYTE = 5120;
const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_SHORT = 5122;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const COMPONENT_FLOAT = 5126;

export const gltfComponentCount = (type: GltfAccessor["type"]): number => {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
  }
};

const componentSize = (componentType: number): number => {
  switch (componentType) {
    case COMPONENT_BYTE:
    case COMPONENT_UNSIGNED_BYTE:
      return 1;
    case COMPONENT_SHORT:
    case COMPONENT_UNSIGNED_SHORT:
      return 2;
    case COMPONENT_UNSIGNED_INT:
    case COMPONENT_FLOAT:
      return 4;
    default:
      throw new Error(`Unsupported glTF accessor component type ${componentType}`);
  }
};

const componentValue = (
  view: DataView,
  offset: number,
  componentType: number,
  normalized: boolean,
): number => {
  switch (componentType) {
    case COMPONENT_BYTE: {
      const value = view.getInt8(offset);
      return normalized ? Math.max(value / 127, -1) : value;
    }
    case COMPONENT_UNSIGNED_BYTE: {
      const value = view.getUint8(offset);
      return normalized ? value / 255 : value;
    }
    case COMPONENT_SHORT: {
      const value = view.getInt16(offset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    }
    case COMPONENT_UNSIGNED_SHORT: {
      const value = view.getUint16(offset, true);
      return normalized ? value / 65535 : value;
    }
    case COMPONENT_UNSIGNED_INT:
      return view.getUint32(offset, true);
    case COMPONENT_FLOAT:
      return view.getFloat32(offset, true);
    default:
      throw new Error(`Unsupported glTF accessor component type ${componentType}`);
  }
};

const accessorDataView = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
): { readonly accessorOffset: number; readonly dataView: DataView; readonly stride: number } | undefined => {
  if (accessor.bufferView === undefined) return undefined;
  const bufferView = document.bufferViews?.[accessor.bufferView];
  if (bufferView === undefined) return undefined;
  const buffer = buffers[bufferView.buffer ?? 0];
  if (buffer === undefined) return undefined;

  const componentCount = gltfComponentCount(accessor.type);
  const elementSize = componentCount * componentSize(accessor.componentType);
  const bufferViewOffset = bufferView.byteOffset ?? 0;
  const accessorOffset = bufferViewOffset + (accessor.byteOffset ?? 0);

  return {
    accessorOffset,
    dataView: new DataView(buffer),
    stride: bufferView.byteStride ?? elementSize,
  };
};

const sparseIndices = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
): readonly number[] => {
  const sparse = accessor.sparse;
  if (sparse === undefined || sparse.count <= 0) return [];
  const indexView = document.bufferViews?.[sparse.indices.bufferView];
  if (indexView === undefined) return [];
  const buffer = buffers[indexView.buffer ?? 0];
  if (buffer === undefined) return [];
  const view = new DataView(buffer);
  const offset = (indexView.byteOffset ?? 0) + (sparse.indices.byteOffset ?? 0);
  const step = componentSize(sparse.indices.componentType);
  const indices: number[] = [];

  for (let index = 0; index < sparse.count; index += 1) {
    indices.push(componentValue(view, offset + index * step, sparse.indices.componentType, false));
  }

  return indices;
};

const applySparseFloatValues = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
  output: Float32Array,
): void => {
  const sparse = accessor.sparse;
  if (sparse === undefined || sparse.count <= 0) return;
  const valueView = document.bufferViews?.[sparse.values.bufferView];
  if (valueView === undefined) return;
  const buffer = buffers[valueView.buffer ?? 0];
  if (buffer === undefined) return;

  const indices = sparseIndices(document, buffers, accessor);
  const componentCount = gltfComponentCount(accessor.type);
  const step = componentSize(accessor.componentType);
  const view = new DataView(buffer);
  const offset = (valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);

  for (let sparseIndex = 0; sparseIndex < Math.min(sparse.count, indices.length); sparseIndex += 1) {
    const target = indices[sparseIndex]!;
    for (let component = 0; component < componentCount; component += 1) {
      const sourceOffset = offset + (sparseIndex * componentCount + component) * step;
      output[target * componentCount + component] = componentValue(
        view,
        sourceOffset,
        accessor.componentType,
        accessor.normalized === true,
      );
    }
  }
};

export const readGltfFloatAccessor = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
): Float32Array => {
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) return new Float32Array();

  const componentCount = gltfComponentCount(accessor.type);
  const output = new Float32Array(accessor.count * componentCount);
  const source = accessorDataView(document, buffers, accessor);
  if (source !== undefined) {
    const step = componentSize(accessor.componentType);
    for (let element = 0; element < accessor.count; element += 1) {
      const elementOffset = source.accessorOffset + element * source.stride;
      for (let component = 0; component < componentCount; component += 1) {
        output[element * componentCount + component] = componentValue(
          source.dataView,
          elementOffset + component * step,
          accessor.componentType,
          accessor.normalized === true,
        );
      }
    }
  }

  applySparseFloatValues(document, buffers, accessor, output);

  return output;
};

const indexArray = (componentType: number, count: number): GltfIndexArray => {
  switch (componentType) {
    case COMPONENT_UNSIGNED_BYTE:
      return new Uint8Array(count);
    case COMPONENT_UNSIGNED_SHORT:
      return new Uint16Array(count);
    case COMPONENT_UNSIGNED_INT:
      return new Uint32Array(count);
    default:
      throw new Error(`Unsupported glTF index component type ${componentType}`);
  }
};

export const readGltfIndices = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
): GltfIndexArray => {
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) return new Uint16Array();
  const output = indexArray(accessor.componentType, accessor.count);
  const source = accessorDataView(document, buffers, accessor);
  if (source !== undefined) {
    for (let element = 0; element < accessor.count; element += 1) {
      output[element] = componentValue(
        source.dataView,
        source.accessorOffset + element * source.stride,
        accessor.componentType,
        false,
      );
    }
  }

  const sparse = accessor.sparse;
  if (sparse === undefined || sparse.count <= 0) return output;
  const valueView = document.bufferViews?.[sparse.values.bufferView];
  if (valueView === undefined) return output;
  const buffer = buffers[valueView.buffer ?? 0];
  if (buffer === undefined) return output;
  const indices = sparseIndices(document, buffers, accessor);
  const view = new DataView(buffer);
  const offset = (valueView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
  const step = componentSize(accessor.componentType);

  for (let sparseIndex = 0; sparseIndex < Math.min(sparse.count, indices.length); sparseIndex += 1) {
    output[indices[sparseIndex]!] = componentValue(
      view,
      offset + sparseIndex * step,
      accessor.componentType,
      false,
    );
  }

  return output;
};

import type { GltfAccessor, GltfBufferView, GltfDocument } from "./schema";

export type GltfIndexArray = Uint8Array | Uint16Array | Uint32Array;

const COMPONENT_BYTE = 5120;
const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_SHORT = 5122;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const COMPONENT_FLOAT = 5126;

export const gltfComponentCount = (type: GltfAccessor["type"]): number => {
  switch (type) {
    case "SCALAR": return 1;
    case "VEC2": return 2;
    case "VEC3": return 3;
    case "VEC4": return 4;
    case "MAT2": return 4;
    case "MAT3": return 9;
    case "MAT4": return 16;
  }
};

const componentSize = (componentType: number, context = "glTF accessor"): number => {
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
      throw new Error(`${context} has unsupported component type ${componentType}`);
  }
};

type AccessorLayout = {
  readonly componentOffset: (component: number) => number;
  readonly elementSize: number;
  readonly requiredAlignment: number;
};

const accessorLayout = (accessor: GltfAccessor, step: number): AccessorLayout => {
  const dimension = accessor.type === "MAT2" ? 2 : accessor.type === "MAT3" ? 3 : accessor.type === "MAT4" ? 4 : 0;
  if (dimension === 0) {
    return {
      componentOffset: (component) => component * step,
      elementSize: gltfComponentCount(accessor.type) * step,
      requiredAlignment: step,
    };
  }
  const columnSize = dimension * step;
  const columnStride = Math.ceil(columnSize / 4) * 4;

  return {
    componentOffset: (component) => Math.floor(component / dimension) * columnStride + (component % dimension) * step,
    elementSize: columnStride * dimension,
    requiredAlignment: Math.max(step, 4),
  };
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

type CheckedBufferView = {
  readonly bufferView: GltfBufferView;
  readonly dataView: DataView;
  readonly viewLength: number;
  readonly viewOffset: number;
};

const checkedNonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid (${String(value)})`);

  return value;
};

const checkedBufferView = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  bufferViewIndex: number,
  context: string,
): CheckedBufferView => {
  const bufferView = document.bufferViews?.[bufferViewIndex];
  if (bufferView === undefined) throw new Error(`${context} references missing bufferView ${bufferViewIndex}`);
  const bufferIndex = bufferView.buffer ?? 0;
  const buffer = buffers[bufferIndex];
  if (buffer === undefined) throw new Error(`${context} bufferView ${bufferViewIndex} references missing buffer ${bufferIndex}`);
  const viewOffset = checkedNonNegativeInteger(bufferView.byteOffset ?? 0, `${context} bufferView ${bufferViewIndex} byteOffset`);
  const viewLength = checkedNonNegativeInteger(bufferView.byteLength, `${context} bufferView ${bufferViewIndex} byteLength`);
  if (viewOffset > buffer.byteLength || viewLength > buffer.byteLength - viewOffset) {
    throw new Error(
      `${context} bufferView ${bufferViewIndex} range [${viewOffset}, ${viewOffset + viewLength}) exceeds buffer ${bufferIndex} byteLength ${buffer.byteLength}`,
    );
  }

  return { bufferView, dataView: new DataView(buffer), viewLength, viewOffset };
};

const assertViewRange = (
  context: string,
  bufferViewIndex: number,
  viewLength: number,
  relativeOffset: number,
  byteLength: number,
): void => {
  if (relativeOffset > viewLength || byteLength > viewLength - relativeOffset) {
    throw new Error(
      `${context} byte range [${relativeOffset}, ${relativeOffset + byteLength}) exceeds bufferView ${bufferViewIndex} byteLength ${viewLength}`,
    );
  }
};

const checkedAccessor = (document: GltfDocument, accessorIndex: number): GltfAccessor => {
  const accessor = document.accessors?.[accessorIndex];
  if (accessor === undefined) throw new Error(`glTF accessor ${accessorIndex} does not exist`);
  checkedNonNegativeInteger(accessor.count, `glTF accessor ${accessorIndex} count`);
  if (accessor.bufferView === undefined && accessor.byteOffset !== undefined) {
    throw new Error(`glTF accessor ${accessorIndex} defines byteOffset without a bufferView`);
  }

  return accessor;
};

const accessorDataView = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
  accessorIndex: number,
): { readonly accessorOffset: number; readonly dataView: DataView; readonly stride: number } | undefined => {
  if (accessor.bufferView === undefined) return undefined;
  const context = `glTF accessor ${accessorIndex}`;
  const source = checkedBufferView(document, buffers, accessor.bufferView, context);
  const step = componentSize(accessor.componentType, context);
  const layout = accessorLayout(accessor, step);
  const { elementSize } = layout;
  const relativeOffset = checkedNonNegativeInteger(accessor.byteOffset ?? 0, `${context} byteOffset`);
  const declaredStride = source.bufferView.byteStride;
  const stride = declaredStride ?? elementSize;
  if (
    !Number.isSafeInteger(stride)
    || stride < elementSize
    || stride % layout.requiredAlignment !== 0
    || (declaredStride !== undefined && (stride < 4 || stride > 252 || stride % 4 !== 0))
  ) {
    throw new Error(`${context} has invalid byteStride ${String(stride)} for ${elementSize}-byte elements`);
  }
  if ((source.viewOffset + relativeOffset) % layout.requiredAlignment !== 0) {
    throw new Error(
      `${context} byteOffset ${relativeOffset} is not aligned to its ${layout.requiredAlignment}-byte element alignment`,
    );
  }
  const occupiedLength = accessor.count === 0 ? 0 : (accessor.count - 1) * stride + elementSize;
  if (!Number.isSafeInteger(occupiedLength)) throw new Error(`${context} byte range is too large`);
  assertViewRange(context, accessor.bufferView, source.viewLength, relativeOffset, occupiedLength);

  return {
    accessorOffset: source.viewOffset + relativeOffset,
    dataView: source.dataView,
    stride,
  };
};

const sparseIndices = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
  accessorIndex: number,
): readonly number[] => {
  const sparse = accessor.sparse;
  if (sparse === undefined || sparse.count === 0) return [];
  const context = `glTF accessor ${accessorIndex} sparse indices`;
  const componentType = sparse.indices.componentType;
  if (
    componentType !== COMPONENT_UNSIGNED_BYTE
    && componentType !== COMPONENT_UNSIGNED_SHORT
    && componentType !== COMPONENT_UNSIGNED_INT
  ) {
    throw new Error(`${context} has unsupported component type ${componentType}`);
  }
  const source = checkedBufferView(document, buffers, sparse.indices.bufferView, context);
  const offset = checkedNonNegativeInteger(sparse.indices.byteOffset ?? 0, `${context} byteOffset`);
  const step = componentSize(componentType, context);
  if ((source.viewOffset + offset) % step !== 0) {
    throw new Error(`${context} byteOffset ${offset} is not aligned to ${step} bytes`);
  }
  const byteLength = sparse.count * step;
  if (!Number.isSafeInteger(byteLength)) throw new Error(`${context} byte range is too large`);
  assertViewRange(context, sparse.indices.bufferView, source.viewLength, offset, byteLength);
  const indices: number[] = [];
  let previous = -1;
  for (let index = 0; index < sparse.count; index += 1) {
    const target = componentValue(source.dataView, source.viewOffset + offset + index * step, componentType, false);
    if (target >= accessor.count) throw new Error(`${context} value ${target} is outside accessor count ${accessor.count}`);
    if (target <= previous) {
      throw new Error(`${context} values must be strictly increasing (found ${target} after ${previous})`);
    }
    indices.push(target);
    previous = target;
  }

  return indices;
};

const checkedSparse = (accessor: GltfAccessor, accessorIndex: number): void => {
  const sparse = accessor.sparse;
  if (sparse === undefined) return;
  checkedNonNegativeInteger(sparse.count, `glTF accessor ${accessorIndex} sparse count`);
  if (sparse.count > accessor.count) {
    throw new Error(`glTF accessor ${accessorIndex} sparse count ${sparse.count} exceeds accessor count ${accessor.count}`);
  }
  if (sparse.count > 0 && sparse.indices === undefined) {
    throw new Error(`glTF accessor ${accessorIndex} sparse data is missing indices`);
  }
  if (sparse.count > 0 && sparse.values === undefined) {
    throw new Error(`glTF accessor ${accessorIndex} sparse data is missing values`);
  }
};

const applySparseFloatValues = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessor: GltfAccessor,
  accessorIndex: number,
  output: Float32Array,
): void => {
  const sparse = accessor.sparse;
  if (sparse === undefined || sparse.count === 0) return;
  const context = `glTF accessor ${accessorIndex} sparse values`;
  const source = checkedBufferView(document, buffers, sparse.values.bufferView, context);
  const indices = sparseIndices(document, buffers, accessor, accessorIndex);
  const componentCount = gltfComponentCount(accessor.type);
  const step = componentSize(accessor.componentType, context);
  const layout = accessorLayout(accessor, step);
  const offset = checkedNonNegativeInteger(sparse.values.byteOffset ?? 0, `${context} byteOffset`);
  if ((source.viewOffset + offset) % layout.requiredAlignment !== 0) {
    throw new Error(`${context} byteOffset ${offset} is not aligned to ${layout.requiredAlignment} bytes`);
  }
  const byteLength = sparse.count * layout.elementSize;
  if (!Number.isSafeInteger(byteLength)) throw new Error(`${context} byte range is too large`);
  assertViewRange(context, sparse.values.bufferView, source.viewLength, offset, byteLength);

  for (let sparseIndex = 0; sparseIndex < sparse.count; sparseIndex += 1) {
    const target = indices[sparseIndex]!;
    for (let component = 0; component < componentCount; component += 1) {
      const sourceOffset = source.viewOffset + offset + sparseIndex * layout.elementSize + layout.componentOffset(component);
      output[target * componentCount + component] = componentValue(
        source.dataView,
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
  const accessor = checkedAccessor(document, accessorIndex);
  checkedSparse(accessor, accessorIndex);
  const componentCount = gltfComponentCount(accessor.type);
  const output = new Float32Array(accessor.count * componentCount);
  const source = accessorDataView(document, buffers, accessor, accessorIndex);
  if (source !== undefined) {
    const step = componentSize(accessor.componentType, `glTF accessor ${accessorIndex}`);
    const layout = accessorLayout(accessor, step);
    for (let element = 0; element < accessor.count; element += 1) {
      const elementOffset = source.accessorOffset + element * source.stride;
      for (let component = 0; component < componentCount; component += 1) {
        output[element * componentCount + component] = componentValue(
          source.dataView,
          elementOffset + layout.componentOffset(component),
          accessor.componentType,
          accessor.normalized === true,
        );
      }
    }
  }
  applySparseFloatValues(document, buffers, accessor, accessorIndex, output);

  return output;
};

const indexArray = (componentType: number, count: number, accessorIndex: number): GltfIndexArray => {
  switch (componentType) {
    case COMPONENT_UNSIGNED_BYTE: return new Uint8Array(count);
    case COMPONENT_UNSIGNED_SHORT: return new Uint16Array(count);
    case COMPONENT_UNSIGNED_INT: return new Uint32Array(count);
    default: throw new Error(`glTF accessor ${accessorIndex} has unsupported index component type ${componentType}`);
  }
};

export const readGltfIndices = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  accessorIndex: number,
): GltfIndexArray => {
  const accessor = checkedAccessor(document, accessorIndex);
  checkedSparse(accessor, accessorIndex);
  if (accessor.type !== "SCALAR") throw new Error(`glTF index accessor ${accessorIndex} must have type SCALAR`);
  const output = indexArray(accessor.componentType, accessor.count, accessorIndex);
  const source = accessorDataView(document, buffers, accessor, accessorIndex);
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
  if (sparse === undefined || sparse.count === 0) return output;
  const context = `glTF accessor ${accessorIndex} sparse values`;
  const valueSource = checkedBufferView(document, buffers, sparse.values.bufferView, context);
  const indices = sparseIndices(document, buffers, accessor, accessorIndex);
  const offset = checkedNonNegativeInteger(sparse.values.byteOffset ?? 0, `${context} byteOffset`);
  const step = componentSize(accessor.componentType, context);
  if ((valueSource.viewOffset + offset) % step !== 0) {
    throw new Error(`${context} byteOffset ${offset} is not aligned to ${step} bytes`);
  }
  const byteLength = sparse.count * step;
  if (!Number.isSafeInteger(byteLength)) throw new Error(`${context} byte range is too large`);
  assertViewRange(context, sparse.values.bufferView, valueSource.viewLength, offset, byteLength);
  for (let sparseIndex = 0; sparseIndex < sparse.count; sparseIndex += 1) {
    output[indices[sparseIndex]!] = componentValue(
      valueSource.dataView,
      valueSource.viewOffset + offset + sparseIndex * step,
      accessor.componentType,
      false,
    );
  }

  return output;
};

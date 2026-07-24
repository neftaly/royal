import { decodeDracoMesh } from "minidraco";
import { selectedStaticMeshIndices } from "./static-node-selection";

type JsonObject = Record<string, unknown>;
export type DracoAttributeSemantic =
  | "COLOR_0"
  | "NORMAL"
  | "POSITION"
  | "TANGENT"
  | "TEXCOORD_0"
  | "TEXCOORD_1";

export type DecodedDracoPrimitive = Readonly<{
  attribute: (semantic: DracoAttributeSemantic) => Float32Array | undefined;
  indices: Uint8Array | Uint16Array | Uint32Array;
}>;

type DracoMesh = Readonly<{
  faces_: ArrayLike<number>;
  getAttributeByUniqueId: (id: number) => Readonly<{
    extractTo: (
      output: Float32ArrayConstructor,
      pointCount: number,
    ) => Float32Array;
    numComponents: number;
  }> | null;
  numFaces: () => number;
  numPoints: () => number;
}>;

export type StaticDracoAttributeTask = Readonly<{
  accessor: JsonObject;
  components: number;
  semantic: DracoAttributeSemantic;
  uniqueId: number;
}>;

/** Serializable codec task; document and buffer-layout variation ends here. */
export type StaticDracoDecodeTask = Readonly<{
  attributes: readonly StaticDracoAttributeTask[];
  bytes: Uint8Array;
  indexAccessor?: JsonObject;
  label: string;
  path: string;
}>;

export type StaticDracoMeshDecoder = (bytes: Uint8Array) => DracoMesh;
export type StaticDracoTaskPlanner = (
  primitive: JsonObject,
  path: string,
) => StaticDracoDecodeTask;
export type StaticDracoDecodedTask = Readonly<{
  attributes: readonly Readonly<{
    semantic: DracoAttributeSemantic;
    values: Float32Array;
  }>[];
  indices: Uint8Array | Uint16Array | Uint32Array;
  path: string;
}>;
export type StaticDracoTaskExecutor = (
  tasks: readonly StaticDracoDecodeTask[],
) => Promise<readonly StaticDracoDecodedTask[]>;

const ATTRIBUTE_SEMANTICS: readonly DracoAttributeSemantic[] = [
  "POSITION",
  "NORMAL",
  "TANGENT",
  "TEXCOORD_0",
  "TEXCOORD_1",
  "COLOR_0",
];

const object = (value: unknown, label: string): JsonObject => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonObject;
};

const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
};

const index = (value: unknown, length: number, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value >= length) {
    throw new Error(`${label} must be an in-range index`);
  }
  return value;
};

const componentCount = (type: unknown, label: string): number => {
  if (type === "VEC2") return 2;
  if (type === "VEC3") return 3;
  if (type === "VEC4") return 4;
  throw new Error(`${label}.type is not a supported vector`);
};

const normalizedValues = (values: Float32Array, accessor: JsonObject): Float32Array => {
  if (accessor.normalized !== true) return values;
  let divisor: number;
  let signed = false;
  switch (accessor.componentType) {
    case 5120: divisor = 127; signed = true; break;
    case 5121: divisor = 255; break;
    case 5122: divisor = 32_767; signed = true; break;
    case 5123: divisor = 65_535; break;
    default: return values;
  }
  for (let offset = 0; offset < values.length; offset += 1) {
    const value = values[offset]! / divisor;
    values[offset] = signed ? Math.max(value, -1) : value;
  }
  return values;
};

const decodedIndices = (
  mesh: DracoMesh,
  accessor: JsonObject | undefined,
  label: string,
  path: string,
): Uint8Array | Uint16Array | Uint32Array => {
  const count = mesh.numFaces() * 3;
  const pointCount = mesh.numPoints();
  const componentType = accessor?.componentType;
  if (accessor !== undefined) {
    if (accessor.type !== "SCALAR") throw new Error(`${label} ${path}.type must be SCALAR`);
    if (accessor.count !== count) {
      throw new Error(`${label} ${path}.count does not match decoded faces`);
    }
    if (componentType !== 5121 && componentType !== 5123 && componentType !== 5125) {
      throw new Error(`${label} ${path}.componentType must be an unsigned integer`);
    }
    if (
      (componentType === 5121 && pointCount > 0x100)
      || (componentType === 5123 && pointCount > 0x1_00_00)
    ) throw new Error(`${label} ${path}.componentType cannot address the decoded points`);
  }
  const values = componentType === 5121
    ? new Uint8Array(count)
    : componentType === 5125 || pointCount > 0x1_00_00
      ? new Uint32Array(count)
      : new Uint16Array(count);
  for (let offset = 0; offset < count; offset += 1) {
    const value = mesh.faces_[offset];
    if (value === undefined || value < 0 || value >= pointCount) {
      throw new Error(`${label} ${path} decoded index ${offset} is out of range`);
    }
    values[offset] = value;
  }
  return values;
};

const planTask = (
  accessors: readonly unknown[],
  bufferViews: readonly unknown[],
  binary: Uint8Array,
  label: string,
  primitive: JsonObject,
  path: string,
): StaticDracoDecodeTask => {
  const extensions = object(primitive.extensions, `${label} ${path}.extensions`);
  const extension = object(
    extensions.KHR_draco_mesh_compression,
    `${label} ${path}.extensions.KHR_draco_mesh_compression`,
  );
  const viewIndex = index(
    extension.bufferView,
    bufferViews.length,
    `${label} ${path} Draco bufferView`,
  );
  const view = object(bufferViews[viewIndex], `${label} bufferViews[${viewIndex}]`);
  if (view.buffer !== 0) throw new Error(`${label} bufferViews[${viewIndex}].buffer must be 0`);
  const offset = view.byteOffset === undefined ? 0 : Number(view.byteOffset);
  const length = Number(view.byteLength);
  if (
    !Number.isSafeInteger(offset)
    || offset < 0
    || !Number.isSafeInteger(length)
    || length <= 0
    || offset + length > binary.byteLength
  ) throw new Error(`${label} ${path} Draco bufferView exceeds the buffer`);
  const attributeIds = object(extension.attributes, `${label} ${path} Draco attributes`);
  const primitiveAttributes = object(primitive.attributes, `${label} ${path}.attributes`);
  if (attributeIds.POSITION === undefined) {
    throw new Error(`${label} ${path} Draco attributes must include POSITION`);
  }
  const attributes: StaticDracoAttributeTask[] = [];
  for (const semantic of ATTRIBUTE_SEMANTICS) {
    if (attributeIds[semantic] === undefined || primitiveAttributes[semantic] === undefined) continue;
    const uniqueId = Number(attributeIds[semantic]);
    if (!Number.isSafeInteger(uniqueId) || uniqueId < 0) {
      throw new Error(`${label} ${path} Draco ${semantic} id is invalid`);
    }
    const accessorIndex = index(
      primitiveAttributes[semantic],
      accessors.length,
      `${label} ${path}.attributes.${semantic}`,
    );
    const accessor = object(accessors[accessorIndex], `${label} accessors[${accessorIndex}]`);
    attributes.push({
      accessor,
      components: componentCount(accessor.type, `${label} accessors[${accessorIndex}]`),
      semantic,
      uniqueId,
    });
  }
  const indexAccessor = primitive.indices === undefined
    ? undefined
    : object(
      accessors[index(primitive.indices, accessors.length, `${label} ${path}.indices`)],
      `${label} ${path}.indices accessor`,
    );
  return {
    attributes,
    bytes: new Uint8Array(binary.buffer, binary.byteOffset + offset, length),
    ...(indexAccessor === undefined ? {} : { indexAccessor }),
    label,
    path,
  };
};

/** Executes one normalized codec task and lazily extracts requested attributes. */
export const decodeStaticDracoTask = (
  task: StaticDracoDecodeTask,
  decodeMesh: StaticDracoMeshDecoder = decodeDracoMesh,
): DecodedDracoPrimitive => {
  let mesh: DracoMesh;
  try {
    mesh = decodeMesh(task.bytes);
  } catch (error) {
    throw new Error(`${task.label} ${task.path} Draco decode failed: ${
      error instanceof Error ? error.message : String(error)
    }`);
  }
  const decodedAttributes = new Map<DracoAttributeSemantic, Float32Array>();
  const attribute = (semantic: DracoAttributeSemantic): Float32Array | undefined => {
    const cached = decodedAttributes.get(semantic);
    if (cached !== undefined) return cached;
    const planned = task.attributes.find((candidate) => candidate.semantic === semantic);
    if (planned === undefined) return undefined;
    const count = Number(planned.accessor.count);
    if (!Number.isSafeInteger(count) || count !== mesh.numPoints()) {
      throw new Error(`${task.label} ${task.path} Draco ${semantic} count does not match decoded points`);
    }
    const source = mesh.getAttributeByUniqueId(planned.uniqueId);
    if (source === null || source.numComponents !== planned.components) {
      throw new Error(`${task.label} ${task.path} Draco ${semantic} shape is invalid`);
    }
    const values = normalizedValues(
      source.extractTo(Float32Array, mesh.numPoints()),
      planned.accessor,
    );
    decodedAttributes.set(semantic, values);
    return values;
  };
  return {
    attribute,
    indices: decodedIndices(mesh, task.indexAccessor, task.label, `${task.path}.indices`),
  };
};

/** Creates a demand decoder; compressed primitives decode only when selected-scene traversal reaches them. */
export const createStaticDracoTaskPlanner = (
  document: JsonObject,
  binary: Uint8Array,
  label: string,
): StaticDracoTaskPlanner => {
  const accessors = array(document.accessors, `${label} accessors`);
  const bufferViews = array(document.bufferViews, `${label} bufferViews`);
  return (primitive, path) => planTask(
    accessors,
    bufferViews,
    binary,
    label,
    primitive,
    path,
  );
};

/** Creates a demand decoder; compressed primitives decode only when selected-scene traversal reaches them. */
export const createStaticDracoDecoder = (
  document: JsonObject,
  binary: Uint8Array,
  label: string,
  decodeMesh: StaticDracoMeshDecoder = decodeDracoMesh,
): ((primitive: JsonObject, path: string) => DecodedDracoPrimitive) => {
  const plan = createStaticDracoTaskPlanner(document, binary, label);
  return (primitive, path) => decodeStaticDracoTask(plan(primitive, path), decodeMesh);
};

/** Materializes one task into a structured-cloneable canonical codec result. */
export const materializeStaticDracoTask = (
  task: StaticDracoDecodeTask,
  decodeMesh: StaticDracoMeshDecoder = decodeDracoMesh,
): StaticDracoDecodedTask => {
  const decoded = decodeStaticDracoTask(task, decodeMesh);
  return {
    attributes: task.attributes.map(({ semantic }) => ({
      semantic,
      values: decoded.attribute(semantic)!,
    })),
    indices: decoded.indices,
    path: task.path,
  };
};

const executeTasksSerially: StaticDracoTaskExecutor = async (tasks) =>
  tasks.map((task) => materializeStaticDracoTask(task));

/**
 * Inventories only selected-scene compressed primitives, executes them through
 * one injected scheduler, and returns the unchanged static-lowering decoder ABI.
 */
export const prepareSelectedStaticDracoDecoder = async (
  document: JsonObject,
  binary: Uint8Array,
  label: string,
  execute: StaticDracoTaskExecutor = executeTasksSerially,
  sceneIndex?: number,
  preparePrimitive?: (meshIndex: number, primitiveIndex: number) => boolean,
): Promise<(primitive: JsonObject, path: string) => DecodedDracoPrimitive> => {
  const meshes = array(document.meshes, `${label} meshes`);
  const plan = createStaticDracoTaskPlanner(document, binary, label);
  const tasks: StaticDracoDecodeTask[] = [];
  for (const meshIndex of selectedStaticMeshIndices(document, label, sceneIndex)) {
    const meshPath = `meshes[${meshIndex}]`;
    const mesh = object(meshes[meshIndex], `${label} ${meshPath}`);
    const primitives = array(mesh.primitives, `${label} ${meshPath}.primitives`);
    for (let primitiveIndex = 0; primitiveIndex < primitives.length; primitiveIndex += 1) {
      if (preparePrimitive?.(meshIndex, primitiveIndex) === false) continue;
      const path = `${meshPath}.primitives[${primitiveIndex}]`;
      const primitive = object(primitives[primitiveIndex], `${label} ${path}`);
      if (primitive.extensions === undefined) continue;
      const extensions = object(primitive.extensions, `${label} ${path}.extensions`);
      if (extensions.KHR_draco_mesh_compression === undefined) continue;
      tasks.push(plan(primitive, path));
    }
  }
  const results = await execute(tasks);
  if (results.length !== tasks.length) {
    throw new Error(`${label} Draco task executor returned an incomplete result set`);
  }
  const byPath = new Map(results.map((result) => [result.path, result]));
  return (_primitive, path) => {
    const result = byPath.get(path);
    if (result === undefined) throw new Error(`${label} ${path} has no prepared Draco result`);
    const attributes = new Map(result.attributes.map(({ semantic, values }) => [semantic, values]));
    return { attribute: (semantic) => attributes.get(semantic), indices: result.indices };
  };
};

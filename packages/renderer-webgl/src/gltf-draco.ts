import draco3dgltf, {
  type DracoDecoder,
  type DracoDecoderModule,
  type DracoDecoderModuleOptions,
  type DracoMesh,
  type DracoPointAttribute,
} from "draco3dgltf";
import dracoDecoderWasmUrl from "draco3dgltf/draco_decoder_gltf.wasm?url";
import type { GltfIndexArray } from "./gltf-accessors";
import { gltfBufferViewBytes } from "./gltf-io";
import type {
  GltfDocument,
  GltfDracoMeshCompressionExtension,
  GltfMeshPrimitive,
} from "./gltf-support";

export type DecodedGltfDracoPrimitive = {
  readonly attributes: ReadonlyMap<string, Float32Array>;
  readonly indices: GltfIndexArray;
};

const COMPONENT_UNSIGNED_BYTE = 5121;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;

const TEXCOORD_SEMANTIC_PATTERN = /^TEXCOORD_\d+$/u;

let decoderModulePromise: Promise<DracoDecoderModule> | undefined;

const isNodeRuntime = (): boolean =>
  typeof process === "object"
  && process !== null
  && typeof process.versions === "object"
  && typeof process.versions.node === "string";

const decoderModuleOptions = (): DracoDecoderModuleOptions =>
  isNodeRuntime()
    ? {}
    : {
      locateFile: (path) => path === "draco_decoder_gltf.wasm" ? dracoDecoderWasmUrl : path,
    };

const dracoDecoderModule = (): Promise<DracoDecoderModule> => {
  decoderModulePromise ??= draco3dgltf.createDecoderModule(decoderModuleOptions());

  return decoderModulePromise;
};

const assertNonNegativeInteger = (label: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
};

const compressedPrimitiveBytes = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  extension: GltfDracoMeshCompressionExtension,
  label: string,
): ArrayBuffer => {
  assertNonNegativeInteger(`${label} KHR_draco_mesh_compression bufferView`, extension.bufferView);

  const bufferView = document.bufferViews?.[extension.bufferView];
  if (bufferView === undefined) {
    throw new Error(`${label} KHR_draco_mesh_compression references missing bufferView ${extension.bufferView}`);
  }

  const bytes = gltfBufferViewBytes(document, buffers, extension.bufferView);
  if (bytes.byteLength !== bufferView.byteLength) {
    throw new Error(`${label} KHR_draco_mesh_compression source bufferView is unavailable`);
  }

  return bytes;
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

const expectedComponentCount = (semantic: string): number | undefined => {
  if (semantic === "POSITION" || semantic === "NORMAL") return 3;
  if (TEXCOORD_SEMANTIC_PATTERN.test(semantic)) return 2;

  return undefined;
};

const renderableAttributeEntries = (
  extension: GltfDracoMeshCompressionExtension,
  label: string,
): ReadonlyArray<readonly [string, number]> =>
  Object.entries(extension.attributes ?? {})
    .flatMap((entry): Array<readonly [string, number]> => {
      const [semantic, uniqueId] = entry;
      if (expectedComponentCount(semantic) === undefined) return [];
      if (typeof uniqueId !== "number") {
        throw new Error(`${label} KHR_draco_mesh_compression ${semantic} attribute must be a number`);
      }
      assertNonNegativeInteger(`${label} KHR_draco_mesh_compression ${semantic} attribute`, uniqueId);

      return [[semantic, uniqueId]];
    });

const decodeAttribute = (
  module: DracoDecoderModule,
  decoder: DracoDecoder,
  mesh: DracoMesh,
  semantic: string,
  uniqueId: number,
  label: string,
): Float32Array => {
  const attribute: DracoPointAttribute = decoder.GetAttributeByUniqueId(mesh, uniqueId);
  if (attribute.ptr === 0) {
    throw new Error(`${label} KHR_draco_mesh_compression missing ${semantic} attribute ${uniqueId}`);
  }

  const componentCount = attribute.num_components();
  const expected = expectedComponentCount(semantic);
  if (expected !== undefined && componentCount !== expected) {
    throw new Error(
      `${label} KHR_draco_mesh_compression ${semantic} has ${componentCount} components, expected ${expected}`,
    );
  }

  const output = new module.DracoFloat32Array();
  try {
    if (!decoder.GetAttributeFloatForAllPoints(mesh, attribute, output)) {
      throw new Error(`${label} KHR_draco_mesh_compression failed to decode ${semantic}`);
    }

    const expectedSize = mesh.num_points() * componentCount;
    if (output.size() !== expectedSize) {
      throw new Error(`${label} KHR_draco_mesh_compression decoded invalid ${semantic} size`);
    }

    const values = new Float32Array(output.size());
    for (let index = 0; index < values.length; index += 1) {
      values[index] = output.GetValue(index);
    }

    return values;
  } finally {
    module.destroy(output);
  }
};

const decodeIndices = (
  module: DracoDecoderModule,
  decoder: DracoDecoder,
  mesh: DracoMesh,
  componentType: number | undefined,
): GltfIndexArray => {
  const faceCount = mesh.num_faces();
  const indices = dracoIndexArray(componentType, faceCount * 3, mesh.num_points());
  const face = new module.DracoInt32Array();
  try {
    for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
      if (!decoder.GetFaceFromMesh(mesh, faceIndex, face)) {
        throw new Error(`KHR_draco_mesh_compression failed to decode face ${faceIndex}`);
      }
      const offset = faceIndex * 3;
      indices[offset] = face.GetValue(0);
      indices[offset + 1] = face.GetValue(1);
      indices[offset + 2] = face.GetValue(2);
    }
  } finally {
    module.destroy(face);
  }

  return indices;
};

const decodePrimitive = async (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  primitive: GltfMeshPrimitive,
  extension: GltfDracoMeshCompressionExtension,
  label: string,
): Promise<DecodedGltfDracoPrimitive> => {
  const module = await dracoDecoderModule();
  const bytes = compressedPrimitiveBytes(document, buffers, extension, label);
  const decoder = new module.Decoder();
  const buffer = new module.DecoderBuffer();
  const mesh = new module.Mesh();
  try {
    buffer.Init(new Int8Array(bytes), bytes.byteLength);
    const geometryType = decoder.GetEncodedGeometryType(buffer);
    if (geometryType !== module.TRIANGULAR_MESH) {
      throw new Error(`${label} KHR_draco_mesh_compression only supports triangular meshes`);
    }

    const status = decoder.DecodeBufferToMesh(buffer, mesh);
    try {
      if (!status.ok()) {
        throw new Error(`${label} KHR_draco_mesh_compression decode failed: ${status.error_msg()}`);
      }
    } finally {
      module.destroy(status);
    }

    const attributes = new Map<string, Float32Array>();
    for (const [semantic, uniqueId] of renderableAttributeEntries(extension, label)) {
      attributes.set(semantic, decodeAttribute(module, decoder, mesh, semantic, uniqueId, label));
    }

    const componentType = primitive.indices === undefined
      ? undefined
      : document.accessors?.[primitive.indices]?.componentType;

    return {
      attributes,
      indices: decodeIndices(module, decoder, mesh, componentType),
    };
  } finally {
    module.destroy(mesh);
    module.destroy(buffer);
    module.destroy(decoder);
  }
};

export const decodeGltfDracoPrimitives = async (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
): Promise<ReadonlyMap<GltfMeshPrimitive, DecodedGltfDracoPrimitive>> => {
  const decoded = new Map<GltfMeshPrimitive, DecodedGltfDracoPrimitive>();
  for (const [meshIndex, mesh] of (document.meshes ?? []).entries()) {
    for (const [primitiveIndex, primitive] of (mesh.primitives ?? []).entries()) {
      const extension = primitive.extensions?.KHR_draco_mesh_compression;
      if (extension === undefined) continue;

      decoded.set(
        primitive,
        await decodePrimitive(
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

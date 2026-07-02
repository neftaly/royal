import { MeshoptDecoder } from "meshoptimizer/decoder";
import type {
  GltfBufferView,
  GltfDocument,
  GltfMeshoptCompressionExtension,
} from "./gltf-support";

type DecodedGltfBuffers = {
  readonly buffers: readonly ArrayBuffer[];
  readonly document: GltfDocument;
};

type MeshoptMode = "ATTRIBUTES" | "INDICES" | "TRIANGLES";
type MeshoptFilter = "EXPONENTIAL" | "NONE" | "OCTAHEDRAL" | "QUATERNION";

const isMeshoptMode = (value: string): value is MeshoptMode =>
  value === "ATTRIBUTES" || value === "INDICES" || value === "TRIANGLES";

const isMeshoptFilter = (value: string): value is MeshoptFilter =>
  value === "EXPONENTIAL"
  || value === "NONE"
  || value === "OCTAHEDRAL"
  || value === "QUATERNION";

const assertNonNegativeInteger = (label: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
};

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

const meshoptMode = (bufferViewIndex: number, extension: GltfMeshoptCompressionExtension): MeshoptMode => {
  if (isMeshoptMode(extension.mode)) return extension.mode;

  throw new Error(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression has unsupported mode ${extension.mode}`,
  );
};

const meshoptFilter = (
  bufferViewIndex: number,
  extension: GltfMeshoptCompressionExtension,
): MeshoptFilter | undefined => {
  const filter = extension.filter ?? "NONE";
  if (isMeshoptFilter(filter)) return filter === "NONE" ? undefined : filter;

  throw new Error(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression has unsupported filter ${filter}`,
  );
};

const sourceBytes = (
  bufferViewIndex: number,
  buffers: readonly ArrayBuffer[],
  extension: GltfMeshoptCompressionExtension,
): Uint8Array => {
  assertNonNegativeInteger(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression buffer`,
    extension.buffer,
  );
  assertNonNegativeInteger(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression byteOffset`,
    extension.byteOffset ?? 0,
  );
  assertNonNegativeInteger(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression byteLength`,
    extension.byteLength,
  );

  const buffer = buffers[extension.buffer];
  if (buffer === undefined) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression references missing buffer ${extension.buffer}`,
    );
  }

  const byteOffset = extension.byteOffset ?? 0;
  if (byteOffset + extension.byteLength > buffer.byteLength) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression source range exceeds buffer ${extension.buffer}`,
    );
  }

  return new Uint8Array(buffer, byteOffset, extension.byteLength);
};

const decodedByteLength = (
  bufferViewIndex: number,
  bufferView: GltfBufferView,
  extension: GltfMeshoptCompressionExtension,
): number => {
  assertNonNegativeInteger(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression count`,
    extension.count,
  );
  assertNonNegativeInteger(
    `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression byteStride`,
    extension.byteStride,
  );

  if (bufferView.byteStride !== undefined && bufferView.byteStride !== extension.byteStride) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression byteStride does not match parent bufferView`,
    );
  }

  const byteLength = extension.count * extension.byteStride;
  if (!Number.isSafeInteger(byteLength) || bufferView.byteLength !== byteLength) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression decoded byteLength does not match parent bufferView`,
    );
  }

  return byteLength;
};

const decodedBufferView = (
  bufferView: GltfBufferView,
  bufferIndex: number,
  byteLength: number,
): GltfBufferView => {
  const { extensions, ...rest } = bufferView;
  const remainingExtensions = Object.fromEntries(
    Object.entries(extensions ?? {}).filter(([name]) => name !== "EXT_meshopt_compression"),
  ) as NonNullable<GltfBufferView["extensions"]>;

  return {
    ...rest,
    ...(Object.keys(remainingExtensions).length === 0 ? {} : { extensions: remainingExtensions }),
    buffer: bufferIndex,
    byteLength,
    byteOffset: 0,
  };
};

const decodeMeshoptBufferView = (
  bufferViewIndex: number,
  bufferView: GltfBufferView,
  buffers: readonly ArrayBuffer[],
  extension: GltfMeshoptCompressionExtension,
): ArrayBuffer => {
  const mode = meshoptMode(bufferViewIndex, extension);
  const filter = meshoptFilter(bufferViewIndex, extension);
  if (mode !== "ATTRIBUTES" && filter !== undefined) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} EXT_meshopt_compression filter is only supported for ATTRIBUTES mode`,
    );
  }

  const byteLength = decodedByteLength(bufferViewIndex, bufferView, extension);
  const target = new Uint8Array(byteLength);

  MeshoptDecoder.decodeGltfBuffer(
    target,
    extension.count,
    extension.byteStride,
    sourceBytes(bufferViewIndex, buffers, extension),
    mode,
    filter,
  );

  return arrayBufferFromBytes(target);
};

export const decodeGltfMeshoptBufferViews = async (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
): Promise<DecodedGltfBuffers> => {
  const bufferViews = document.bufferViews;
  if (bufferViews === undefined) return { buffers, document };
  if (!bufferViews.some((bufferView) => bufferView.extensions?.EXT_meshopt_compression !== undefined)) {
    return { buffers, document };
  }
  if (!MeshoptDecoder.supported) throw new Error("EXT_meshopt_compression decoding is unavailable");

  await MeshoptDecoder.ready;

  const decodedBuffers: ArrayBuffer[] = [...buffers];
  const decodedBufferViews = bufferViews.map((bufferView, bufferViewIndex) => {
    const extension = bufferView.extensions?.EXT_meshopt_compression;
    if (extension === undefined) return bufferView;

    const buffer = decodeMeshoptBufferView(bufferViewIndex, bufferView, buffers, extension);
    const bufferIndex = decodedBuffers.length;
    decodedBuffers.push(buffer);

    return decodedBufferView(bufferView, bufferIndex, buffer.byteLength);
  });

  return {
    buffers: decodedBuffers,
    document: {
      ...document,
      bufferViews: decodedBufferViews,
    },
  };
};

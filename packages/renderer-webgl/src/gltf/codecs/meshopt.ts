import { MeshoptDecoder } from "meshoptimizer/decoder";
import type {
  GltfBufferView,
  GltfDocument,
  GltfMeshoptCompressionExtension,
} from "../schema";

type DecodedGltfBuffers = {
  readonly buffers: readonly ArrayBuffer[];
  readonly document: GltfDocument;
};

type MeshoptMode = "ATTRIBUTES" | "INDICES" | "TRIANGLES";
type MeshoptExtensionName = "EXT_meshopt_compression" | "KHR_meshopt_compression";
type MeshoptFilter = "COLOR" | "EXPONENTIAL" | "NONE" | "OCTAHEDRAL" | "QUATERNION";
type MeshoptDecoderFilter = Exclude<MeshoptFilter, "NONE">;

type MeshoptBufferViewExtension = {
  readonly extension: GltfMeshoptCompressionExtension;
  readonly name: MeshoptExtensionName;
};

const isMeshoptMode = (value: string): value is MeshoptMode =>
  value === "ATTRIBUTES" || value === "INDICES" || value === "TRIANGLES";

const meshoptFiltersByExtensionName: Record<MeshoptExtensionName, ReadonlySet<string>> = {
  EXT_meshopt_compression: new Set<MeshoptFilter>(["EXPONENTIAL", "NONE", "OCTAHEDRAL", "QUATERNION"]),
  KHR_meshopt_compression: new Set<MeshoptFilter>(["COLOR", "EXPONENTIAL", "NONE", "OCTAHEDRAL", "QUATERNION"]),
};

const assertNonNegativeInteger = (label: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
};

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);

  return buffer;
};

const meshoptLabel = (bufferViewIndex: number, extensionName: MeshoptExtensionName): string =>
  `glTF bufferView ${bufferViewIndex} ${extensionName}`;

const meshoptMode = (
  bufferViewIndex: number,
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
): MeshoptMode => {
  if (isMeshoptMode(extension.mode)) return extension.mode;

  throw new Error(
    `${meshoptLabel(bufferViewIndex, extensionName)} has unsupported mode ${extension.mode}`,
  );
};

const meshoptFilter = (
  bufferViewIndex: number,
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
): MeshoptDecoderFilter | undefined => {
  const filter = extension.filter ?? "NONE";
  if (meshoptFiltersByExtensionName[extensionName].has(filter)) {
    return filter === "NONE" ? undefined : filter as MeshoptDecoderFilter;
  }

  throw new Error(
    `${meshoptLabel(bufferViewIndex, extensionName)} has unsupported filter ${filter}`,
  );
};

const sourceBytes = (
  bufferViewIndex: number,
  buffers: readonly ArrayBuffer[],
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
): Uint8Array => {
  assertNonNegativeInteger(
    `${meshoptLabel(bufferViewIndex, extensionName)} buffer`,
    extension.buffer,
  );
  assertNonNegativeInteger(
    `${meshoptLabel(bufferViewIndex, extensionName)} byteOffset`,
    extension.byteOffset ?? 0,
  );
  assertNonNegativeInteger(
    `${meshoptLabel(bufferViewIndex, extensionName)} byteLength`,
    extension.byteLength,
  );

  const buffer = buffers[extension.buffer];
  if (buffer === undefined) {
    throw new Error(
      `${meshoptLabel(bufferViewIndex, extensionName)} references missing buffer ${extension.buffer}`,
    );
  }

  const byteOffset = extension.byteOffset ?? 0;
  if (byteOffset + extension.byteLength > buffer.byteLength) {
    throw new Error(
      `${meshoptLabel(bufferViewIndex, extensionName)} source range exceeds buffer ${extension.buffer}`,
    );
  }

  return new Uint8Array(buffer, byteOffset, extension.byteLength);
};

const decodedByteLength = (
  bufferViewIndex: number,
  bufferView: GltfBufferView,
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
): number => {
  assertNonNegativeInteger(
    `${meshoptLabel(bufferViewIndex, extensionName)} count`,
    extension.count,
  );
  assertNonNegativeInteger(
    `${meshoptLabel(bufferViewIndex, extensionName)} byteStride`,
    extension.byteStride,
  );

  if (bufferView.byteStride !== undefined && bufferView.byteStride !== extension.byteStride) {
    throw new Error(
      `${meshoptLabel(bufferViewIndex, extensionName)} byteStride does not match parent bufferView`,
    );
  }

  const byteLength = extension.count * extension.byteStride;
  if (!Number.isSafeInteger(byteLength) || bufferView.byteLength !== byteLength) {
    throw new Error(
      `${meshoptLabel(bufferViewIndex, extensionName)} decoded byteLength does not match parent bufferView`,
    );
  }

  return byteLength;
};

const decodedBufferView = (
  bufferView: GltfBufferView,
  bufferIndex: number,
  byteLength: number,
  extensionName: MeshoptExtensionName,
): GltfBufferView => {
  const { extensions, ...rest } = bufferView;
  const remainingExtensions = Object.fromEntries(
    Object.entries(extensions ?? {}).filter(([name]) => name !== extensionName),
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
  extensionName: MeshoptExtensionName,
  extension: GltfMeshoptCompressionExtension,
): ArrayBuffer => {
  const mode = meshoptMode(bufferViewIndex, extensionName, extension);
  const filter = meshoptFilter(bufferViewIndex, extensionName, extension);
  if (mode !== "ATTRIBUTES" && filter !== undefined) {
    throw new Error(
      `${meshoptLabel(bufferViewIndex, extensionName)} filter is only supported for ATTRIBUTES mode`,
    );
  }

  const byteLength = decodedByteLength(bufferViewIndex, bufferView, extensionName, extension);
  const target = new Uint8Array(byteLength);

  MeshoptDecoder.decodeGltfBuffer(
    target,
    extension.count,
    extension.byteStride,
    sourceBytes(bufferViewIndex, buffers, extensionName, extension),
    mode,
    filter,
  );

  return arrayBufferFromBytes(target);
};

const meshoptBufferViewExtension = (
  bufferViewIndex: number,
  bufferView: GltfBufferView,
): MeshoptBufferViewExtension | undefined => {
  const ext = bufferView.extensions?.EXT_meshopt_compression;
  const khr = bufferView.extensions?.KHR_meshopt_compression;
  if (ext !== undefined && khr !== undefined) {
    throw new Error(
      `glTF bufferView ${bufferViewIndex} KHR_meshopt_compression must not also use EXT_meshopt_compression`,
    );
  }
  if (khr !== undefined) return { extension: khr, name: "KHR_meshopt_compression" };
  if (ext !== undefined) return { extension: ext, name: "EXT_meshopt_compression" };

  return undefined;
};

const assertMeshoptBufferExtensionCompatibility = (document: GltfDocument): void => {
  for (const [bufferIndex, buffer] of (document.buffers ?? []).entries()) {
    if (
      buffer.extensions?.EXT_meshopt_compression !== undefined
      && buffer.extensions.KHR_meshopt_compression !== undefined
    ) {
      throw new Error(
        `glTF buffer ${bufferIndex} KHR_meshopt_compression must not also use EXT_meshopt_compression`,
      );
    }
  }
};

export const decodeGltfMeshoptBufferViews = async (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
): Promise<DecodedGltfBuffers> => {
  assertMeshoptBufferExtensionCompatibility(document);

  const bufferViews = document.bufferViews;
  if (bufferViews === undefined) return { buffers, document };
  const meshoptExtensions = bufferViews.map((bufferView, bufferViewIndex) =>
    meshoptBufferViewExtension(bufferViewIndex, bufferView));
  if (!meshoptExtensions.some((extension) => extension !== undefined)) {
    return { buffers, document };
  }
  if (!MeshoptDecoder.supported) {
    throw new Error("EXT_meshopt_compression/KHR_meshopt_compression decoding is unavailable");
  }

  await MeshoptDecoder.ready;

  const decodedBuffers: ArrayBuffer[] = [...buffers];
  const decodedBufferViews = bufferViews.map((bufferView, bufferViewIndex) => {
    const meshoptExtension = meshoptExtensions[bufferViewIndex];
    if (meshoptExtension === undefined) return bufferView;

    const buffer = decodeMeshoptBufferView(
      bufferViewIndex,
      bufferView,
      buffers,
      meshoptExtension.name,
      meshoptExtension.extension,
    );
    const bufferIndex = decodedBuffers.length;
    decodedBuffers.push(buffer);

    return decodedBufferView(bufferView, bufferIndex, buffer.byteLength, meshoptExtension.name);
  });

  return {
    buffers: decodedBuffers,
    document: {
      ...document,
      bufferViews: decodedBufferViews,
    },
  };
};

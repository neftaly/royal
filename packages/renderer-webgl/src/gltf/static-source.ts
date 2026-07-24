import { canonicalizeGltfBuffers } from "./canonical-buffers";
import { parseGlb } from "./glb";
import {
  array,
  fail,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";
import { resolveAssetUri } from "./static-material";
import {
  planStaticGltfBufferRequestsForViews,
  selectedStaticGltfBufferViewIndices,
  type StaticGltfResourceRequest,
} from "./static-buffer-demand";
import {
  decodeSelectedMeshoptBufferViews,
  meshoptFallbackBufferIndices,
} from "./meshopt";
import {
  validateStaticGltfDeclarations,
  type StaticGltfDeclarations,
} from "./static-declarations";

export type CanonicalStaticGltfSource = Readonly<{
  binary: Uint8Array;
  container: "glb" | "gltf";
  declarations: StaticGltfDeclarations;
  document: JsonObject;
  /** Resolved immutable external buffer identities, before canonical repacking. */
  geometryResourceIdentity?: string;
}>;

export type StaticGltfResourceReader = (
  uri: string,
  request?: StaticGltfResourceRequest,
) => Promise<Uint8Array>;

const isGlb = (bytes: Uint8Array): boolean => bytes.byteLength >= 4
  && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === 0x46_54_6c_67;

const parseJsonDocument = (bytes: Uint8Array, label: string): JsonObject => {
  let value: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail(label, "document", `is not valid UTF-8 JSON: ${detail}`);
  }
  return object(value, label, "document");
};

/** Parses only the root document, without reading or canonicalizing resources. */
export const parseStaticGltfDocument = (
  bytes: Uint8Array,
  label: string,
): JsonObject => isGlb(bytes)
  ? object(parseGlb(bytes, label).document, label, "document")
  : parseJsonDocument(bytes, label);

const externalGeometryResourceIdentity = (
  buffers: readonly unknown[],
  label: string,
  sourceUri: string,
): string | undefined => {
  const identities: string[] = [];
  for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
    const path = `buffers[${bufferIndex}]`;
    const buffer = object(buffers[bufferIndex], label, path);
    if (typeof buffer.uri !== "string" || buffer.uri.length === 0) return undefined;
    const uri = resolveAssetUri(sourceUri, buffer.uri);
    // Large inline payloads are already root bytes; retaining them in a key
    // would duplicate content merely to seek a rare cross-root reuse.
    if (uri.startsWith("data:")) return undefined;
    identities.push(uri);
  }
  return JSON.stringify(identities);
};

const readExternalBuffer = async (
  value: unknown,
  bufferIndex: number,
  label: string,
  sourceUri: string,
  read: StaticGltfResourceReader,
  fallbackBuffers: ReadonlySet<number>,
  meshoptRequired: boolean,
  request?: StaticGltfResourceRequest,
): Promise<Uint8Array> => {
  const path = `buffers[${bufferIndex}]`;
  const buffer = object(value, label, path);
  if (fallbackBuffers.has(bufferIndex)) {
    if (
      (typeof buffer.uri !== "string" || buffer.uri.length === 0)
      && !meshoptRequired
    ) {
      return fail(
        label,
        `${path}.uri`,
        "may be omitted for a meshopt fallback only when the extension is required",
      );
    }
    const byteLength = nonNegativeInteger(buffer.byteLength, label, `${path}.byteLength`);
    try {
      return new Uint8Array(byteLength);
    } catch {
      return fail(label, `${path}.byteLength`, "cannot allocate meshopt output buffer");
    }
  }
  if (typeof buffer.uri !== "string" || buffer.uri.length === 0) {
    return fail(label, `${path}.uri`, "must be a non-empty external or data URI");
  }
  return read(resolveAssetUri(sourceUri, buffer.uri), request);
};

/**
 * Effect boundary for container parsing, external reads, and one canonical
 * packed binary. Format variation is erased before codec or scene lowering.
 */
export const readCanonicalStaticGltfSource = async (
  bytes: Uint8Array,
  label: string,
  sourceUri: string,
  read: StaticGltfResourceReader,
  sceneIndex?: number,
  etc2Available = true,
): Promise<CanonicalStaticGltfSource> => {
  if (isGlb(bytes)) {
    const parsed = parseGlb(bytes, label);
    const document = object(parsed.document, label, "document");
    const declarations = validateStaticGltfDeclarations(
      document,
      label,
      true,
      true,
      etc2Available,
    );
    const binaryChunk = parsed.binaryChunk
      ?? fail(label, "buffers[0]", "requires a GLB BIN chunk");
    const buffers = array(document.buffers, label, "buffers");
    if (buffers.length === 0) fail(label, "buffers", "must not be empty");
    const firstBuffer = object(buffers[0], label, "buffers[0]");
    if (firstBuffer.uri !== undefined) {
      fail(label, "buffers[0].uri", "must be omitted for a GLB BIN chunk");
    }
    const firstLength = nonNegativeInteger(
      firstBuffer.byteLength,
      label,
      "buffers[0].byteLength",
    );
    const padding = binaryChunk.byteLength - firstLength;
    if (padding < 0 || padding > 3) {
      fail(label, "buffers[0].byteLength", "does not match the padded GLB BIN chunk");
    }
    const selectedViews = selectedStaticGltfBufferViewIndices(
      document,
      label,
      sceneIndex,
      etc2Available,
    );
    const requests = planStaticGltfBufferRequestsForViews(document, label, selectedViews);
    const meshoptRequired = optionalArray(
      document.extensionsRequired,
      label,
      "extensionsRequired",
    ).includes("EXT_meshopt_compression");
    const fallbackBuffers = meshoptFallbackBufferIndices(document, label, 0);
    const external = await Promise.all(buffers.slice(1).map((value, offset) =>
      readExternalBuffer(
        value,
        offset + 1,
        label,
        sourceUri,
        read,
        fallbackBuffers,
        meshoptRequired,
        requests[offset + 1],
      )));
    const sources = [binaryChunk.subarray(0, firstLength), ...external];
    await decodeSelectedMeshoptBufferViews(document, sources, selectedViews, label);
    const canonical = canonicalizeGltfBuffers(
      document,
      sources,
      label,
      selectedViews,
    );
    return { ...canonical, container: "glb", declarations };
  }

  const document = parseJsonDocument(bytes, label);
  const declarations = validateStaticGltfDeclarations(
    document,
    label,
    true,
    true,
    etc2Available,
  );
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length === 0) fail(label, "buffers", "must not be empty");
  const selectedViews = selectedStaticGltfBufferViewIndices(
    document,
    label,
    sceneIndex,
    etc2Available,
  );
  const requests = planStaticGltfBufferRequestsForViews(document, label, selectedViews);
  const meshoptRequired = optionalArray(
    document.extensionsRequired,
    label,
    "extensionsRequired",
  ).includes("EXT_meshopt_compression");
  const fallbackBuffers = meshoptFallbackBufferIndices(document, label);
  const sources = await Promise.all(buffers.map((value, bufferIndex) =>
    readExternalBuffer(
      value,
      bufferIndex,
      label,
      sourceUri,
      read,
      fallbackBuffers,
      meshoptRequired,
      requests[bufferIndex],
    )));
  await decodeSelectedMeshoptBufferViews(document, sources, selectedViews, label);
  const geometryResourceIdentity = externalGeometryResourceIdentity(
    buffers,
    label,
    sourceUri,
  );
  return {
    ...canonicalizeGltfBuffers(document, sources, label, selectedViews),
    container: "gltf",
    declarations,
    ...(geometryResourceIdentity === undefined ? {} : { geometryResourceIdentity }),
  };
};

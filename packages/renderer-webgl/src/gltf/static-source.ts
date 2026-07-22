import { canonicalizeGltfBuffers } from "./canonical-buffers";
import { parseGlb } from "./glb";
import {
  array,
  fail,
  nonNegativeInteger,
  object,
  type JsonObject,
} from "./gltf-values";
import { resolveAssetUri } from "./static-material";
import {
  planStaticGltfBufferRequests,
  type StaticGltfResourceRequest,
} from "./static-buffer-demand";

export type CanonicalStaticGltfSource = Readonly<{
  binary: Uint8Array;
  container: "glb" | "gltf";
  document: JsonObject;
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

const readExternalBuffer = async (
  value: unknown,
  bufferIndex: number,
  label: string,
  sourceUri: string,
  read: StaticGltfResourceReader,
  request?: StaticGltfResourceRequest,
): Promise<Uint8Array> => {
  const path = `buffers[${bufferIndex}]`;
  const buffer = object(value, label, path);
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
    const requests = planStaticGltfBufferRequests(document, label, sceneIndex, etc2Available);
    const external = await Promise.all(buffers.slice(1).map((value, offset) =>
      readExternalBuffer(
        value,
        offset + 1,
        label,
        sourceUri,
        read,
        requests[offset + 1],
      )));
    const canonical = canonicalizeGltfBuffers(
      document,
      [binaryChunk.subarray(0, firstLength), ...external],
      label,
    );
    return { ...canonical, container: "glb" };
  }

  const document = parseJsonDocument(bytes, label);
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length === 0) fail(label, "buffers", "must not be empty");
  const requests = planStaticGltfBufferRequests(document, label, sceneIndex, etc2Available);
  const sources = await Promise.all(buffers.map((value, bufferIndex) =>
    readExternalBuffer(
      value,
      bufferIndex,
      label,
      sourceUri,
      read,
      requests[bufferIndex],
    )));
  return {
    ...canonicalizeGltfBuffers(document, sources, label),
    container: "gltf",
  };
};

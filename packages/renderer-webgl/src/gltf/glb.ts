export type ParsedGlb = Readonly<{
  /** Zero-copy view over the optional GLB BIN chunk. */
  binaryChunk?: Uint8Array;
  /** Parsed JSON chunk. Semantic glTF validation is a separate stage. */
  document: unknown;
}>;

const GLB_MAGIC = 0x46_54_6c_67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e_4f_53_4a;
const BINARY_CHUNK = 0x00_4e_49_42;
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

const fail = (label: string, detail: string): never => {
  throw new Error(`${label}: ${detail}`);
};

const decodeJsonChunk = (chunk: Uint8Array, label: string): string => {
  try {
    return UTF8_DECODER.decode(chunk);
  } catch {
    return fail(label, "GLB JSON chunk is not valid UTF-8");
  }
};

/** Parses one GLB container without copying its binary payload or touching WebGL. */
export const parseGlb = (bytes: Uint8Array, label = "glTF binary"): ParsedGlb => {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError("Royal GLB input must be a Uint8Array");
  }
  if (bytes.byteLength < HEADER_BYTES) fail(label, "GLB header is truncated");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) fail(label, "GLB magic is invalid");
  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) fail(label, `GLB version ${version} is unsupported`);
  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== bytes.byteLength) {
    fail(label, `GLB length ${declaredLength} does not match ${bytes.byteLength} received bytes`);
  }

  let offset = HEADER_BYTES;
  let chunkIndex = 0;
  let document: unknown;
  let binaryChunk: Uint8Array | undefined;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < CHUNK_HEADER_BYTES) {
      fail(label, `GLB chunk ${chunkIndex} header is truncated`);
    }
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    offset += CHUNK_HEADER_BYTES;
    if (length % 4 !== 0) fail(label, `GLB chunk ${chunkIndex} length is not 4-byte aligned`);
    if (length > bytes.byteLength - offset) fail(label, `GLB chunk ${chunkIndex} exceeds its container`);
    const chunk = bytes.subarray(offset, offset + length);
    offset += length;

    if (chunkIndex === 0 && type !== JSON_CHUNK) {
      fail(label, "GLB first chunk must be JSON");
    }
    if (type === JSON_CHUNK) {
      if (chunkIndex !== 0 || document !== undefined) fail(label, "GLB contains an extra JSON chunk");
      const source = decodeJsonChunk(chunk, label);
      try {
        document = JSON.parse(source);
      } catch {
        fail(label, "GLB JSON chunk is not valid JSON");
      }
    } else if (type === BINARY_CHUNK) {
      if (chunkIndex !== 1) fail(label, "GLB BIN chunk must immediately follow JSON");
      if (binaryChunk !== undefined) fail(label, "GLB contains more than one BIN chunk");
      binaryChunk = chunk;
    }
    chunkIndex += 1;
  }
  if (document === undefined) fail(label, "GLB has no JSON chunk");
  return {
    ...(binaryChunk === undefined ? {} : { binaryChunk }),
    document,
  };
};

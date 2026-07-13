import type { GltfDocument } from "./schema";

export const abortError = (): DOMException => new DOMException("The operation was aborted", "AbortError");
export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw abortError();
};

export type GltfDocumentPayload = {
  readonly binaryChunk?: ArrayBuffer;
  readonly document: GltfDocument;
};

const GLB_MAGIC = 0x46546C67;
const GLB_VERSION = 2;
const GLB_CHUNK_JSON = 0x4E4F534A;
const GLB_CHUNK_BIN = 0x004E4942;

export const resolveResourceUri = (base: string, relative: string): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(relative)) return relative;
  const index = base.lastIndexOf("/");
  return `${index < 0 ? "" : base.slice(0, index + 1)}${relative}`;
};

const dataUriPattern = /^data:([^,]*?),(.*)$/isu;

const decodeBase64 = (value: string): string => {
  const decoder = globalThis.atob;
  if (typeof decoder !== "function") throw new Error("Base64 data URI decoding is unavailable");

  return decoder(value);
};

const bytesFromBinaryString = (value: string): Uint8Array => {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xFF;
  }

  return bytes;
};

const arrayBufferFromBytes = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return copy.buffer;
};

export const decodeDataUri = (uri: string): ArrayBuffer => {
  const match = dataUriPattern.exec(uri);
  if (match === null) throw new Error("Invalid data URI");

  const metadata = match[1] ?? "";
  const payload = match[2] ?? "";
  const bytes = metadata.split(";").some((part) => part.toLowerCase() === "base64")
    ? bytesFromBinaryString(decodeBase64(payload))
    : new TextEncoder().encode(decodeURIComponent(payload));

  return arrayBufferFromBytes(bytes);
};

export const dataUriMediaType = (uri: string): string => {
  const match = dataUriPattern.exec(uri);
  if (match === null) return "";
  const metadata = match[1] ?? "";
  const [mediaType = ""] = metadata.split(";");

  return mediaType.toLowerCase();
};

export const dataUriDecodedByteLength = (uri: string): number => {
  const match = dataUriPattern.exec(uri);
  if (match === null) throw new Error("Invalid data URI");
  const metadata = match[1] ?? "";
  const payload = match[2] ?? "";
  if (!metadata.split(";").some((part) => part.toLowerCase() === "base64")) {
    return new TextEncoder().encode(decodeURIComponent(payload)).byteLength;
  }
  const compact = payload.replace(/\s/gu, "");
  const padding = compact.endsWith("==") ? 2 : compact.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor(compact.length * 3 / 4) - padding;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new RangeError("Data URI decoded byte length exceeds safe integer capacity");
  }
  return byteLength;
};

const responseContentType = (response: Response): string =>
  ((response as { readonly headers?: Headers }).headers?.get("content-type") ?? "").toLowerCase();

const isGlbSource = (src: string, contentType = ""): boolean =>
  /\.glb(?:$|[?#])/iu.test(src)
  || contentType.includes("model/gltf-binary")
  || contentType.includes("model/gltf+binary");

const looksLikeGlb = (buffer: ArrayBuffer): boolean =>
  buffer.byteLength >= 12 && new DataView(buffer).getUint32(0, true) === GLB_MAGIC;

const trimGlbJsonPadding = (value: string): string => {
  let end = value.length;
  while (end > 0) {
    const code = value.charCodeAt(end - 1);
    if (code !== 0x00 && code !== 0x20) break;
    end -= 1;
  }

  return value.slice(0, end);
};

const parseJsonBytes = (buffer: ArrayBuffer): GltfDocument => {
  const text = trimGlbJsonPadding(new TextDecoder().decode(buffer));

  return JSON.parse(text) as GltfDocument;
};

const parseGlb = (buffer: ArrayBuffer): GltfDocumentPayload => {
  if (buffer.byteLength < 12) throw new Error("Invalid GLB header length");
  const header = new DataView(buffer, 0, 12);
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const length = header.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new Error("Invalid GLB magic");
  if (version !== GLB_VERSION) throw new Error(`Unsupported GLB version ${version}`);
  if (length !== buffer.byteLength) {
    throw new Error(`Invalid GLB length ${length}; received ${buffer.byteLength} bytes`);
  }

  let offset = 12;
  let chunkIndex = 0;
  let document: GltfDocument | undefined;
  let binaryChunk: ArrayBuffer | undefined;
  while (offset < length) {
    if (length - offset < 8) throw new Error("Invalid GLB trailing chunk header");
    const chunkHeader = new DataView(buffer, offset, 8);
    const chunkLength = chunkHeader.getUint32(0, true);
    const chunkType = chunkHeader.getUint32(4, true);
    if (chunkLength % 4 !== 0) throw new Error(`GLB chunk ${chunkIndex} length is not 4-byte aligned`);
    if (chunkIndex === 0 && chunkType !== GLB_CHUNK_JSON) {
      throw new Error("GLB JSON chunk must be first");
    }
    offset += 8;
    if (offset + chunkLength > length) throw new Error("Invalid GLB chunk length");
    const chunk = buffer.slice(offset, offset + chunkLength);
    offset += chunkLength;

    if (chunkType === GLB_CHUNK_JSON) {
      if (document !== undefined) throw new Error("GLB contains multiple JSON chunks");
      document = parseJsonBytes(chunk);
    } else if (chunkType === GLB_CHUNK_BIN) {
      if (binaryChunk !== undefined) throw new Error("GLB contains multiple BIN chunks");
      binaryChunk = chunk;
    }
    chunkIndex += 1;
  }

  if (document === undefined) throw new Error("GLB is missing a JSON chunk");

  return {
    ...(binaryChunk === undefined ? {} : { binaryChunk }),
    document,
  };
};

export const parseGltfDocumentBytes = (src: string, buffer: ArrayBuffer, contentType = ""): GltfDocumentPayload => {
  if (isGlbSource(src, contentType) || looksLikeGlb(buffer)) return parseGlb(buffer);

  return {
    document: parseJsonBytes(buffer),
  };
};

export const loadGltfDocument = async (src: string, signal?: AbortSignal): Promise<GltfDocumentPayload> => {
  throwIfAborted(signal);
  if (src.startsWith("data:")) {
    return parseGltfDocumentBytes(src, decodeDataUri(src), dataUriMediaType(src));
  }

  const response = await fetch(src, signal === undefined ? undefined : { signal });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = responseContentType(response);
  if (isGlbSource(src, contentType)) {
    return parseGltfDocumentBytes(src, await response.arrayBuffer(), contentType);
  }

  return {
    document: await response.json() as GltfDocument,
  };
};

const bufferSlice = (buffer: ArrayBuffer, byteLength: number | undefined, context: string): ArrayBuffer => {
  if (byteLength === undefined) return buffer;
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error(`${context} has invalid byteLength ${String(byteLength)}`);
  }
  if (byteLength > buffer.byteLength) {
    throw new Error(`${context} declares ${byteLength} bytes, but only ${buffer.byteLength} bytes are available`);
  }
  if (byteLength === buffer.byteLength) return buffer;

  return buffer.slice(0, byteLength);
};

const checkedBufferView = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  bufferViewIndex: number,
): { readonly buffer: ArrayBuffer; readonly byteLength: number; readonly byteOffset: number } => {
  const context = `glTF bufferView ${bufferViewIndex}`;
  const bufferView = document.bufferViews?.[bufferViewIndex];
  if (bufferView === undefined) throw new Error(`${context} does not exist`);
  const bufferIndex = bufferView.buffer ?? 0;
  const buffer = buffers[bufferIndex];
  if (buffer === undefined) throw new Error(`${context} references missing buffer ${bufferIndex}`);
  const byteOffset = bufferView.byteOffset ?? 0;
  const { byteLength } = bufferView;
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0) {
    throw new Error(`${context} has invalid byteOffset ${String(byteOffset)}`);
  }
  if (!Number.isSafeInteger(byteLength) || byteLength < 0) {
    throw new Error(`${context} has invalid byteLength ${String(byteLength)}`);
  }
  if (byteOffset > buffer.byteLength || byteLength > buffer.byteLength - byteOffset) {
    throw new Error(
      `${context} range [${byteOffset}, ${byteOffset + byteLength}) exceeds buffer ${bufferIndex} byteLength ${buffer.byteLength}`,
    );
  }

  return { buffer, byteLength, byteOffset };
};

export const gltfBufferViewBytes = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  bufferViewIndex: number,
): ArrayBuffer => {
  const { buffer, byteLength, byteOffset } = checkedBufferView(document, buffers, bufferViewIndex);

  return buffer.slice(byteOffset, byteOffset + byteLength);
};

export const loadGltfBuffers = async (
  src: string,
  document: GltfDocument,
  binaryChunk: ArrayBuffer | undefined,
  signal?: AbortSignal,
): Promise<readonly ArrayBuffer[]> =>
  Promise.all((document.buffers ?? []).map(async (buffer, index) => {
    throwIfAborted(signal);
    const context = `glTF asset ${JSON.stringify(src)} buffer ${index}`;
    if (buffer.uri === undefined) {
      if (index === 0 && binaryChunk !== undefined) return bufferSlice(binaryChunk, buffer.byteLength, context);
      const targetBufferViews = document.bufferViews?.filter((bufferView) => (bufferView.buffer ?? 0) === index) ?? [];
      const requiredExtensions = new Set(document.extensionsRequired ?? []);
      const meshoptDecodeTarget = targetBufferViews.length > 0 && targetBufferViews.every((bufferView) =>
        (bufferView.extensions?.EXT_meshopt_compression !== undefined
          && requiredExtensions.has("EXT_meshopt_compression"))
        || (bufferView.extensions?.KHR_meshopt_compression !== undefined
          && requiredExtensions.has("KHR_meshopt_compression")));
      if (meshoptDecodeTarget === true && buffer.byteLength !== undefined) {
        if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0) {
          throw new Error(`${context} has invalid byteLength ${String(buffer.byteLength)}`);
        }

        // Required meshopt assets may omit the URI of a decode-only fallback buffer.
        return new ArrayBuffer(buffer.byteLength);
      }

      throw new Error(`${context} has no URI and no GLB binary chunk`);
    }
    if (buffer.uri.startsWith("data:")) return bufferSlice(decodeDataUri(buffer.uri), buffer.byteLength, context);

    const bufferResponse = await fetch(
      resolveResourceUri(src, buffer.uri),
      signal === undefined ? undefined : { signal },
    );
    if (!bufferResponse.ok) {
      throw new Error(`${context} failed to load: ${bufferResponse.status} ${bufferResponse.statusText}`);
    }

    const bytes = await bufferResponse.arrayBuffer();
    throwIfAborted(signal);
    return bufferSlice(bytes, buffer.byteLength, context);
  }));

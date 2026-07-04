import type { GltfDocument } from "./schema";

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
  const header = new DataView(buffer, 0, 12);
  const magic = header.getUint32(0, true);
  const version = header.getUint32(4, true);
  const length = header.getUint32(8, true);
  if (magic !== GLB_MAGIC) throw new Error("Invalid GLB magic");
  if (version !== GLB_VERSION) throw new Error(`Unsupported GLB version ${version}`);
  if (length > buffer.byteLength) throw new Error("Invalid GLB length");

  let offset = 12;
  let document: GltfDocument | undefined;
  let binaryChunk: ArrayBuffer | undefined;
  while (offset + 8 <= length) {
    const chunkHeader = new DataView(buffer, offset, 8);
    const chunkLength = chunkHeader.getUint32(0, true);
    const chunkType = chunkHeader.getUint32(4, true);
    offset += 8;
    if (offset + chunkLength > length) throw new Error("Invalid GLB chunk length");
    const chunk = buffer.slice(offset, offset + chunkLength);
    offset += chunkLength;

    if (chunkType === GLB_CHUNK_JSON) {
      document = parseJsonBytes(chunk);
      continue;
    }
    if (chunkType === GLB_CHUNK_BIN && binaryChunk === undefined) {
      binaryChunk = chunk;
    }
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

export const loadGltfDocument = async (src: string): Promise<GltfDocumentPayload> => {
  if (src.startsWith("data:")) {
    return parseGltfDocumentBytes(src, decodeDataUri(src), dataUriMediaType(src));
  }

  const response = await fetch(src);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const contentType = responseContentType(response);
  if (isGlbSource(src, contentType)) {
    return parseGltfDocumentBytes(src, await response.arrayBuffer(), contentType);
  }

  return {
    document: await response.json() as GltfDocument,
  };
};

const bufferSlice = (buffer: ArrayBuffer, byteLength: number | undefined): ArrayBuffer => {
  if (byteLength === undefined || byteLength >= buffer.byteLength) return buffer.slice(0);

  return buffer.slice(0, byteLength);
};

export const gltfBufferViewBytes = (
  document: GltfDocument,
  buffers: readonly ArrayBuffer[],
  bufferViewIndex: number,
): ArrayBuffer => {
  const bufferView = document.bufferViews?.[bufferViewIndex];
  if (bufferView === undefined) return new ArrayBuffer(0);
  const buffer = buffers[bufferView.buffer ?? 0];
  if (buffer === undefined) return new ArrayBuffer(0);
  const offset = bufferView.byteOffset ?? 0;

  return buffer.slice(offset, offset + bufferView.byteLength);
};

export const loadGltfBuffers = async (
  src: string,
  document: GltfDocument,
  binaryChunk: ArrayBuffer | undefined,
): Promise<readonly ArrayBuffer[]> =>
  Promise.all((document.buffers ?? []).map(async (buffer, index) => {
    if (buffer.uri === undefined) {
      if (index === 0 && binaryChunk !== undefined) return bufferSlice(binaryChunk, buffer.byteLength);

      return new ArrayBuffer(0);
    }
    if (buffer.uri.startsWith("data:")) return bufferSlice(decodeDataUri(buffer.uri), buffer.byteLength);

    const bufferResponse = await fetch(resolveResourceUri(src, buffer.uri));
    if (!bufferResponse.ok) throw new Error(`${bufferResponse.status} ${bufferResponse.statusText}`);

    return bufferSlice(await bufferResponse.arrayBuffer(), buffer.byteLength);
  }));

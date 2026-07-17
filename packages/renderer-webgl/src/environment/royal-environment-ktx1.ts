export const ROYAL_ENVIRONMENT_METADATA_KEY = "royal.environment.v1";

const KTX1_IDENTIFIER = new Uint8Array([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const KTX1_HEADER_BYTES = 64;
const KTX1_LITTLE_ENDIAN = 0x04030201;
const GL_UNSIGNED_INT_10F_11F_11F_REV = 0x8c3b;
const GL_R11F_G11F_B10F = 0x8c3a;
const GL_RGB = 0x1907;
const ROYAL_ENVIRONMENT_MAX_SIZE = 256;
const ROYAL_ENVIRONMENT_MAX_METADATA_BYTES = 64 * 1024;
const ROYAL_ENVIRONMENT_MAX_METADATA_ENTRIES = 32;
const ROYAL_ENVIRONMENT_MAX_KEY_BYTES = 256;
const ROYAL_ENVIRONMENT_MAX_PROVENANCE_BYTES = 2048;
const ROYAL_ENVIRONMENT_MAX_ARTIFACT_BYTES = 64
  + ROYAL_ENVIRONMENT_MAX_METADATA_BYTES
  + 9 * 4
  + 6 * 4 * 87_381;

export type RoyalEnvironmentArtifactErrorCode =
  | "endianness"
  | "format"
  | "identifier"
  | "metadata"
  | "mipmap"
  | "padding"
  | "shape"
  | "trailing-data"
  | "truncated";

export class RoyalEnvironmentArtifactError extends Error {
  readonly code: RoyalEnvironmentArtifactErrorCode;

  constructor(code: RoyalEnvironmentArtifactErrorCode, message: string) {
    super(message);
    this.name = "RoyalEnvironmentArtifactError";
    this.code = code;
  }
}

export type RoyalEnvironmentFace = 0 | 1 | 2 | 3 | 4 | 5;

export type PreparedRoyalEnvironmentFace = {
  readonly byteLength: number;
  readonly byteOffset: number;
  readonly face: RoyalEnvironmentFace;
};

export type PreparedRoyalEnvironmentLevel = {
  readonly faces: readonly [
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
  ];
  readonly imageSize: number;
  readonly level: number;
  readonly size: number;
};

export type RoyalEnvironmentMetadata = {
  readonly provenance: string;
  readonly sh: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ];
  readonly version: 1;
};

export type PreparedRoyalEnvironment = {
  readonly levels: readonly PreparedRoyalEnvironmentLevel[];
  readonly metadata: RoyalEnvironmentMetadata;
  readonly size: number;
  /** Retained source storage borrowed by every face byte range. */
  readonly source: ArrayBuffer;
};

const artifactError = (
  code: RoyalEnvironmentArtifactErrorCode,
  message: string,
): never => {
  throw new RoyalEnvironmentArtifactError(code, message);
};

const requireBytes = (byteLength: number, offset: number, count: number): void => {
  if (offset < 0 || count < 0 || offset > byteLength || count > byteLength - offset) {
    artifactError("truncated", "Royal environment artifact is truncated");
  }
};

const align4 = (value: number): number => (value + 3) & ~3;

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return artifactError("metadata", "Royal environment metadata must be valid UTF-8");
  }
};

const finiteRgb = (value: unknown): readonly [number, number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  if (value.some((component) => (
    typeof component !== "number"
    || !Number.isFinite(component)
    || !Number.isFinite(Math.fround(component))
  ))) return undefined;
  return Object.freeze([value[0] as number, value[1] as number, value[2] as number]);
};

const parseRoyalMetadata = (bytes: Uint8Array): RoyalEnvironmentMetadata => {
  const valueBytes = bytes.length > 0 && bytes[bytes.length - 1] === 0
    ? bytes.subarray(0, bytes.length - 1)
    : bytes;
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(valueBytes));
  } catch (error) {
    if (error instanceof RoyalEnvironmentArtifactError) throw error;
    return artifactError("metadata", "Royal environment metadata must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return artifactError("metadata", "Royal environment metadata must be an object");
  }
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return artifactError("metadata", "Royal environment metadata version must equal 1");
  if (typeof row.provenance !== "string" || row.provenance.length === 0) {
    return artifactError("metadata", "Royal environment provenance must be a non-empty string");
  }
  if (new TextEncoder().encode(row.provenance).byteLength > ROYAL_ENVIRONMENT_MAX_PROVENANCE_BYTES) {
    return artifactError("metadata", "Royal environment provenance exceeds the profile limit");
  }
  if (!Array.isArray(row.sh) || row.sh.length !== 9) {
    return artifactError("metadata", "Royal environment metadata requires 9 RGB SH coefficients");
  }
  const coefficients = row.sh.map(finiteRgb);
  if (coefficients.some((coefficient) => coefficient === undefined)) {
    return artifactError("metadata", "Royal environment RGB SH coefficients must be finite triples");
  }
  return Object.freeze({
    provenance: row.provenance,
    sh: Object.freeze(coefficients) as RoyalEnvironmentMetadata["sh"],
    version: 1,
  });
};

const parseMetadata = (
  source: ArrayBuffer,
  view: DataView,
  byteLength: number,
  start: number,
  metadataBytes: number,
): RoyalEnvironmentMetadata => {
  if (metadataBytes > ROYAL_ENVIRONMENT_MAX_METADATA_BYTES) {
    return artifactError("metadata", "Royal environment metadata exceeds the profile limit");
  }
  requireBytes(byteLength, start, metadataBytes);
  const end = start + metadataBytes;
  let offset = start;
  let entries = 0;
  let royalMetadata: RoyalEnvironmentMetadata | undefined;
  while (offset < end) {
    entries += 1;
    if (entries > ROYAL_ENVIRONMENT_MAX_METADATA_ENTRIES) {
      return artifactError("metadata", "Royal environment artifact has too many metadata entries");
    }
    requireBytes(end, offset, 4);
    const keyAndValueBytes = view.getUint32(offset, true);
    offset += 4;
    requireBytes(end, offset, keyAndValueBytes);
    const pairEnd = offset + keyAndValueBytes;
    const pair = new Uint8Array(source, offset, keyAndValueBytes);
    const keyEnd = pair.indexOf(0);
    if (keyEnd < 1 || keyEnd > ROYAL_ENVIRONMENT_MAX_KEY_BYTES) {
      return artifactError("metadata", "Royal environment metadata key is invalid");
    }
    const key = decodeUtf8(pair.subarray(0, keyEnd));
    if (key === ROYAL_ENVIRONMENT_METADATA_KEY) {
      if (royalMetadata !== undefined) {
        return artifactError("metadata", "Royal environment metadata key must be unique");
      }
      royalMetadata = parseRoyalMetadata(pair.subarray(keyEnd + 1));
    }
    offset = pairEnd;
    const paddedOffset = align4(offset);
    requireBytes(end, offset, paddedOffset - offset);
    for (let index = offset; index < paddedOffset; index += 1) {
      if (view.getUint8(index) !== 0) {
        return artifactError("padding", "Royal environment metadata padding must be zero");
      }
    }
    offset = paddedOffset;
  }
  if (offset !== end) return artifactError("metadata", "Royal environment metadata length is invalid");
  if (royalMetadata === undefined) {
    return artifactError("metadata", `Royal environment metadata key ${ROYAL_ENVIRONMENT_METADATA_KEY} is required`);
  }
  return royalMetadata;
};

const frozenFaces = (
  faces: PreparedRoyalEnvironmentFace[],
): PreparedRoyalEnvironmentLevel["faces"] => {
  if (faces.length !== 6) return artifactError("shape", "Royal environment cubemap requires six faces");
  return Object.freeze(faces) as PreparedRoyalEnvironmentLevel["faces"];
};

/** Strict parser for Royal's pinned offline cmgen-compatible KTX1 artifact. */
export const parseRoyalEnvironmentKtx1 = (source: ArrayBuffer): PreparedRoyalEnvironment => {
  const byteLength = source.byteLength;
  if (byteLength > ROYAL_ENVIRONMENT_MAX_ARTIFACT_BYTES) {
    return artifactError("shape", "Royal environment artifact exceeds the profile size limit");
  }
  requireBytes(byteLength, 0, KTX1_HEADER_BYTES);
  const bytes = new Uint8Array(source);
  for (let index = 0; index < KTX1_IDENTIFIER.length; index += 1) {
    if (bytes[index] !== KTX1_IDENTIFIER[index]) {
      return artifactError("identifier", "Royal environment artifact must be KTX 1");
    }
  }
  const view = new DataView(source);
  if (view.getUint32(12, true) !== KTX1_LITTLE_ENDIAN) {
    return artifactError("endianness", "Royal environment KTX 1 must be little-endian");
  }
  if (
    view.getUint32(16, true) !== GL_UNSIGNED_INT_10F_11F_11F_REV
    || view.getUint32(20, true) !== 4
    || view.getUint32(24, true) !== GL_RGB
    || view.getUint32(28, true) !== GL_R11F_G11F_B10F
    || view.getUint32(32, true) !== GL_RGB
  ) {
    return artifactError("format", "Royal environment KTX 1 must use packed R11F_G11F_B10F RGB");
  }
  const width = view.getUint32(36, true);
  const height = view.getUint32(40, true);
  const depth = view.getUint32(44, true);
  const arrayElements = view.getUint32(48, true);
  const faces = view.getUint32(52, true);
  const mipLevels = view.getUint32(56, true);
  const metadataBytes = view.getUint32(60, true);
  if (
    width < 1
    || width > ROYAL_ENVIRONMENT_MAX_SIZE
    || (width & (width - 1)) !== 0
    || height !== width
  ) {
    return artifactError("shape", "Royal environment cubemap faces must be square powers of two at most 256 pixels");
  }
  if (depth !== 0 || arrayElements !== 0 || faces !== 6) {
    return artifactError("shape", "Royal environment artifact must be one non-array cubemap");
  }
  const expectedMipLevels = Math.floor(Math.log2(width)) + 1;
  if (mipLevels !== expectedMipLevels) {
    return artifactError("mipmap", "Royal environment artifact requires a complete mip pyramid");
  }

  const metadata = parseMetadata(source, view, byteLength, KTX1_HEADER_BYTES, metadataBytes);
  let offset = KTX1_HEADER_BYTES + metadataBytes;
  const levels: PreparedRoyalEnvironmentLevel[] = [];
  for (let level = 0; level < mipLevels; level += 1) {
    requireBytes(byteLength, offset, 4);
    const imageSize = view.getUint32(offset, true);
    offset += 4;
    const size = Math.max(1, Math.floor(width / 2 ** level));
    const expectedImageSize = size * size * 4;
    if (imageSize !== expectedImageSize) {
      return artifactError("mipmap", "Royal environment mip face byte size is invalid");
    }
    const levelFaces: PreparedRoyalEnvironmentFace[] = [];
    for (let face = 0; face < 6; face += 1) {
      requireBytes(byteLength, offset, imageSize);
      levelFaces.push(Object.freeze({
        byteLength: imageSize,
        byteOffset: offset,
        face: face as RoyalEnvironmentFace,
      }));
      offset += imageSize;
      const paddedOffset = align4(offset);
      requireBytes(byteLength, offset, paddedOffset - offset);
      for (let index = offset; index < paddedOffset; index += 1) {
        if (view.getUint8(index) !== 0) {
          return artifactError("padding", "Royal environment cubemap padding must be zero");
        }
      }
      offset = paddedOffset;
    }
    const paddedOffset = align4(offset);
    requireBytes(byteLength, offset, paddedOffset - offset);
    for (let index = offset; index < paddedOffset; index += 1) {
      if (view.getUint8(index) !== 0) {
        return artifactError("padding", "Royal environment mip padding must be zero");
      }
    }
    offset = paddedOffset;
    levels.push(Object.freeze({
      faces: frozenFaces(levelFaces),
      imageSize,
      level,
      size,
    }));
  }
  if (offset !== byteLength) {
    return artifactError("trailing-data", "Royal environment artifact has trailing data");
  }
  return Object.freeze({
    levels: Object.freeze(levels),
    metadata,
    size: width,
    source,
  });
};

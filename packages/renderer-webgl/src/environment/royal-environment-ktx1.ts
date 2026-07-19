export const ROYAL_ENVIRONMENT_METADATA_KEY = "royal.environment.v1";

const IDENTIFIER = new Uint8Array([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const HEADER_BYTES = 64;
const LITTLE_ENDIAN = 0x0403_0201;
const UNSIGNED_INT_10F_11F_11F_REV = 0x8c3b;
const R11F_G11F_B10F = 0x8c3a;
const RGB = 0x1907;
const MAX_SIZE = 256;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_METADATA_ENTRIES = 32;
const MAX_KEY_BYTES = 256;
const MAX_PROVENANCE_BYTES = 2048;
const MAX_ARTIFACT_BYTES = HEADER_BYTES + MAX_METADATA_BYTES + 9 * 4 + 6 * 4 * 87_381;

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

export type PreparedRoyalEnvironmentFace = Readonly<{
  byteLength: number;
  byteOffset: number;
  face: RoyalEnvironmentFace;
}>;

export type PreparedRoyalEnvironmentLevel = Readonly<{
  faces: readonly [
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
    PreparedRoyalEnvironmentFace,
  ];
  level: number;
  size: number;
}>;

export type RoyalEnvironmentMetadata = Readonly<{
  provenance: string;
  sh: readonly [
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
  version: 1;
}>;

export type PreparedRoyalEnvironment = Readonly<{
  levels: readonly PreparedRoyalEnvironmentLevel[];
  metadata: RoyalEnvironmentMetadata;
  size: number;
  /** Retained source storage borrowed by every face byte range. */
  source: ArrayBuffer;
}>;

const fail = (code: RoyalEnvironmentArtifactErrorCode, message: string): never => {
  throw new RoyalEnvironmentArtifactError(code, message);
};

const requireBytes = (length: number, offset: number, count: number): void => {
  if (offset < 0 || count < 0 || offset > length || count > length - offset) {
    fail("truncated", "Royal environment artifact is truncated");
  }
};

const align4 = (value: number): number => (value + 3) & ~3;

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("metadata", "Royal environment metadata must be valid UTF-8");
  }
};

const rgb = (value: unknown): readonly [number, number, number] | undefined => {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  if (value.some((component) => (
    typeof component !== "number"
    || !Number.isFinite(component)
    || !Number.isFinite(Math.fround(component))
  ))) return undefined;
  return [value[0] as number, value[1] as number, value[2] as number];
};

const parseRoyalMetadata = (bytes: Uint8Array): RoyalEnvironmentMetadata => {
  const content = bytes.length > 0 && bytes[bytes.length - 1] === 0
    ? bytes.subarray(0, bytes.length - 1)
    : bytes;
  let value: unknown;
  try {
    value = JSON.parse(decodeUtf8(content));
  } catch (error) {
    if (error instanceof RoyalEnvironmentArtifactError) throw error;
    return fail("metadata", "Royal environment metadata must be valid JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("metadata", "Royal environment metadata must be an object");
  }
  const record = value as Record<string, unknown>;
  if (record.version !== 1) {
    return fail("metadata", "Royal environment metadata version must equal 1");
  }
  if (typeof record.provenance !== "string" || record.provenance.length === 0) {
    return fail("metadata", "Royal environment provenance must be a non-empty string");
  }
  if (new TextEncoder().encode(record.provenance).byteLength > MAX_PROVENANCE_BYTES) {
    return fail("metadata", "Royal environment provenance exceeds the profile limit");
  }
  if (!Array.isArray(record.sh) || record.sh.length !== 9) {
    return fail("metadata", "Royal environment metadata requires 9 RGB SH coefficients");
  }
  const coefficients = record.sh.map(rgb);
  if (coefficients.some((coefficient) => coefficient === undefined)) {
    return fail("metadata", "Royal environment RGB SH coefficients must be finite triples");
  }
  return {
    provenance: record.provenance,
    sh: coefficients as unknown as RoyalEnvironmentMetadata["sh"],
    version: 1,
  };
};

const parseMetadata = (
  source: ArrayBuffer,
  view: DataView,
  start: number,
  length: number,
): RoyalEnvironmentMetadata => {
  if (length > MAX_METADATA_BYTES) {
    return fail("metadata", "Royal environment metadata exceeds the profile limit");
  }
  requireBytes(source.byteLength, start, length);
  const end = start + length;
  let offset = start;
  let entries = 0;
  let metadata: RoyalEnvironmentMetadata | undefined;
  while (offset < end) {
    entries += 1;
    if (entries > MAX_METADATA_ENTRIES) {
      return fail("metadata", "Royal environment artifact has too many metadata entries");
    }
    requireBytes(end, offset, 4);
    const pairLength = view.getUint32(offset, true);
    offset += 4;
    requireBytes(end, offset, pairLength);
    const pairEnd = offset + pairLength;
    const pair = new Uint8Array(source, offset, pairLength);
    const keyEnd = pair.indexOf(0);
    if (keyEnd < 1 || keyEnd > MAX_KEY_BYTES) {
      return fail("metadata", "Royal environment metadata key is invalid");
    }
    const key = decodeUtf8(pair.subarray(0, keyEnd));
    if (key === ROYAL_ENVIRONMENT_METADATA_KEY) {
      if (metadata !== undefined) {
        return fail("metadata", "Royal environment metadata key must be unique");
      }
      metadata = parseRoyalMetadata(pair.subarray(keyEnd + 1));
    }
    offset = pairEnd;
    const aligned = align4(offset);
    requireBytes(end, offset, aligned - offset);
    for (; offset < aligned; offset += 1) {
      if (view.getUint8(offset) !== 0) {
        return fail("padding", "Royal environment metadata padding must be zero");
      }
    }
  }
  if (offset !== end) return fail("metadata", "Royal environment metadata length is invalid");
  return metadata ?? fail(
    "metadata",
    `Royal environment metadata key ${ROYAL_ENVIRONMENT_METADATA_KEY} is required`,
  );
};

/** Strict pure parser for Royal's pinned offline cmgen-compatible KTX1 artifact. */
export const parseRoyalEnvironmentKtx1 = (source: ArrayBuffer): PreparedRoyalEnvironment => {
  const length = source.byteLength;
  if (length > MAX_ARTIFACT_BYTES) {
    return fail("shape", "Royal environment artifact exceeds the profile size limit");
  }
  requireBytes(length, 0, HEADER_BYTES);
  const bytes = new Uint8Array(source);
  for (let index = 0; index < IDENTIFIER.length; index += 1) {
    if (bytes[index] !== IDENTIFIER[index]) {
      return fail("identifier", "Royal environment artifact must be KTX 1");
    }
  }
  const view = new DataView(source);
  if (view.getUint32(12, true) !== LITTLE_ENDIAN) {
    return fail("endianness", "Royal environment KTX 1 must be little-endian");
  }
  if (
    view.getUint32(16, true) !== UNSIGNED_INT_10F_11F_11F_REV
    || view.getUint32(20, true) !== 4
    || view.getUint32(24, true) !== RGB
    || view.getUint32(28, true) !== R11F_G11F_B10F
    || view.getUint32(32, true) !== RGB
  ) return fail("format", "Royal environment KTX 1 must use packed R11F_G11F_B10F RGB");
  const width = view.getUint32(36, true);
  const height = view.getUint32(40, true);
  const mipLevels = view.getUint32(56, true);
  if (width < 1 || width > MAX_SIZE || (width & (width - 1)) !== 0 || height !== width) {
    return fail(
      "shape",
      "Royal environment cubemap faces must be square powers of two at most 256 pixels",
    );
  }
  if (
    view.getUint32(44, true) !== 0
    || view.getUint32(48, true) !== 0
    || view.getUint32(52, true) !== 6
  ) return fail("shape", "Royal environment artifact must be one non-array cubemap");
  if (mipLevels !== Math.log2(width) + 1) {
    return fail("mipmap", "Royal environment artifact requires a complete mip pyramid");
  }

  const metadataLength = view.getUint32(60, true);
  const metadata = parseMetadata(source, view, HEADER_BYTES, metadataLength);
  let offset = HEADER_BYTES + metadataLength;
  const levels: PreparedRoyalEnvironmentLevel[] = [];
  for (let level = 0; level < mipLevels; level += 1) {
    requireBytes(length, offset, 4);
    const imageSize = view.getUint32(offset, true);
    offset += 4;
    const size = Math.max(1, width / 2 ** level);
    if (imageSize !== size * size * 4) {
      return fail("mipmap", "Royal environment mip face byte size is invalid");
    }
    const faces: PreparedRoyalEnvironmentFace[] = [];
    for (let face = 0; face < 6; face += 1) {
      requireBytes(length, offset, imageSize);
      faces.push({ byteLength: imageSize, byteOffset: offset, face: face as RoyalEnvironmentFace });
      offset += imageSize;
      const aligned = align4(offset);
      requireBytes(length, offset, aligned - offset);
      for (; offset < aligned; offset += 1) {
        if (view.getUint8(offset) !== 0) {
          return fail("padding", "Royal environment cubemap padding must be zero");
        }
      }
    }
    levels.push({
      faces: faces as unknown as PreparedRoyalEnvironmentLevel["faces"],
      level,
      size,
    });
  }
  if (offset !== length) {
    return fail("trailing-data", "Royal environment artifact has trailing data");
  }
  return { levels, metadata, size: width, source };
};

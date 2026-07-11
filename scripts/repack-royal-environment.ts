import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const IDENTIFIER = new Uint8Array([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const HEADER_BYTES = 64;
const LITTLE_ENDIAN = 0x04030201;
const RGB = 0x1907;
const R11F_G11F_B10F = 0x8c3a;
const UNSIGNED_INT_10F_11F_11F_REV = 0x8c3b;
const SIZE = 256;
const FACES = 6;
const MIP_LEVELS = 9;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_PROVENANCE_BYTES = 2048;
const SH_KEY = "sh";
const ROYAL_KEY = "royal.environment.v1";
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export class RoyalEnvironmentRepackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoyalEnvironmentRepackError";
  }
}

const fail = (message: string): never => {
  throw new RoyalEnvironmentRepackError(message);
};

const requireBytes = (length: number, offset: number, count: number): void => {
  if (offset < 0 || count < 0 || offset > length || count > length - offset) {
    fail("Native cmgen KTX1 is truncated");
  }
};

const align4 = (value: number): number => (value + 3) & ~3;

const decodeUtf8 = (value: Uint8Array): string => {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    return fail("Native cmgen metadata must be valid UTF-8");
  }
};

const parseSh = (value: Uint8Array): readonly (readonly [number, number, number])[] => {
  const text = decodeUtf8(value).trim();
  const tokens = text.length === 0 ? [] : text.split(/\s+/u);
  if (tokens.length !== 27) fail("Native cmgen metadata must contain exactly 27 SH numbers");
  const numbers = tokens.map((token) => {
    if (!NUMBER.test(token)) fail("Native cmgen SH metadata contains an invalid number");
    const number = Number(token);
    if (!Number.isFinite(number) || !Number.isFinite(Math.fround(number))) {
      fail("Native cmgen SH metadata contains a non-Float32-finite number");
    }
    return number;
  });
  return Object.freeze(Array.from({ length: 9 }, (_unused, index) => Object.freeze([
    numbers[index * 3]!,
    numbers[index * 3 + 1]!,
    numbers[index * 3 + 2]!,
  ] as const)));
};

type NativePayload = {
  readonly payloadOffset: number;
  readonly sh: readonly (readonly [number, number, number])[];
};

const requireSh = (
  sh: NativePayload["sh"] | undefined,
): NativePayload["sh"] => sh ?? fail("Native cmgen KTX1 requires exactly one sh metadata entry");

const validateNativeCmgenKtx1 = (source: ArrayBuffer): NativePayload => {
  const length = source.byteLength;
  requireBytes(length, 0, HEADER_BYTES);
  const bytes = new Uint8Array(source);
  for (let index = 0; index < IDENTIFIER.length; index += 1) {
    if (bytes[index] !== IDENTIFIER[index]) fail("Input must be a native cmgen KTX1 artifact");
  }
  const view = new DataView(source);
  if (view.getUint32(12, true) !== LITTLE_ENDIAN) fail("Native cmgen KTX1 must be little-endian");
  if (
    view.getUint32(16, true) !== R11F_G11F_B10F
    || view.getUint32(20, true) !== 1
    || view.getUint32(24, true) !== RGB
    || view.getUint32(28, true) !== R11F_G11F_B10F
    || view.getUint32(32, true) !== R11F_G11F_B10F
  ) {
    fail("Native cmgen KTX1 packed RGB header is unsupported");
  }
  if (
    view.getUint32(36, true) !== SIZE
    || view.getUint32(40, true) !== SIZE
    || view.getUint32(44, true) !== 0
    || view.getUint32(48, true) !== 0
    || view.getUint32(52, true) !== FACES
    || view.getUint32(56, true) !== MIP_LEVELS
  ) {
    fail("Native cmgen KTX1 must be one 256px cubemap with nine mip levels");
  }

  const metadataBytes = view.getUint32(60, true);
  if (metadataBytes > MAX_METADATA_BYTES) fail("Native cmgen metadata exceeds the profile limit");
  requireBytes(length, HEADER_BYTES, metadataBytes);
  const metadataEnd = HEADER_BYTES + metadataBytes;
  let offset = HEADER_BYTES;
  let sh: readonly (readonly [number, number, number])[] | undefined;
  let entries = 0;
  while (offset < metadataEnd) {
    entries += 1;
    if (entries > 32) fail("Native cmgen KTX1 has too many metadata entries");
    requireBytes(metadataEnd, offset, 4);
    const pairBytes = view.getUint32(offset, true);
    offset += 4;
    requireBytes(metadataEnd, offset, pairBytes);
    const pair = new Uint8Array(source, offset, pairBytes);
    const keyEnd = pair.indexOf(0);
    if (keyEnd < 1) fail("Native cmgen KTX1 has an invalid metadata key");
    const key = decodeUtf8(pair.subarray(0, keyEnd));
    if (key !== SH_KEY || sh !== undefined) {
      fail("Native cmgen KTX1 must contain exactly one sh metadata entry");
    }
    sh = parseSh(pair.subarray(keyEnd + 1));
    offset += pairBytes;
    const paddedOffset = align4(offset);
    requireBytes(metadataEnd, offset, paddedOffset - offset);
    for (let index = offset; index < paddedOffset; index += 1) {
      if (bytes[index] !== 0) fail("Native cmgen metadata padding must be zero");
    }
    offset = paddedOffset;
  }
  if (offset !== metadataEnd || entries !== 1) {
    fail("Native cmgen KTX1 requires exactly one sh metadata entry");
  }
  const parsedSh = requireSh(sh);

  const payloadOffset = metadataEnd;
  offset = payloadOffset;
  for (let level = 0; level < MIP_LEVELS; level += 1) {
    requireBytes(length, offset, 4);
    const imageSize = view.getUint32(offset, true);
    offset += 4;
    const dimension = SIZE >> level;
    const expectedImageSize = dimension * dimension * 4;
    if (imageSize !== expectedImageSize) fail("Native cmgen KTX1 has an invalid mip face size");
    requireBytes(length, offset, imageSize * FACES);
    offset += imageSize * FACES;
  }
  if (offset !== length) fail("Native cmgen KTX1 has trailing data");
  return Object.freeze({ payloadOffset, sh: parsedSh });
};

const metadataPair = (provenance: string, sh: NativePayload["sh"]): Uint8Array => {
  if (provenance.length === 0) fail("Royal provenance must be non-empty");
  const encoder = new TextEncoder();
  if (encoder.encode(provenance).byteLength > MAX_PROVENANCE_BYTES) {
    fail("Royal provenance exceeds 2048 UTF-8 bytes");
  }
  const key = encoder.encode(ROYAL_KEY);
  const value = encoder.encode(JSON.stringify({ version: 1, provenance, sh }));
  const pairBytes = key.byteLength + 1 + value.byteLength;
  const output = new Uint8Array(4 + align4(pairBytes));
  new DataView(output.buffer).setUint32(0, pairBytes, true);
  output.set(key, 4);
  output[4 + key.byteLength] = 0;
  output.set(value, 4 + key.byteLength + 1);
  return output;
};

export const repackRoyalEnvironmentKtx1 = (
  source: ArrayBuffer,
  provenance: string,
): ArrayBuffer => {
  const native = validateNativeCmgenKtx1(source);
  const metadata = metadataPair(provenance, native.sh);
  const payload = new Uint8Array(source, native.payloadOffset);
  const output = new ArrayBuffer(HEADER_BYTES + metadata.byteLength + payload.byteLength);
  const bytes = new Uint8Array(output);
  bytes.set(new Uint8Array(source, 0, HEADER_BYTES), 0);
  const view = new DataView(output);
  view.setUint32(16, UNSIGNED_INT_10F_11F_11F_REV, true);
  view.setUint32(20, 4, true);
  view.setUint32(32, RGB, true);
  view.setUint32(60, metadata.byteLength, true);
  bytes.set(metadata, HEADER_BYTES);
  bytes.set(payload, HEADER_BYTES + metadata.byteLength);
  return output;
};

const HELP = `Usage:
  node scripts/repack-royal-environment.ts --input <cmgen.ktx> --output <royal.ktx> --provenance <text>

Pinned generation inputs must be recorded before use: official Filament cmgen version and
binary SHA-256, source URL/license/author/byte length/SHA-256, and normalized arguments.
Generate the native input with:
  cmgen --format=ktx --size=256 --ibl-min-lod-size=1 --ibl-samples=1024 \\
    --ibl-ld=<out-dir> --sh=3 --sh-irradiance <source.hdr>

The provenance text must explicitly carry those real, computed values. The final artifact
SHA-256 belongs in the repository asset manifest, not inside the self-hashed artifact.
`;

const option = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

const requiredOption = (name: string): string => option(name) ?? fail(HELP);

const main = async (): Promise<void> => {
  if (process.argv.includes("--help")) {
    process.stdout.write(HELP);
    return;
  }
  const input = requiredOption("--input");
  const output = requiredOption("--output");
  const provenance = requiredOption("--provenance");
  const source = await readFile(input);
  const repacked = repackRoyalEnvironmentKtx1(
    source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
    provenance,
  );
  await writeFile(output, new Uint8Array(repacked));
};

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  repackRoyalEnvironmentKtx1,
  RoyalEnvironmentRepackError,
} from "../scripts/repack-royal-environment";
import { parseRoyalEnvironmentKtx1 } from "../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { assertFuzz, forEachFuzzCase, SeededRandom } from "./fuzz";

const IDENTIFIER = new Uint8Array([
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SIZE = 256;
const LEVELS = 9;
const FACES = 6;

type NativeFixture = {
  readonly firstImageSizeOffset: number;
  readonly faceRanges: readonly { readonly byteLength: number; readonly byteOffset: number }[];
  readonly metadataValueOffset: number;
  readonly source: ArrayBuffer;
};

const align4 = (value: number): number => (value + 3) & ~3;

const fixture = (random: SeededRandom, overflow = false): NativeFixture => {
  const coefficients = Array.from({ length: 27 }, () => random.number(-4, 4));
  if (overflow) coefficients[0] = 1e300;
  const value = new TextEncoder().encode(coefficients.join("\n"));
  const key = new TextEncoder().encode("sh");
  const pairBytes = key.byteLength + 1 + value.byteLength;
  const metadataBytes = 4 + align4(pairBytes);
  let payloadBytes = 0;
  for (let level = 0; level < LEVELS; level += 1) {
    const size = SIZE >> level;
    payloadBytes += 4 + size * size * 4 * FACES;
  }
  const source = new ArrayBuffer(64 + metadataBytes + payloadBytes);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  bytes.set(IDENTIFIER);
  view.setUint32(12, 0x04030201, true);
  view.setUint32(16, 0x8c3a, true);
  view.setUint32(20, 1, true);
  view.setUint32(24, 0x1907, true);
  view.setUint32(28, 0x8c3a, true);
  view.setUint32(32, 0x8c3a, true);
  view.setUint32(36, SIZE, true);
  view.setUint32(40, SIZE, true);
  view.setUint32(44, 0, true);
  view.setUint32(48, 0, true);
  view.setUint32(52, FACES, true);
  view.setUint32(56, LEVELS, true);
  view.setUint32(60, metadataBytes, true);
  view.setUint32(64, pairBytes, true);
  bytes.set(key, 68);
  bytes[68 + key.byteLength] = 0;
  const metadataValueOffset = 68 + key.byteLength + 1;
  bytes.set(value, metadataValueOffset);

  let offset = 64 + metadataBytes;
  const firstImageSizeOffset = offset;
  const faceRanges: Array<{ readonly byteLength: number; readonly byteOffset: number }> = [];
  for (let level = 0; level < LEVELS; level += 1) {
    const size = SIZE >> level;
    const faceBytes = size * size * 4;
    view.setUint32(offset, faceBytes, true);
    offset += 4;
    for (let face = 0; face < FACES; face += 1) {
      faceRanges.push({ byteLength: faceBytes, byteOffset: offset });
      for (let index = 0; index < faceBytes; index += 1) {
        bytes[offset + index] = (level * 67 + face * 29 + index) & 0xff;
      }
      offset += faceBytes;
    }
  }
  return { faceRanges, firstImageSizeOffset, metadataValueOffset, source };
};

const malformed = (value: NativeFixture, mutation: number, random: SeededRandom): ArrayBuffer => {
  if (mutation === 0) return value.source.slice(0, random.int(0, value.source.byteLength));
  if (mutation === 5) {
    const result = new Uint8Array(value.source.byteLength + 1);
    result.set(new Uint8Array(value.source));
    return result.buffer;
  }
  const source = value.source.slice(0);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  switch (mutation) {
    case 1:
      bytes[random.int(0, IDENTIFIER.byteLength)]! ^= 0xff;
      break;
    case 2:
      view.setUint32(random.pick([16, 20, 24, 28, 32]), 0, true);
      break;
    case 3:
      view.setUint32(56, LEVELS - 1, true);
      break;
    case 4:
      view.setUint32(value.firstImageSizeOffset, view.getUint32(value.firstImageSizeOffset, true) + 4, true);
      break;
    case 6:
      bytes[68] = 0x78;
      break;
    case 7:
      bytes[value.metadataValueOffset] = 0xff;
      break;
    case 8:
      view.setUint32(60, view.getUint32(60, true) + 4, true);
      break;
  }
  return source;
};

describe("Royal environment cmgen repacker", () => {
  it("is deterministic and preserves every face payload", () => {
    const random = new SeededRandom(0x8b2e_51c7);
    const native = fixture(random);
    const provenance = `source-sha256=${random.int(0, 0x7fff_ffff).toString(16)};tool=cmgen-pinned`;
    const first = repackRoyalEnvironmentKtx1(native.source, provenance);
    const second = repackRoyalEnvironmentKtx1(native.source, provenance);
    expect(Buffer.compare(Buffer.from(first), Buffer.from(second))).toBe(0);

    const prepared = parseRoyalEnvironmentKtx1(first);
    expect(prepared.metadata.provenance).toBe(provenance);
    expect(prepared.levels).toHaveLength(LEVELS);
    let range = 0;
    for (const level of prepared.levels) {
      for (const face of level.faces) {
        const nativeFace = native.faceRanges[range]!;
        expect(Buffer.compare(
          Buffer.from(first, face.byteOffset, face.byteLength),
          Buffer.from(native.source, nativeFace.byteOffset, nativeFace.byteLength),
        )).toBe(0);
        range += 1;
      }
    }
    expect(range).toBe(LEVELS * FACES);
  });

  it("rejects every seeded malformed native-input class", () => {
    forEachFuzzCase({ cases: 18, seed: 0x3197_ee21 }, ({ caseIndex, random }) => {
      const native = fixture(random);
      const provenance = `source-sha256=${random.int(0, 0x7fff_ffff).toString(16)};tool=cmgen-pinned`;
      try {
        repackRoyalEnvironmentKtx1(malformed(native, caseIndex % 9, random), provenance);
        throw new Error("malformed environment was accepted");
      } catch (error) {
        assertFuzz(error instanceof RoyalEnvironmentRepackError, "malformed environment raised wrong error");
      }
    });
  });

  it("rejects coefficients outside finite Float32 range", () => {
    expect(() => repackRoyalEnvironmentKtx1(
      fixture(new SeededRandom(0x7a11_ce55), true).source,
      "source-sha256=overflow-fixture;tool=cmgen-pinned",
    )).toThrow(/Float32-finite/u);
  });
});

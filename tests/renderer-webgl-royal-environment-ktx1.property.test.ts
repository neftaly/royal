import { describe, it } from "vitest";
import {
  parseRoyalEnvironmentKtx1,
  ROYAL_ENVIRONMENT_METADATA_KEY,
  RoyalEnvironmentArtifactError,
} from "../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { assertFuzz, assertFuzzEqual, forEachFuzzCase, type SeededRandom } from "./fuzz";

const KTX1_IDENTIFIER = [
  0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a,
] as const;

type ArtifactFixture = {
  readonly firstImageSizeOffset: number;
  readonly metadataValueOffset: number;
  readonly source: ArrayBuffer;
};

const align4 = (value: number): number => (value + 3) & ~3;

const fixture = (size: number, random: SeededRandom, overflowSh = false): ArtifactFixture => {
  const sh = Array.from({ length: 9 }, () => [
    random.number(-2, 2),
    random.number(-2, 2),
    random.number(-2, 2),
  ]);
  if (overflowSh) sh[0]![0] = 1e300;
  const metadataValue = new TextEncoder().encode(JSON.stringify({
    provenance: `fixture-${size}`,
    sh,
    version: 1,
  }));
  const key = new TextEncoder().encode(ROYAL_ENVIRONMENT_METADATA_KEY);
  const pairBytes = key.byteLength + 1 + metadataValue.byteLength;
  const metadataBytes = 4 + align4(pairBytes);
  const mipLevels = Math.floor(Math.log2(size)) + 1;
  let imageBytes = 0;
  for (let level = 0; level < mipLevels; level += 1) {
    const levelSize = Math.max(1, Math.floor(size / 2 ** level));
    imageBytes += 4 + levelSize * levelSize * 4 * 6;
  }
  const source = new ArrayBuffer(64 + metadataBytes + imageBytes);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  bytes.set(KTX1_IDENTIFIER, 0);
  view.setUint32(12, 0x04030201, true);
  view.setUint32(16, 0x8c3b, true);
  view.setUint32(20, 4, true);
  view.setUint32(24, 0x1907, true);
  view.setUint32(28, 0x8c3a, true);
  view.setUint32(32, 0x1907, true);
  view.setUint32(36, size, true);
  view.setUint32(40, size, true);
  view.setUint32(44, 0, true);
  view.setUint32(48, 0, true);
  view.setUint32(52, 6, true);
  view.setUint32(56, mipLevels, true);
  view.setUint32(60, metadataBytes, true);
  view.setUint32(64, pairBytes, true);
  bytes.set(key, 68);
  bytes[68 + key.byteLength] = 0;
  const metadataValueOffset = 68 + key.byteLength + 1;
  bytes.set(metadataValue, metadataValueOffset);
  let offset = 64 + metadataBytes;
  const firstImageSizeOffset = offset;
  for (let level = 0; level < mipLevels; level += 1) {
    const levelSize = Math.max(1, Math.floor(size / 2 ** level));
    const faceBytes = levelSize * levelSize * 4;
    view.setUint32(offset, faceBytes, true);
    offset += 4;
    for (let face = 0; face < 6; face += 1) {
      for (let byte = 0; byte < faceBytes; byte += 1) bytes[offset + byte] = (level * 37 + face * 11 + byte) & 0xff;
      offset += faceBytes;
    }
  }
  return { firstImageSizeOffset, metadataValueOffset, source };
};

const mutatedArtifact = (
  value: ArtifactFixture,
  mutation: number,
  random: SeededRandom,
): ArrayBuffer => {
  if (mutation === 0) {
    return value.source.slice(0, random.int(0, value.source.byteLength));
  }
  if (mutation === 8) {
    const trailing = new Uint8Array(value.source.byteLength + 1);
    trailing.set(new Uint8Array(value.source));
    return trailing.buffer;
  }
  if (mutation === 9) {
    return fixture(new DataView(value.source).getUint32(36, true), random, true).source;
  }
  const source = value.source.slice(0);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  switch (mutation) {
    case 1:
      bytes[random.int(0, 12)]! ^= 0xff;
      break;
    case 2:
      view.setUint32(12, 0x01020304, true);
      break;
    case 3:
      view.setUint32(random.pick([16, 20, 24, 28, 32]), 0, true);
      break;
    case 4:
      switch (random.int(0, 4)) {
        case 0:
          view.setUint32(40, view.getUint32(36, true) + 1, true);
          break;
        case 1:
          view.setUint32(44, 1, true);
          break;
        case 2:
          view.setUint32(48, 1, true);
          break;
        case 3:
          view.setUint32(52, 5, true);
          break;
      }
      break;
    case 5:
      view.setUint32(56, view.getUint32(56, true) + 1, true);
      break;
    case 6:
      view.setUint32(value.firstImageSizeOffset, view.getUint32(value.firstImageSizeOffset, true) + 4, true);
      break;
    case 7:
      bytes[value.metadataValueOffset] = 0xff;
      break;
  }
  return source;
};

describe("Royal pinned environment KTX1 parser", () => {
  it("borrows valid cubemap ranges and rejects seeded malformed headers or truncation", () => {
    forEachFuzzCase({ cases: 256, seed: 0xe17a_4b31 }, ({ random }) => {
      const size = random.pick([1, 2, 8, 16, 32] as const);
      const value = fixture(size, random);
      const prepared = parseRoyalEnvironmentKtx1(value.source);
      assertFuzzEqual(prepared.source, value.source, "borrowed source");
      assertFuzzEqual(prepared.size, size, "cubemap size");
      assertFuzzEqual(prepared.levels.length, Math.floor(Math.log2(size)) + 1, "mip count");
      assertFuzzEqual(prepared.metadata.sh.length, 9, "spherical harmonics count");
      assertFuzz(Object.isFrozen(prepared), "prepared artifact is mutable");
      assertFuzz(Object.isFrozen(prepared.levels), "prepared levels are mutable");
      let expectedOffset = value.firstImageSizeOffset;
      for (const level of prepared.levels) {
        const expectedFaceBytes = level.size * level.size * 4;
        expectedOffset += 4;
        assertFuzzEqual(level.faces.length, 6, "face count");
        for (const face of level.faces) {
          assertFuzzEqual(face.byteOffset, expectedOffset, "face byte offset");
          assertFuzzEqual(face.byteLength, expectedFaceBytes, "face byte length");
          expectedOffset += expectedFaceBytes;
        }
      }
      assertFuzzEqual(expectedOffset, value.source.byteLength, "artifact byte length");

      const malformed = mutatedArtifact(value, random.int(0, 10), random);
      try {
        parseRoyalEnvironmentKtx1(malformed);
        throw new Error("malformed artifact was accepted");
      } catch (error) {
        assertFuzz(error instanceof RoyalEnvironmentArtifactError, "malformed artifact raised wrong error");
      }
    });
  });
});

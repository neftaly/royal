import { describe, it } from "vitest";
import {
  parseRoyalEnvironmentKtx1,
  RoyalEnvironmentArtifactError,
} from "../../packages/renderer-webgl/src/environment/royal-environment-ktx1";
import { assertFuzz, assertFuzzEqual, forEachFuzzCase } from "../fuzz";
import {
  environmentKtx1Fixture,
  type EnvironmentKtx1Fixture,
} from "./support/environment-ktx1";

const malformedArtifact = (
  fixture: EnvironmentKtx1Fixture,
  mutation: number,
  offset: number,
): ArrayBuffer => {
  if (mutation === 0) return fixture.source.slice(0, offset % fixture.source.byteLength);
  if (mutation === 8) {
    const trailing = new Uint8Array(fixture.source.byteLength + 1);
    trailing.set(new Uint8Array(fixture.source));
    return trailing.buffer;
  }
  const source = fixture.source.slice(0);
  const bytes = new Uint8Array(source);
  const view = new DataView(source);
  switch (mutation) {
    case 1: bytes[offset % 12]! ^= 0xff; break;
    case 2: view.setUint32(12, 0x0102_0304, true); break;
    case 3: view.setUint32([16, 20, 24, 28, 32][offset % 5]!, 0, true); break;
    case 4: {
      const field = [40, 44, 48, 52][offset % 4]!;
      view.setUint32(field, field === 40 ? view.getUint32(36, true) + 1 : 1, true);
      break;
    }
    case 5: view.setUint32(56, view.getUint32(56, true) + 1, true); break;
    case 6:
      view.setUint32(
        fixture.firstImageSizeOffset,
        view.getUint32(fixture.firstImageSizeOffset, true) + 4,
        true,
      );
      break;
    case 7: bytes[fixture.metadataValueOffset] = 0xff; break;
  }
  return source;
};

describe("Royal pinned environment KTX1 parser", () => {
  it("borrows valid ranges and rejects seeded malformed artifacts", () => {
    forEachFuzzCase({ cases: 256, seed: 0xe17a_4b31 }, ({ random }) => {
      const size = random.pick([1, 2, 8, 16, 32] as const);
      const fixture = environmentKtx1Fixture(size, Array.from(
        { length: 9 },
        () => [random.number(-2, 2), random.number(-2, 2), random.number(-2, 2)],
      ));
      const prepared = parseRoyalEnvironmentKtx1(fixture.source);
      assertFuzzEqual(prepared.source, fixture.source, "borrowed source");
      assertFuzzEqual(prepared.size, size, "cubemap size");
      assertFuzzEqual(prepared.levels.length, Math.log2(size) + 1, "mip count");
      assertFuzzEqual(prepared.metadata.sh.length, 9, "SH count");
      let expectedOffset = fixture.firstImageSizeOffset;
      for (const level of prepared.levels) {
        expectedOffset += 4;
        assertFuzzEqual(level.faces.length, 6, "face count");
        for (const face of level.faces) {
          assertFuzzEqual(face.byteOffset, expectedOffset, "face offset");
          assertFuzzEqual(face.byteLength, level.size * level.size * 4, "face length");
          expectedOffset += face.byteLength;
        }
      }
      assertFuzzEqual(expectedOffset, fixture.source.byteLength, "artifact length");

      try {
        parseRoyalEnvironmentKtx1(malformedArtifact(
          fixture,
          random.int(0, 9),
          random.int(0, 0xffff),
        ));
        throw new Error("malformed artifact was accepted");
      } catch (error) {
        assertFuzz(
          error instanceof RoyalEnvironmentArtifactError,
          "malformed artifact raised the wrong error",
        );
      }
    });
  });
});

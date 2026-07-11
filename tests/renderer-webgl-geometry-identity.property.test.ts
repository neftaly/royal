import { describe, expect, it } from "vitest";
import {
  GEOMETRY_BUCKET_COMPARISON_LIMIT,
  findVerifiedGeometry,
  sameArrayViewBytes,
  sameGeometryBytes,
  type GeometryByteLayout,
} from "../packages/renderer-webgl/src/webgl/geometry-identity";
import { forEachFuzzCase } from "./fuzz";

type GeometryEntry = {
  readonly id: number;
  readonly source: GeometryByteLayout;
};

const geometry = (positions: ArrayBufferView, mode = "triangles"): GeometryByteLayout => ({
  mode,
  positions,
});

const fnv1a32 = (bytes: Uint8Array): number => {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

describe("WebGL geometry identity", () => {
  it("verifies exact layout and bytes inside adversarial selector buckets", () => {
    forEachFuzzCase({ cases: 64, seed: 0x6e0_1d3 }, ({ label, random }) => {
      const byteLength = random.int(1, 257);
      const bytes = Uint8Array.from(
        random.array(byteLength, () => random.int(0, 256)),
      );
      const equalCopy = bytes.slice();
      const different = bytes.slice();
      const changedIndex = random.int(0, different.length);
      different[changedIndex] = (different[changedIndex]! + random.int(1, 256)) & 0xff;

      const entry: GeometryEntry = { id: 1, source: geometry(bytes) };
      expect(findVerifiedGeometry([entry], geometry(equalCopy)), label).toBe(entry);
      expect(findVerifiedGeometry([entry], geometry(different)), label).toBeUndefined();
      expect(sameGeometryBytes(entry.source, geometry(equalCopy, "lines")), label).toBe(false);
      expect(sameArrayViewBytes(bytes, new Uint16Array([1])), label).toBe(false);
    });
  });

  it("rejects a real FNV-1a selector collision", () => {
    const first = Uint8Array.from([0x03, 0x6a, 0x5b, 0x51, 0xce, 0x95, 0x79, 0xbf]);
    const second = Uint8Array.from([0x5c, 0x4e, 0x9f, 0x8f, 0xb6, 0x53, 0xcb, 0xac]);
    expect(fnv1a32(first)).toBe(fnv1a32(second));

    const entry: GeometryEntry = { id: 1, source: geometry(first) };
    expect(findVerifiedGeometry([entry], geometry(second))).toBeUndefined();
  });

  it("re-verifies bucket sources instead of trusting stale content hashes", () => {
    const admitted = new Uint8Array([1, 2, 3, 4]);
    const original = admitted.slice();
    const entry: GeometryEntry = { id: 1, source: geometry(admitted) };
    admitted[2] = 99;

    expect(findVerifiedGeometry([entry], geometry(original))).toBeUndefined();
    expect(findVerifiedGeometry([entry], geometry(admitted.slice()))).toBe(entry);
  });

  it("stops comparisons at the cap so overflow falls back to unique identity", () => {
    const entries: GeometryEntry[] = Array.from(
      { length: GEOMETRY_BUCKET_COMPARISON_LIMIT + 1 },
      (_value, index) => ({ id: index, source: geometry(new Uint8Array([index])) }),
    );
    const overflowMatch = entries[GEOMETRY_BUCKET_COMPARISON_LIMIT]!;

    expect(findVerifiedGeometry(entries, overflowMatch.source)).toBeUndefined();
    expect(findVerifiedGeometry(entries, entries[0]!.source)).toBe(entries[0]);
  });
});

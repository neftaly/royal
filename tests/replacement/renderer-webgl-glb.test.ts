import { describe, expect, it } from "vitest";
import { parseGlb } from "../../packages/renderer-webgl/src/gltf/glb";

const JSON_CHUNK = 0x4e_4f_53_4a;
const BINARY_CHUNK = 0x00_4e_49_42;

const glb = (
  document: unknown,
  binary: Uint8Array | undefined = undefined,
): Uint8Array => {
  const encoded = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = Math.ceil(encoded.length / 4) * 4;
  const binaryLength = binary === undefined ? 0 : Math.ceil(binary.length / 4) * 4;
  const total = 12 + 8 + jsonLength + (binary === undefined ? 0 : 8 + binaryLength);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46_54_6c_67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  bytes.fill(0x20, 20, 20 + jsonLength);
  bytes.set(encoded, 20);
  if (binary !== undefined) {
    const offset = 20 + jsonLength;
    view.setUint32(offset, binaryLength, true);
    view.setUint32(offset + 4, BINARY_CHUNK, true);
    bytes.set(binary, offset + 8);
  }
  return bytes;
};

describe("GLB container core", () => {
  it("parses JSON and retains a zero-copy binary view", () => {
    const bytes = glb({ asset: { version: "2.0" }, meshes: [] }, new Uint8Array([1, 2, 3, 4]));
    const parsed = parseGlb(bytes, "model.glb");
    expect(parsed.document).toEqual({ asset: { version: "2.0" }, meshes: [] });
    expect(parsed.binaryChunk).toEqual(new Uint8Array([1, 2, 3, 4]));
    expect(parsed.binaryChunk?.buffer).toBe(bytes.buffer);
  });

  it("rejects malformed headers, lengths, chunk order, UTF-8, and JSON", () => {
    const valid = glb({ asset: { version: "2.0" } });
    const cases: Array<[string, Uint8Array, string]> = [];
    cases.push(["header", valid.subarray(0, 8), "header is truncated"]);
    const badMagic = valid.slice();
    badMagic[0] = 0;
    cases.push(["magic", badMagic, "magic is invalid"]);
    const badLength = valid.slice();
    new DataView(badLength.buffer).setUint32(8, badLength.length + 4, true);
    cases.push(["length", badLength, "does not match"]);
    const badOrder = valid.slice();
    new DataView(badOrder.buffer).setUint32(16, BINARY_CHUNK, true);
    cases.push(["order", badOrder, "first chunk must be JSON"]);
    const badUtf8 = glb({ ok: true });
    badUtf8.fill(0xff, 20, 24);
    cases.push(["utf8", badUtf8, "not valid UTF-8"]);
    const badJson = glb({ ok: true });
    badJson[20] = 0x21;
    cases.push(["json", badJson, "not valid JSON"]);

    for (const [label, bytes, message] of cases) {
      expect(() => parseGlb(bytes, label)).toThrow(`${label}:`);
      expect(() => parseGlb(bytes, label)).toThrow(message);
    }
  });

  it("rejects every truncation boundary without reading outside the container", () => {
    const valid = glb({ asset: { version: "2.0" } }, new Uint8Array([1, 2, 3, 4]));
    for (let length = 0; length < valid.length; length += 1) {
      const truncated = valid.slice(0, length);
      expect(() => parseGlb(truncated, `cut-${length}`)).toThrow();
    }
  });
});

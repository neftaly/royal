import { describe, expect, it } from "vitest";
import { inspectEtc2Ktx2 } from "../../packages/renderer-webgl/src/ktx2";
import { createKtx2Etc2Fixture } from "./support/ktx2-etc2-fixture";

describe("ETC2 KTX2 tooling boundary", () => {
  it("returns a compact exact-storage inspection after full profile validation", () => {
    expect(inspectEtc2Ktx2(createKtx2Etc2Fixture(152, 8, 4, 4))).toEqual({
      colorSpace: "srgb",
      height: 4,
      levelCount: 4,
      storageBytes: 80,
      width: 8,
    });
    expect(inspectEtc2Ktx2(createKtx2Etc2Fixture(151))).toMatchObject({
      colorSpace: "linear",
      storageBytes: 16,
    });
  });

  it("does not weaken the runtime parser for tooling inputs", () => {
    expect(() => inspectEtc2Ktx2(new Uint8Array(104))).toThrow("not KTX2");
    expect(() => inspectEtc2Ktx2(createKtx2Etc2Fixture(0))).toThrow("Basis supercompression");
  });
});

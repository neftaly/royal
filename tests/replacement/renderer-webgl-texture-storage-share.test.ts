import { describe, expect, it } from "vitest";
import { textureStorageShare } from "../../packages/renderer-webgl/src/texture/storage-share";

describe("texture storage allocation", () => {
  it("returns unused tiny-image shares to a large texture", () => {
    expect(textureStorageShare(1000, [{ bytes: 10, copies: 54 }, { bytes: Infinity, copies: 1 }])).toBe(460);
  });
  it("charges every GPU representation sharing a decode", () => {
    expect(textureStorageShare(1000, [{ bytes: 10, copies: 4 }, { bytes: Infinity, copies: 3 }])).toBe(320);
  });
  it("does not exceed natural resolution or reserve absent resources", () => {
    expect(textureStorageShare(1000, [{ bytes: 100, copies: 1 }, { bytes: 200, copies: 1 }])).toBe(200);
    expect(textureStorageShare(1000, [])).toBeUndefined();
    expect(textureStorageShare(0, [{ bytes: Infinity, copies: 1 }])).toBe(4);
  });
  it("keeps partially funded allocations within the shared ceiling regardless of input order", () => {
    const demands = [{ bytes: 100, copies: 3 }, { bytes: 210, copies: 2 }, { bytes: Infinity, copies: 4 }];
    for (const budget of [100, 1000, 3000, 50000]) {
      const share = textureStorageShare(budget, demands)!;
      expect(textureStorageShare(budget, [...demands].reverse())).toBe(share);
      expect(demands.reduce((sum, d) => sum + Math.min(share, d.bytes) * d.copies, 0)).toBeLessThanOrEqual(budget);
    }
  });
});

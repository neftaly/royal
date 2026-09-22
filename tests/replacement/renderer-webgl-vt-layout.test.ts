import { describe, expect, it } from "vitest";
import { createGeneratedVirtualTextureLayout, virtualTexturePageKey } from "../../packages/renderer-webgl/src/virtual-texture/layout";
const layout = (width: number, height: number) => createGeneratedVirtualTextureLayout({ width, height, pageSize: 512, borderTexels: 2, colorSpace: "srgb" });
describe("generated VT layout", () => {
  it("builds complete square and odd rectangular mip pyramids", () => {
    expect(layout(4096, 4096)).toMatchObject({ mipCount: 4, tableWidth: 8, tableHeight: 8, tableByteLength: 340 });
    expect(layout(2561, 1537)).toMatchObject({ mipCount: 4, tableWidth: 8, tableHeight: 4, tableByteLength: 172,
      mipLayouts: [{ byteOffset: 0, width: 6, height: 4 }, { byteOffset: 128, width: 3, height: 2 }, { byteOffset: 160, width: 2, height: 1 }, { byteOffset: 168, width: 1, height: 1 }] });
  });
  it("keeps large coordinates distinct without 32-bit truncation", () => {
    const keys = [65535, 65536, 16777216].flatMap(x => [0, 256, 65536].map(y => virtualTexturePageKey({ mip: 0, x, y })));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid dimensions %s", width => {
    expect(() => layout(width, 1024)).toThrow();
  });
});

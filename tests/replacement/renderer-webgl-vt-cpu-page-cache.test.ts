import { expect, it } from "vitest";
import { CpuVirtualTexturePageCache } from "../../packages/renderer-webgl/src/virtual-texture/cpu-page-cache";

it("bounds existing CPU pixels by bytes, uses access recency, and isolates owners", () => {
  const cache = new CpuVirtualTexturePageCache(32), a = {}, b = {};
  const pixels = (bytes: number) => ({ data: new Uint8ClampedArray(bytes) }) as ImageData;
  const first = pixels(16), second = pixels(16);
  cache.set(a, 1, first); cache.set(b, 1, second);
  expect(cache.get(a, 1)).toBe(first); // No copy or readback.
  cache.set(a, 2, pixels(16));
  expect(cache.get(b, 1)).toBeUndefined();
  expect(cache.bytes).toBe(32);
  cache.set(a, 2, pixels(40));
  expect(cache.bytes).toBe(16);
  cache.deleteOwner(a);
  expect(cache.bytes).toBe(0);
  expect(cache.get(a, 1)).toBeUndefined();
});

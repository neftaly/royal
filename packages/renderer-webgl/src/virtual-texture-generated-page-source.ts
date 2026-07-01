import type { VirtualTextureManifestGeneratedPageSource } from "./virtual-texture-manifest";
import type {
  VirtualTexturePageSource,
  VirtualTexturePageSourceRequest,
} from "./virtual-texture-resource";

export const createGeneratedVirtualTexturePageSource = (
  source: VirtualTextureManifestGeneratedPageSource,
): VirtualTexturePageSource => {
  switch (source.generator) {
    case "debug-rgba":
      return { loadPage: createDebugRgbaPage };
  }
};

const createDebugRgbaPage = (request: VirtualTexturePageSourceRequest): Uint8Array => {
  if (request.bytesPerTexel !== 4) {
    throw new Error("Virtual texture generated debug-rgba pages require 4 bytes per texel");
  }

  const pixels = new Uint8Array(request.byteLength);
  const baseColor = debugPageColor(request);
  const checkerSize = Math.max(4, Math.floor(request.pageSize / 8));
  for (let y = 0; y < request.paddedPageSize; y += 1) {
    for (let x = 0; x < request.paddedPageSize; x += 1) {
      const pixel = (y * request.paddedPageSize + x) * 4;
      const localX = x - request.borderTexels;
      const localY = y - request.borderTexels;
      const border = (
        x < request.borderTexels ||
        y < request.borderTexels ||
        x >= request.paddedPageSize - request.borderTexels ||
        y >= request.paddedPageSize - request.borderTexels
      );
      const checker = (Math.floor(localX / checkerSize) + Math.floor(localY / checkerSize)) % 2 === 0;
      const shade = border ? 255 : checker ? 32 : 0;
      pixels[pixel] = clampByte(baseColor[0] + shade);
      pixels[pixel + 1] = clampByte(baseColor[1] + shade);
      pixels[pixel + 2] = clampByte(baseColor[2] + shade);
      pixels[pixel + 3] = 255;
    }
  }
  return pixels;
};

const clampByte = (value: number): number => Math.max(0, Math.min(255, value));

const debugPageColor = (request: VirtualTexturePageSourceRequest): readonly [number, number, number] => [
  (48 + request.page.x * 59 + request.page.mip * 31) % 224,
  (80 + request.page.y * 67 + request.page.mip * 43) % 224,
  (112 + request.page.x * 23 + request.page.y * 29 + request.page.mip * 53) % 224,
];

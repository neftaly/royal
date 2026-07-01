import { describe, expect, it } from "vitest";

import { createGeneratedVirtualTexturePageSource } from "../src/virtual-texture-generated-page-source";
import type { VirtualTexturePageSourceRequest } from "../src/virtual-texture-resource";
import { virtualTexturePageId, type VirtualTexturePageAddress } from "../src/virtual-texture-runtime";

const requestFor = (
  page: VirtualTexturePageAddress,
  overrides: Partial<VirtualTexturePageSourceRequest> = {},
): VirtualTexturePageSourceRequest => {
  const pageSize = overrides.pageSize ?? 32;
  const borderTexels = overrides.borderTexels ?? 2;
  const paddedPageSize = overrides.paddedPageSize ?? pageSize + borderTexels * 2;
  const bytesPerTexel = overrides.bytesPerTexel ?? 4;

  return {
    borderTexels,
    byteLength: overrides.byteLength ?? paddedPageSize * paddedPageSize * bytesPerTexel,
    bytesPerTexel,
    paddedPageSize,
    page,
    pageId: overrides.pageId ?? virtualTexturePageId(page),
    pageSize,
    virtualSize: overrides.virtualSize ?? [128, 96],
  };
};

const checksum = (view: ArrayBufferView): number => {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let hash = 0x811C9DC5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
};

describe("createGeneratedVirtualTexturePageSource", () => {
  it("generates debug-rgba pages sized to the request byte length", async () => {
    const source = createGeneratedVirtualTexturePageSource({ generator: "debug-rgba", kind: "generated" });
    const request = requestFor({ mip: 0, x: 1, y: 2 });

    const page = await source.loadPage(request);

    expect(ArrayBuffer.isView(page)).toBe(true);
    expect(page.byteLength).toBe(request.byteLength);
  });

  it("generates deterministic debug-rgba bytes for the same request", async () => {
    const source = createGeneratedVirtualTexturePageSource({ generator: "debug-rgba", kind: "generated" });
    const request = requestFor({ mip: 1, x: 2, y: 1 }, { borderTexels: 1, pageSize: 24 });

    const first = await source.loadPage(request);
    const second = await source.loadPage(request);

    expect(first).toBeInstanceOf(Uint8Array);
    expect(second).toBeInstanceOf(Uint8Array);
    expect(new Uint8Array(first.buffer, first.byteOffset, first.byteLength)).toEqual(
      new Uint8Array(second.buffer, second.byteOffset, second.byteLength),
    );
    expect(checksum(first)).toBe(checksum(second));
  });

  it("generates distinct debug-rgba bytes across mip and page coordinates", async () => {
    const source = createGeneratedVirtualTexturePageSource({ generator: "debug-rgba", kind: "generated" });
    const requests = [
      requestFor({ mip: 0, x: 0, y: 0 }),
      requestFor({ mip: 0, x: 1, y: 0 }),
      requestFor({ mip: 0, x: 0, y: 1 }),
      requestFor({ mip: 1, x: 0, y: 0 }),
    ];

    const pages: ArrayBufferView[] = [];
    for (const request of requests) pages.push(await source.loadPage(request));
    const checksums = pages.map(checksum);

    expect(new Set(checksums).size).toBe(requests.length);
  });

  it("honors request.byteLength for non-default debug-rgba page dimensions", async () => {
    const source = createGeneratedVirtualTexturePageSource({ generator: "debug-rgba", kind: "generated" });
    const request = requestFor(
      { mip: 2, x: 3, y: 1 },
      {
        borderTexels: 3,
        pageSize: 17,
        virtualSize: [257, 129],
      },
    );

    const page = await source.loadPage(request);

    expect(page.byteLength).toBe(request.byteLength);
    expect(page.byteLength).toBe(23 * 23 * 4);
  });
});

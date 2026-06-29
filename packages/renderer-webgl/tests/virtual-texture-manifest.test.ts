import { describe, expect, it } from "vitest";

import {
  parseVirtualTextureManifest,
  resolveVirtualTextureManifestPageUri,
} from "../src/virtual-texture-manifest";

describe("parseVirtualTextureManifest", () => {
  it("normalizes manifest geometry and runtime options", () => {
    const manifest = parseVirtualTextureManifest({
      borderTexels: 4,
      bytesPerTexel: 4,
      id: "terrain:alpine",
      pageSize: 128,
      pages: {
        baseUri: "https://assets.example.test/vt/",
        entries: {
          "m0/0/0": "seed/root.rgba",
        },
        uriTemplate: "pages/{mip}/{x}/{y}.rgba",
      },
      physicalSlots: 16,
      virtualSize: { height: 512, width: 640 },
    });

    expect(manifest).toMatchObject({
      borderTexels: 4,
      bytesPerTexel: 4,
      format: "rgba8",
      id: "terrain:alpine",
      mipCount: 4,
      pageSize: 128,
      physicalSlots: 16,
      runtimeOptions: {
        borderTexels: 4,
        bytesPerTexel: 4,
        mipCount: 4,
        pageSize: 128,
        physicalSlots: 16,
        virtualSize: [640, 512],
      },
      virtualSize: [640, 512],
    });
    expect(resolveVirtualTextureManifestPageUri(manifest, { mip: 0, x: 0, y: 0 })).toBe(
      "https://assets.example.test/vt/seed/root.rgba",
    );
    expect(resolveVirtualTextureManifestPageUri(manifest, { mip: 1, x: 2, y: 1 })).toBe(
      "https://assets.example.test/vt/pages/1/2/1.rgba",
    );
  });

  it("accepts tuple sizes and array page entries", () => {
    const manifest = parseVirtualTextureManifest({
      id: "terrain:plain",
      pageSize: 256,
      pages: {
        entries: [{ mip: 0, x: 1, y: 0, uri: "m0-1-0.rgba" }],
      },
      physicalSlots: 4,
      virtualSize: [512, 256],
    });

    expect(manifest.borderTexels).toBe(0);
    expect(manifest.bytesPerTexel).toBe(4);
    expect(manifest.mipCount).toBe(2);
    expect(resolveVirtualTextureManifestPageUri(manifest, { mip: 0, x: 1, y: 0 })).toBe("m0-1-0.rgba");
    expect(resolveVirtualTextureManifestPageUri(manifest, { mip: 1, x: 0, y: 0 })).toBeNull();
  });

  it("rejects invalid geometry and page ids", () => {
    expect(() => parseVirtualTextureManifest({})).toThrow(
      "Virtual texture manifest id must be a non-empty string",
    );
    expect(() =>
      parseVirtualTextureManifest({
        id: "terrain:bad",
        pageSize: 0,
        physicalSlots: 4,
        virtualSize: [512, 512],
      })
    ).toThrow("Virtual texture manifest pageSize must be a positive integer");
    expect(() =>
      parseVirtualTextureManifest({
        id: "terrain:bad",
        pageSize: 128,
        pages: { entries: { "0/0/0": "bad.rgba" } },
        physicalSlots: 4,
        virtualSize: [512, 512],
      })
    ).toThrow("Virtual texture manifest pages.entries key 0/0/0 must be a page id");
  });

  it("rejects URI resolution outside manifest bounds", () => {
    const manifest = parseVirtualTextureManifest({
      id: "terrain:plain",
      pageSize: 128,
      pages: { uriTemplate: "pages/{page}.rgba" },
      physicalSlots: 4,
      virtualSize: [256, 256],
    });

    expect(() => resolveVirtualTextureManifestPageUri(manifest, { mip: 0, x: 2, y: 0 })).toThrow(
      "Virtual texture manifest page m0/2/0 is outside 2x2 mip bounds",
    );
  });
});

import {
  solidTexture,
  textureAsset,
  virtualTextureAsset,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import type { RendererWebGlContext } from "../src/gl";
import {
  bindMaterialBaseColor,
  lowerMaterialBaseColorBinding,
  selectVirtualTextureMip,
} from "../src/material-texture-binding";
import type { TextureAssetLoadResult } from "../src/texture-cache";
import type { VirtualTextureCacheLoadResult } from "../src/virtual-texture-cache";
import type {
  VirtualTexturePageRequestResult,
  VirtualTextureResource,
} from "../src/virtual-texture-resource";

type VirtualTextureFrameUploadResult = ReturnType<VirtualTextureResource["uploadFrame"]>;

type UniformCall = {
  readonly name: string;
  readonly value: number | readonly number[];
};

const uniform = (name: string): WebGLUniformLocation =>
  ({ name }) as unknown as WebGLUniformLocation;

const uniformName = (location: WebGLUniformLocation): string =>
  (location as unknown as { readonly name: string }).name;

const baseColorUniforms = () => ({
  baseColor: uniform("baseColor"),
  color: uniform("color"),
  useVirtualTexture: uniform("useVirtualTexture"),
  useBaseColorTexture: uniform("useBaseColorTexture"),
  virtualAtlas: uniform("virtualAtlas"),
  virtualBorderTexels: uniform("virtualBorderTexels"),
  virtualMip: uniform("virtualMip"),
  virtualPaddedPageSize: uniform("virtualPaddedPageSize"),
  virtualPageSize: uniform("virtualPageSize"),
  virtualPageTable: uniform("virtualPageTable"),
  virtualPageTableSize: uniform("virtualPageTableSize"),
  virtualPhysicalAtlasSize: uniform("virtualPhysicalAtlasSize"),
});

const fakeGl = (): {
  readonly activeTextureUnits: number[];
  readonly boundTextures: (WebGLTexture | null)[];
  readonly gl: RendererWebGlContext;
  readonly uniformCalls: UniformCall[];
} => {
  const activeTextureUnits: number[] = [];
  const boundTextures: (WebGLTexture | null)[] = [];
  const uniformCalls: UniformCall[] = [];
  const gl = {
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    activeTexture(unit: number) {
      activeTextureUnits.push(unit);
    },
    bindTexture(_target: GLenum, texture: WebGLTexture | null) {
      boundTextures.push(texture);
    },
    uniform1i(location: WebGLUniformLocation, value: number) {
      uniformCalls.push({ name: uniformName(location), value });
    },
    uniform1f(location: WebGLUniformLocation, value: number) {
      uniformCalls.push({ name: uniformName(location), value });
    },
    uniform2fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
    uniform4fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
  } as unknown as RendererWebGlContext;

  return { activeTextureUnits, boundTextures, gl, uniformCalls };
};

const fakeReadyVirtualTextureResource = (options: {
  readonly cacheCapacity?: number;
  readonly mappedPages?: number;
  readonly pageTableMipDimensions?: readonly { readonly height: number; readonly width: number }[];
  readonly requestResult?: VirtualTexturePageRequestResult;
  readonly residentPages?: number;
  readonly uploadResult?: Partial<VirtualTextureFrameUploadResult>;
} = {}) => {
  const pageTableTexture = { id: "page-table" } as unknown as WebGLTexture;
  const physicalAtlasTexture = { id: "physical-atlas" } as unknown as WebGLTexture;
  const pageTableMipDimensions = options.pageTableMipDimensions ?? [
    { height: 2, width: 4 },
    { height: 1, width: 2 },
    { height: 1, width: 1 },
  ];
  const requestPages = vi.fn((footprint: { readonly mip: number }) => ({
    ...(options.requestResult ?? {
      pages: [{ mip: footprint.mip, x: 0, y: 0 }],
      pending: 0,
      ready: 0,
      resident: 1,
      scheduled: 0,
    }),
  }));
  const uploadFrame = vi.fn((uploadOptions: { readonly frame?: number } = {}) => ({
    bytesUploaded: 0,
    frame: uploadOptions.frame ?? 0,
    pageTableFullRebuilds: 0,
    pageTableTexSubImageCalls: 0,
    pageTableUploads: 0,
    pendingUploadCount: 0,
    physicalAtlasUploads: 0,
    ...options.uploadResult,
  }));
  const waitForPendingRequests = vi.fn(() => Promise.resolve());
  const resource = ({
    getTextureBindings: vi.fn(() => ({
      borderTexels: 1,
      mipCount: pageTableMipDimensions.length,
      paddedPageSize: 66,
      pageSize: 64,
      pageTableMipDimensions,
      pageTableTexture,
      physicalAtlasSize: [132, 66],
      physicalAtlasTexture,
      slotGrid: [2, 1],
      virtualSize: [256, 128],
    })),
    requestPages,
    stats: vi.fn(() => ({
      cache: {
        capacity: options.cacheCapacity ?? 2,
        residentPages: options.residentPages ?? 1,
      },
      mappings: { mappedPages: options.mappedPages ?? 1 },
    })),
    uploadFrame,
    waitForPendingRequests,
  } as unknown as VirtualTextureResource);

  return {
    pageTableTexture,
    physicalAtlasTexture,
    requestPages,
    resource,
    uploadFrame,
    waitForPendingRequests,
  };
};

describe("lowerMaterialBaseColorBinding", () => {
  it("preserves solid texture identity", () => {
    const source = solidTexture({
      color: [0.2, 0.3, 0.4, 1],
      colorSpace: "linear",
      id: "paint",
      version: 2,
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toEqual({
      color: [0.2, 0.3, 0.4, 1],
      kind: "solid",
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).not.toHaveBeenCalled();
  });

  it("preserves asset texture identity and load state", () => {
    const source = textureAsset({
      colorSpace: "srgb",
      fallback: solidTexture({ color: [0.1, 0.2, 0.3, 1] }),
      sampler: {
        magFilter: "nearest",
        minFilter: "linear-mipmap-linear",
        wrapS: "repeat",
        wrapT: "clamp-to-edge",
      },
      uri: "https://example.test/crate.png",
      version: "b",
    });
    const load = {
      kind: "ready",
      texture: {} as WebGLTexture,
    } satisfies TextureAssetLoadResult;
    const onTextureSettled = vi.fn();
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => load),
    };

    const binding = lowerMaterialBaseColorBinding(source, {
      onTextureSettled,
      textureCache,
    });

    expect(binding).toEqual({
      fallbackColor: [0.1, 0.2, 0.3, 1],
      kind: "asset",
      load,
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).toHaveBeenCalledWith(
      source,
      onTextureSettled,
    );
  });

  it("uses the renderer default grey as the asset fallback color when none is declared", () => {
    const source = textureAsset({
      src: "https://example.test/albedo.png",
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => ({ kind: "loading" } as const)),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toMatchObject({
      fallbackColor: [0.5, 0.5, 0.5, 1],
      kind: "asset",
      source,
    });
    expect(source).toMatchObject({
      uri: "https://example.test/albedo.png",
    });
  });

  it("lowers virtual texture assets to fallback color without using the ordinary texture cache", () => {
    const source = virtualTextureAsset({
      fallback: solidTexture({ color: [0.25, 0.5, 0.75, 1] }),
      manifestUri: "https://example.test/terrain.vt.json",
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toEqual({
      fallbackColor: [0.25, 0.5, 0.75, 1],
      kind: "virtual-asset",
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).not.toHaveBeenCalled();
  });

  it("uses the renderer default grey as the virtual texture fallback color when none is declared", () => {
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toEqual({
      fallbackColor: [0.5, 0.5, 0.5, 1],
      kind: "virtual-asset",
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).not.toHaveBeenCalled();
  });

  it("loads a virtual texture preview and VT resource while preserving virtual source identity", () => {
    const preview = textureAsset({
      fallback: solidTexture({ color: [0.15, 0.25, 0.35, 1] }),
      uri: "https://example.test/terrain-preview.png",
    });
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
      preview,
    });
    const load = {
      kind: "ready",
      texture: {} as WebGLTexture,
    } satisfies TextureAssetLoadResult;
    const onTextureSettled = vi.fn();
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => load),
    };
    const virtualLoad = {
      kind: "loading",
      stats: {
        error: null,
        manifestUri: "https://example.test/terrain.vt.json",
        resource: null,
        status: "loading",
      },
    } satisfies VirtualTextureCacheLoadResult;
    const virtualTextureCache = {
      loadVirtualTexture: vi.fn(() => virtualLoad),
    };

    const binding = lowerMaterialBaseColorBinding(source, {
      onTextureSettled,
      textureCache,
      virtualTextureCache,
    });

    expect(binding).toEqual({
      fallbackColor: [0.15, 0.25, 0.35, 1],
      kind: "virtual-asset",
      previewLoad: load,
      source,
      virtualLoad,
    });
    expect(textureCache.loadTextureAssetBaseColor).toHaveBeenCalledWith(
      preview,
      onTextureSettled,
    );
    expect(virtualTextureCache.loadVirtualTexture).toHaveBeenCalledWith(
      source,
      onTextureSettled,
    );
  });

  it("uses a virtual texture fallback before the preview fallback while the preview is loading", () => {
    const preview = textureAsset({
      fallback: solidTexture({ color: [0.15, 0.25, 0.35, 1] }),
      uri: "https://example.test/terrain-preview.png",
    });
    const source = virtualTextureAsset({
      fallback: solidTexture({ color: [0.7, 0.6, 0.5, 1] }),
      manifestUri: "https://example.test/terrain.vt.json",
      preview,
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => ({ kind: "loading" } as const)),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toMatchObject({
      fallbackColor: [0.7, 0.6, 0.5, 1],
      kind: "virtual-asset",
      source,
    });
  });
});

describe("selectVirtualTextureMip", () => {
  const bindings = {
    pageTableMipDimensions: [
      { height: 8, width: 16 },
      { height: 4, width: 8 },
      { height: 2, width: 4 },
      { height: 1, width: 2 },
    ],
    slotGrid: [8, 1] as const,
    virtualSize: [1024, 512] as const,
  };

  it("keeps an empty resident cache on the coarsest bootstrap mip", () => {
    expect(selectVirtualTextureMip(bindings, {
      residentPages: 0,
      virtualTextureDemand: { screenFootprintPx: [1024, 512] },
    })).toBe(3);
  });

  it("selects from screen footprint after bootstrap while respecting cache capacity", () => {
    expect(selectVirtualTextureMip(bindings, {
      cacheCapacity: 9,
      residentPages: 1,
      virtualTextureDemand: { screenFootprintPx: [1024, 512] },
    })).toBe(2);
    expect(selectVirtualTextureMip(bindings, {
      cacheCapacity: 9,
      residentPages: 1,
      virtualTextureDemand: { screenFootprintPx: [256, 128] },
    })).toBe(2);
  });

  it("uses the resident cache capacity instead of the physical slot grid area", () => {
    expect(selectVirtualTextureMip(bindings, {
      cacheCapacity: 4,
      residentPages: 1,
      virtualTextureDemand: { screenFootprintPx: [1024, 512] },
    })).toBe(3);
  });

  it("avoids a mip whose full page count consumes every cache slot when pages are resident", () => {
    expect(selectVirtualTextureMip(bindings, {
      cacheCapacity: 8,
      residentPages: 1,
      virtualTextureDemand: { screenFootprintPx: [1024, 512] },
    })).toBe(3);
  });

  it("falls back to coarsest when demand is absent or invalid", () => {
    expect(selectVirtualTextureMip(bindings, { residentPages: 1 })).toBe(3);
    expect(selectVirtualTextureMip(bindings, {
      residentPages: 1,
      virtualTextureDemand: { screenFootprintPx: [Number.NaN, 128] },
    })).toBe(3);
  });

  it("clamps explicit demanded mips", () => {
    expect(selectVirtualTextureMip(bindings, {
      residentPages: 1,
      virtualTextureDemand: { desiredMip: -2 },
    })).toBe(0);
    expect(selectVirtualTextureMip(bindings, {
      desiredMip: 99,
      residentPages: 1,
    })).toBe(3);
  });
});

describe("bindMaterialBaseColor", () => {
  it("binds a ready asset texture to the selected texture unit", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const texture = {} as WebGLTexture;
    const source = textureAsset({
      uri: "https://example.test/crate.png",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [1, 1, 1, 1],
        kind: "asset",
        load: { kind: "ready", texture },
        source,
      },
      2,
    );

    expect(activeTextureUnits).toEqual([gl.TEXTURE0 + 2]);
    expect(boundTextures).toEqual([texture]);
    expect(uniformCalls).toEqual([
      { name: "baseColor", value: 2 },
      { name: "useBaseColorTexture", value: 1 },
      { name: "useVirtualTexture", value: 0 },
    ]);
  });

  it("binds the fallback color while an asset texture is unavailable", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const source = textureAsset({
      uri: "https://example.test/crate.png",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.4, 0.6, 1],
        kind: "asset",
        load: { kind: "loading" },
        source,
      },
    );

    expect(activeTextureUnits).toEqual([]);
    expect(boundTextures).toEqual([]);
    expect(uniformCalls).toEqual([
      { name: "color", value: [0.2, 0.4, 0.6, 1] },
      { name: "useBaseColorTexture", value: 0 },
      { name: "useVirtualTexture", value: 0 },
    ]);
  });

  it("binds the fallback color for virtual texture assets", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const source = virtualTextureAsset({
      fallback: solidTexture({ color: [0.6, 0.7, 0.8, 1] }),
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.6, 0.7, 0.8, 1],
        kind: "virtual-asset",
        source,
      },
    );

    expect(activeTextureUnits).toEqual([]);
    expect(boundTextures).toEqual([]);
    expect(uniformCalls).toEqual([
      { name: "color", value: [0.6, 0.7, 0.8, 1] },
      { name: "useBaseColorTexture", value: 0 },
      { name: "useVirtualTexture", value: 0 },
    ]);
  });

  it("binds a ready virtual texture preview as temporary fallback rendering", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const texture = {} as WebGLTexture;
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
      preview: textureAsset({
        uri: "https://example.test/terrain-preview.png",
      }),
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        previewLoad: { kind: "ready", texture },
        source,
      },
      3,
    );

    expect(activeTextureUnits).toEqual([gl.TEXTURE0 + 3]);
    expect(boundTextures).toEqual([texture]);
    expect(uniformCalls).toEqual([
      { name: "baseColor", value: 3 },
      { name: "useBaseColorTexture", value: 1 },
      { name: "useVirtualTexture", value: 0 },
    ]);
  });

  it("binds a ready virtual texture resource instead of its ready preview", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const pageTableTexture = { id: "page-table" } as unknown as WebGLTexture;
    const physicalAtlasTexture = { id: "physical-atlas" } as unknown as WebGLTexture;
    const previewTexture = { id: "preview" } as unknown as WebGLTexture;
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
      preview: textureAsset({
        uri: "https://example.test/terrain-preview.png",
      }),
    });
    const requestPages = vi.fn(() => ({
      pages: [{ mip: 1, x: 0, y: 0 }],
      pending: 0,
      ready: 0,
      resident: 1,
      scheduled: 0,
    }));
    const uploadFrame = vi.fn((uploadOptions: { readonly frame?: number } = {}) => ({
      bytesUploaded: 0,
      frame: uploadOptions.frame ?? 0,
      pageTableFullRebuilds: 0,
      pageTableTexSubImageCalls: 0,
      pageTableUploads: 0,
      pendingUploadCount: 0,
      physicalAtlasUploads: 0,
    }));
    const waitForPendingRequests = vi.fn();
    const resource = ({
      getTextureBindings: vi.fn(() => ({
        borderTexels: 1,
        mipCount: 2,
        paddedPageSize: 66,
        pageSize: 64,
        pageTableMipDimensions: [
          { height: 1, width: 2 },
          { height: 1, width: 1 },
        ],
        pageTableTexture,
        physicalAtlasSize: [132, 66],
        physicalAtlasTexture,
        slotGrid: [2, 1],
        virtualSize: [128, 64],
      })),
      requestPages,
      stats: vi.fn(() => ({
        cache: { residentPages: 1 },
        mappings: { mappedPages: 1 },
      })),
      uploadFrame,
      waitForPendingRequests,
    } as unknown as VirtualTextureResource);

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        previewLoad: { kind: "ready", texture: previewTexture },
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      4,
      { frame: 9 },
    );

    expect(requestPages).toHaveBeenCalledWith({
      mip: 1,
      uMax: 1,
      uMin: 0,
      vMax: 1,
      vMin: 0,
    }, 9);
    expect(uploadFrame).toHaveBeenCalledWith({
      frame: 9,
      pageTableUploads: 8,
      physicalAtlasUploads: 1,
    });
    expect(waitForPendingRequests).not.toHaveBeenCalled();
    expect(activeTextureUnits).toEqual([gl.TEXTURE0 + 4, gl.TEXTURE0 + 5]);
    expect(boundTextures).toEqual([pageTableTexture, physicalAtlasTexture]);
    expect(uniformCalls).toEqual([
      { name: "virtualPageTable", value: 4 },
      { name: "virtualAtlas", value: 5 },
      { name: "virtualMip", value: 1 },
      { name: "virtualPageTableSize", value: [1, 1] },
      { name: "virtualPageSize", value: 64 },
      { name: "virtualPaddedPageSize", value: 66 },
      { name: "virtualBorderTexels", value: 1 },
      { name: "virtualPhysicalAtlasSize", value: [132, 66] },
      { name: "color", value: [0.2, 0.3, 0.4, 1] },
      { name: "useBaseColorTexture", value: 0 },
      { name: "useVirtualTexture", value: 1 },
    ]);
  });

  it("coalesces render continuations while virtual texture upload work remains", async () => {
    const { gl } = fakeGl();
    const onVirtualTextureSettled = vi.fn();
    const { resource, uploadFrame, waitForPendingRequests } = fakeReadyVirtualTextureResource({
      uploadResult: {
        pendingUploadCount: 3,
      },
    });
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });
    const binding = {
      fallbackColor: [0.2, 0.3, 0.4, 1],
      kind: "virtual-asset",
      source,
      virtualLoad: { kind: "ready", resource, stats: {} as never },
    } as const;

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      binding,
      1,
      { frame: 9, onVirtualTextureSettled },
    );
    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      binding,
      1,
      { frame: 10, onVirtualTextureSettled },
    );

    expect(uploadFrame).toHaveBeenCalledTimes(2);
    expect(uploadFrame).toHaveBeenNthCalledWith(1, {
      frame: 9,
      pageTableUploads: 8,
      physicalAtlasUploads: 1,
    });
    expect(uploadFrame).toHaveBeenNthCalledWith(2, {
      frame: 10,
      pageTableUploads: 8,
      physicalAtlasUploads: 1,
    });
    expect(waitForPendingRequests).not.toHaveBeenCalled();
    expect(onVirtualTextureSettled).not.toHaveBeenCalled();

    await Promise.resolve();

    expect(onVirtualTextureSettled).toHaveBeenCalledTimes(1);
  });

  it("does not attach a settle callback for virtual texture pages that were already pending", () => {
    const { gl } = fakeGl();
    const { resource, waitForPendingRequests } = fakeReadyVirtualTextureResource({
      requestResult: {
        pages: [{ mip: 2, x: 0, y: 0 }],
        pending: 1,
        ready: 0,
        resident: 0,
        scheduled: 0,
      },
    });
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      { onVirtualTextureSettled: vi.fn() },
    );

    expect(waitForPendingRequests).not.toHaveBeenCalled();
  });

  it("uses an explicit virtual texture demand mip for page requests and page table size", () => {
    const { gl, uniformCalls } = fakeGl();
    const { requestPages, resource } = fakeReadyVirtualTextureResource();
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      { frame: 12, virtualTextureDemand: { desiredMip: 0 } },
    );

    expect(requestPages).toHaveBeenCalledWith({
      mip: 0,
      uMax: 1,
      uMin: 0,
      vMax: 1,
      vMin: 0,
    }, 12);
    expect(uniformCalls).toContainEqual({ name: "virtualMip", value: 0 });
    expect(uniformCalls).toContainEqual({ name: "virtualPageTableSize", value: [4, 2] });
  });

  it("requests a padded narrowed virtual texture UV footprint at the selected mip", () => {
    const { gl, uniformCalls } = fakeGl();
    const { requestPages, resource } = fakeReadyVirtualTextureResource({
      pageTableMipDimensions: [
        { height: 8, width: 16 },
        { height: 4, width: 8 },
        { height: 2, width: 4 },
      ],
    });
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      {
        frame: 12,
        virtualTextureDemand: {
          desiredMip: 1,
          uvFootprint: {
            uMax: 0.25,
            uMin: 0.0625,
            vMax: 0.25,
            vMin: 0.125,
          },
        },
      },
    );

    expect(requestPages).toHaveBeenCalledWith({
      mip: 1,
      uMax: 0.375,
      uMin: 0,
      vMax: 0.5,
      vMin: 0,
    }, 12);
    expect(uniformCalls).toContainEqual({ name: "virtualMip", value: 1 });
    expect(uniformCalls).toContainEqual({ name: "virtualPageTableSize", value: [8, 4] });
  });

  it("falls back to the full virtual texture footprint for invalid narrowed demand", () => {
    const { gl } = fakeGl();
    const { requestPages, resource } = fakeReadyVirtualTextureResource();
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      {
        frame: 13,
        virtualTextureDemand: {
          desiredMip: 0,
          uvFootprint: {
            uMax: 0.5,
            uMin: 0.5,
            vMax: 0.75,
            vMin: 0.25,
          },
        },
      },
    );

    expect(requestPages).toHaveBeenCalledWith({
      mip: 0,
      uMax: 1,
      uMin: 0,
      vMax: 1,
      vMin: 0,
    }, 13);
  });

  it("emits virtual texture runtime stats while binding a ready resource", () => {
    const { gl } = fakeGl();
    const requestResult: VirtualTexturePageRequestResult = {
      pages: [{ mip: 0, x: 0, y: 1 }],
      pending: 1,
      ready: 2,
      resident: 3,
      scheduled: 4,
    };
    const uploadResult = {
      bytesUploaded: 96,
      pageTableTexSubImageCalls: 2,
      pageTableUploads: 3,
      pendingUploadCount: 5,
      physicalAtlasUploads: 1,
    };
    const { resource } = fakeReadyVirtualTextureResource({
      cacheCapacity: 6,
      mappedPages: 7,
      requestResult,
      residentPages: 8,
      uploadResult,
    });
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
      version: "r2",
    });
    const onVirtualTextureRuntimeStats = vi.fn();

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      {
        frame: 42,
        onVirtualTextureRuntimeStats,
        virtualTextureDemand: { desiredMip: 0 },
      },
    );

    expect(onVirtualTextureRuntimeStats).toHaveBeenCalledTimes(1);
    expect(onVirtualTextureRuntimeStats).toHaveBeenCalledWith({
      frame: 42,
      pageTableSize: [4, 2],
      requestPages: requestResult,
      resource: {
        cache: {
          capacity: 6,
          residentPages: 8,
        },
        mappings: {
          mappedPages: 7,
        },
      },
      selectedMip: 0,
      source: {
        kind: "virtual-asset",
        manifestUri: "https://example.test/terrain.vt.json",
        revision: "r2",
      },
      uploadFrame: {
        bytesUploaded: 96,
        frame: 42,
        pageTableFullRebuilds: 0,
        pageTableTexSubImageCalls: 2,
        pageTableUploads: 3,
        pendingUploadCount: 5,
        physicalAtlasUploads: 1,
      },
    });
  });

  it("clamps an out-of-range desired virtual texture mip while binding", () => {
    const { gl, uniformCalls } = fakeGl();
    const { requestPages, resource } = fakeReadyVirtualTextureResource();
    const source = virtualTextureAsset({
      manifestUri: "https://example.test/terrain.vt.json",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.3, 0.4, 1],
        kind: "virtual-asset",
        source,
        virtualLoad: { kind: "ready", resource, stats: {} as never },
      },
      1,
      { desiredMip: 99 },
    );

    expect(requestPages).toHaveBeenCalledWith({
      mip: 2,
      uMax: 1,
      uMin: 0,
      vMax: 1,
      vMin: 0,
    }, 0);
    expect(uniformCalls).toContainEqual({ name: "virtualMip", value: 2 });
    expect(uniformCalls).toContainEqual({ name: "virtualPageTableSize", value: [1, 1] });
  });
});

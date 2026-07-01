import { describe, expect, it } from "vitest";

import type { RendererWebGlContext } from "../src/gl";
import {
  createVirtualTextureResource,
  type VirtualTexturePageSourceRequest,
} from "../src/virtual-texturing";
import {
  parseVirtualTextureManifest,
  VirtualTextureResource,
} from "../src/virtual-texture-testing";
import * as publicVirtualTexturingApi from "../src/virtual-texturing";
import * as testingVirtualTexturingApi from "../src/virtual-texture-testing";

type TexImage2DCall = {
  readonly height: number;
  readonly internalFormat: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
};

type TexSubImage2DCall = {
  readonly byteLength: number;
  readonly height: number;
  readonly level: number;
  readonly texture: WebGLTexture | null;
  readonly width: number;
  readonly xOffset: number;
  readonly yOffset: number;
};

const fakeVirtualTextureGl = (): {
  readonly boundTextures: readonly (WebGLTexture | null)[];
  readonly deletedTextures: readonly WebGLTexture[];
  readonly gl: RendererWebGlContext;
  readonly texImages: readonly TexImage2DCall[];
  readonly texSubImages: readonly TexSubImage2DCall[];
} => {
  let nextTextureId = 0;
  let boundTexture: WebGLTexture | null = null;
  const boundTextures: (WebGLTexture | null)[] = [];
  const deletedTextures: WebGLTexture[] = [];
  const texImages: TexImage2DCall[] = [];
  const texSubImages: TexSubImage2DCall[] = [];

  return {
    boundTextures,
    deletedTextures,
    gl: {
      CLAMP_TO_EDGE: 0x812F,
      NEAREST: 0x2600,
      RGBA: 0x1908,
      RGBA8: 0x8058,
      TEXTURE_2D: 0x0DE1,
      TEXTURE_MAG_FILTER: 0x2800,
      TEXTURE_MIN_FILTER: 0x2801,
      TEXTURE_WRAP_S: 0x2802,
      TEXTURE_WRAP_T: 0x2803,
      UNSIGNED_BYTE: 0x1401,
      bindTexture(_target: GLenum, value: WebGLTexture | null) {
        boundTexture = value;
        boundTextures.push(value);
      },
      createTexture: () => {
        nextTextureId += 1;
        return { id: nextTextureId } as WebGLTexture;
      },
      deleteTexture(texture: WebGLTexture | null) {
        if (texture !== null) deletedTextures.push(texture);
      },
      texImage2D(
        _target: GLenum,
        level: GLint,
        internalFormat: GLint,
        width: GLsizei,
        height: GLsizei,
      ) {
        texImages.push({ height, internalFormat, level, texture: boundTexture, width });
      },
      texParameteri() {},
      texSubImage2D(
        _target: GLenum,
        level: GLint,
        xOffset: GLint,
        yOffset: GLint,
        width: GLsizei,
        height: GLsizei,
        _format: GLenum,
        _type: GLenum,
        pixels: ArrayBufferView,
      ) {
        texSubImages.push({
          byteLength: pixels.byteLength,
          height,
          level,
          texture: boundTexture,
          width,
          xOffset,
          yOffset,
        });
      },
    } as unknown as RendererWebGlContext,
    texImages,
    texSubImages,
  };
};

describe("VirtualTextureResource", () => {
  it("keeps app-facing exports narrowed to the facade and low-level exports under testing", () => {
    expect(Object.keys(publicVirtualTexturingApi).sort()).toEqual(["createVirtualTextureResource"]);
    expect(testingVirtualTexturingApi).toMatchObject({
      VirtualTextureResource,
      VirtualTextureRuntime: expect.any(Function),
      createVirtualTexturePageTableTexture: expect.any(Function),
      planVirtualTextureUploads: expect.any(Function),
    });
  });

  it("allocates page-table and physical atlas textures from a manifest", () => {
    const { gl, texImages } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      borderTexels: 4,
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });

    const resource = new VirtualTextureResource(gl, manifest);

    expect(resource.pageTable.mipDimensions).toEqual([
      { height: 4, width: 4 },
      { height: 2, width: 2 },
      { height: 1, width: 1 },
    ]);
    expect(resource.physicalAtlas).toMatchObject({
      height: 272,
      paddedPageSize: 136,
      slotColumns: 2,
      slotRows: 2,
      width: 272,
    });
    expect(texImages.map((call) => [call.level, call.width, call.height, call.internalFormat])).toEqual([
      [0, 4, 4, gl.RGBA8],
      [1, 2, 2, gl.RGBA8],
      [2, 1, 1, gl.RGBA8],
      [0, 272, 272, gl.RGBA8],
    ]);
  });

  it("drains upload plans and tracks page-table plus physical atlas upload stats", () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      borderTexels: 4,
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    const resource = new VirtualTextureResource(gl, manifest);

    resource.makeResident({ mip: 0, x: 1, y: 2 }, 7);
    const batch = resource.drainUploadPlan(8);

    resource.uploadPageTable(batch.plan);
    const atlasUpload = batch.plan.physicalAtlasUploads[0];
    if (atlasUpload === undefined) throw new Error("expected physical atlas upload");
    resource.uploadPhysicalAtlasPage(atlasUpload, new Uint8Array(atlasUpload.byteLength));

    expect(batch.frame).toBe(8);
    expect(batch.plan.uploadCount).toBe(2);
    expect(resource.uploadStats).toEqual({
      bytesUploaded: 4 + 136 * 136 * 4,
      dirtyBatches: 1,
      lastFrame: 8,
      lastUploadCount: 2,
      pageTableBytesUploaded: 4,
      pageTableFullRebuilds: 0,
      pageTableTexSubImageCalls: 1,
      pageTableTexelsUploaded: 1,
      physicalAtlasBytesUploaded: 136 * 136 * 4,
      physicalAtlasPagesUploaded: 1,
    });
    expect(texSubImages.map((call) => [call.level, call.xOffset, call.yOffset, call.width, call.height])).toEqual([
      [0, 1, 2, 1, 1],
      [0, 0, 0, 136, 136],
    ]);
  });

  it("returns zero from uploadFrame without page-table work when no uploads are pending", () => {
    const { boundTextures, gl } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      id: "terrain:no-op",
      pageSize: 64,
      physicalSlots: 2,
      virtualSize: [64, 64],
    });
    const resource = new VirtualTextureResource(gl, manifest);
    const bindCountBeforeUpload = boundTextures.length;
    resource.uploadPageTable = (() => {
      throw new Error("uploadPageTable should not run for no-op upload frames");
    }) as VirtualTextureResource["uploadPageTable"];

    const upload = resource.uploadFrame({ frame: 4, pageTableUploads: 8, physicalAtlasUploads: 1 });

    expect(upload).toEqual({
      bytesUploaded: 0,
      frame: 4,
      pageTableFullRebuilds: 0,
      pageTableTexSubImageCalls: 0,
      pageTableUploads: 0,
      pendingUploadCount: 0,
      physicalAtlasUploads: 0,
    });
    expect(boundTextures).toHaveLength(bindCountBeforeUpload);
    expect(resource.uploadStats).toMatchObject({
      bytesUploaded: 0,
      dirtyBatches: 1,
      lastFrame: 4,
      lastUploadCount: 0,
    });
  });

  it("resolves exact resident page requests without a separate resident-page lookup", () => {
    const { gl } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      id: "terrain:resident-fast-path",
      pageSize: 64,
      physicalSlots: 2,
      virtualSize: [64, 64],
    });
    const resource = new VirtualTextureResource(gl, manifest, {
      pageSource: () => new Uint8Array(64 * 64 * 4),
    });
    resource.makeResident({ mip: 0, x: 0, y: 0 }, 1);
    resource.runtime.lookupResidentPage = (() => {
      throw new Error("lookupResidentPage should not run for exact resident requests");
    }) as typeof resource.runtime.lookupResidentPage;

    const requested = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 2);

    expect(requested).toEqual({
      pages: [{ mip: 0, x: 0, y: 0 }],
      pending: 0,
      ready: 0,
      resident: 1,
      scheduled: 0,
    });
    expect(resource.stats().requests).toMatchObject({
      pagesRequested: 1,
      sourceRequests: 0,
    });
  });

  it("rejects physical atlas payloads with unexpected byte length and disposes textures", () => {
    const { deletedTextures, gl } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      id: "terrain:alpine",
      pageSize: 128,
      physicalSlots: 4,
      virtualSize: [512, 512],
    });
    const resource = new VirtualTextureResource(gl, manifest);

    resource.makeResident({ mip: 0, x: 0, y: 0 }, 1);
    const atlasUpload = resource.drainUploadPlan(2).plan.physicalAtlasUploads[0];
    if (atlasUpload === undefined) throw new Error("expected physical atlas upload");

    expect(() => resource.uploadPhysicalAtlasPage(atlasUpload, new Uint8Array(4))).toThrow(
      "Virtual texture physical atlas upload for m0/0/0 expected 65536 bytes, got 4",
    );
    resource.dispose();
    resource.dispose();

    expect(deletedTextures.length).toBe(2);
    expect(() => resource.drainUploadPlan(3)).toThrow("Virtual texture resource has been disposed");
  });

  it("requests generated pages, uploads bounded frame work, and exposes shader bindings", async () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const sourceRequests: string[] = [];
    const resource = createVirtualTextureResource(gl, {
      borderTexels: 2,
      id: "terrain:generated",
      pageSize: 64,
      physicalSlots: 4,
      source(request) {
        sourceRequests.push(request.pageId);
        return new Uint8Array(request.byteLength).fill(request.page.x + 1);
      },
      virtualSize: [128, 64],
    });

    const requested = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 1);
    await resource.waitForPendingRequests();
    const firstUpload = resource.uploadFrame({ frame: 2, pageTableUploads: 1, physicalAtlasUploads: 1 });
    const secondUpload = resource.uploadFrame({ frame: 3, pageTableUploads: 1, physicalAtlasUploads: 1 });
    const bindings = resource.getTextureBindings();

    expect(requested).toMatchObject({
      pages: [
        { mip: 0, x: 0, y: 0 },
        { mip: 0, x: 1, y: 0 },
      ],
      scheduled: 2,
    });
    expect(sourceRequests).toEqual(["m0/0/0", "m0/1/0"]);
    expect(firstUpload).toMatchObject({
      bytesUploaded: 68 * 68 * 4 + 4,
      pageTableFullRebuilds: 0,
      pageTableTexSubImageCalls: 1,
      pageTableUploads: 1,
      pendingUploadCount: 1,
      physicalAtlasUploads: 1,
    });
    expect(secondUpload).toMatchObject({
      bytesUploaded: 68 * 68 * 4 + 4,
      pageTableFullRebuilds: 0,
      pageTableTexSubImageCalls: 1,
      pageTableUploads: 1,
      pendingUploadCount: 0,
      physicalAtlasUploads: 1,
    });
    expect(resource.stats()).toMatchObject({
      cache: { residentPages: 2 },
      mappings: {
        exactPages: 2,
        mappedPages: 2,
      },
      requests: {
        pagesLoaded: 2,
        pendingPages: 0,
        readyPages: 0,
        sourceRequests: 2,
      },
    });
    expect(bindings).toMatchObject({
      borderTexels: 2,
      mipCount: 2,
      paddedPageSize: 68,
      pageSize: 64,
      physicalAtlasSize: [136, 136],
      slotGrid: [2, 2],
      virtualSize: [128, 64],
    });
    expect(texSubImages.map((call) => [call.width, call.height])).toEqual([
      [68, 68],
      [1, 1],
      [68, 68],
      [1, 1],
    ]);
  });

  it("maps non-power-of-two virtual sizes into footprint page requests", async () => {
    const { gl } = fakeVirtualTextureGl();
    const sourcePages: VirtualTexturePageSourceRequest[] = [];
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:npot",
      pageSize: 128,
      physicalSlots: 8,
      source(request) {
        sourcePages.push(request);
        return new Uint8Array(request.byteLength);
      },
      virtualSize: [300, 180],
    });

    const requested = resource.requestPages({ mip: 0, uMax: 0.99, uMin: 0.34, vMax: 0.99, vMin: 0 }, 4);
    await resource.waitForPendingRequests();

    expect(resource.getTextureBindings().pageTableMipDimensions).toEqual([
      { height: 2, width: 3 },
      { height: 1, width: 2 },
      { height: 1, width: 1 },
    ]);
    expect(requested.pages).toEqual([
      { mip: 0, x: 1, y: 0 },
      { mip: 0, x: 2, y: 0 },
      { mip: 0, x: 1, y: 1 },
      { mip: 0, x: 2, y: 1 },
    ]);
    expect(sourcePages.map((request) => request.pageId)).toEqual(["m0/1/0", "m0/2/0", "m0/1/1", "m0/2/1"]);
    expect(sourcePages.map((request) => request.virtualSize)).toEqual([
      [300, 180],
      [300, 180],
      [300, 180],
      [300, 180],
    ]);
  });

  it("requests pages without runtime stats scans when mappings are already large", async () => {
    const { gl } = fakeVirtualTextureGl();
    const manifest = parseVirtualTextureManifest({
      id: "terrain:request-perf",
      pageSize: 64,
      physicalSlots: 4,
      virtualSize: [2048, 2048],
    });
    const resource = new VirtualTextureResource(gl, manifest, {
      pageSource(request) {
        return new Uint8Array(request.byteLength);
      },
    });
    const rootMip = resource.runtime.mipCount - 1;

    resource.makeResident({ mip: rootMip, x: 0, y: 0 }, 10_000);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        resource.resolve({ mip: 0, x, y }, 10_000 + y * 32 + x);
      }
    }
    expect(resource.stats().mappings.mappedPages).toBe(1025);

    const originalStats = resource.runtime.stats.bind(resource.runtime);
    let requested: ReturnType<VirtualTextureResource["requestPages"]> | null = null;
    resource.runtime.stats = (() => {
      throw new Error("requestPages should not call runtime.stats");
    }) as typeof resource.runtime.stats;
    try {
      requested = resource.requestPages({ mip: 0, uMax: 1 / 32, uMin: 0, vMax: 1 / 32, vMin: 0 }, 12);
      await resource.waitForPendingRequests();
    } finally {
      resource.runtime.stats = originalStats as typeof resource.runtime.stats;
    }

    expect(requested).toMatchObject({
      pages: [{ mip: 0, x: 0, y: 0 }],
      pending: 0,
      ready: 0,
      resident: 0,
      scheduled: 1,
    });
  });

  it("rejects invalid generated page bytes without making a page resident", async () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:bad-bytes",
      pageSize: 64,
      physicalSlots: 2,
      source(request) {
        return new Uint8Array(request.byteLength - 1);
      },
      virtualSize: [64, 64],
    });

    resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 1);
    await resource.waitForPendingRequests();
    const upload = resource.uploadFrame({ frame: 2, pageTableUploads: 10, physicalAtlasUploads: 10 });

    expect(upload).toMatchObject({
      bytesUploaded: 0,
      pageTableUploads: 0,
      physicalAtlasUploads: 0,
    });
    expect(resource.stats()).toMatchObject({
      cache: { residentPages: 0 },
      requests: {
        lastError: "Virtual texture page source for m0/0/0 expected 16384 bytes, got 16383",
        pagesFailed: 1,
        pagesLoaded: 0,
      },
    });
    expect(texSubImages).toEqual([]);
  });

  it("throws high-level API calls after disposal", () => {
    const { deletedTextures, gl } = fakeVirtualTextureGl();
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:disposed",
      pageSize: 64,
      physicalSlots: 2,
      source(request) {
        return new Uint8Array(request.byteLength);
      },
      virtualSize: [64, 64],
    });

    resource.dispose();

    expect(deletedTextures.length).toBe(2);
    expect(() => resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 })).toThrow(
      "Virtual texture resource has been disposed",
    );
    expect(() => resource.uploadFrame()).toThrow("Virtual texture resource has been disposed");
    expect(() => resource.getTextureBindings()).toThrow("Virtual texture resource has been disposed");
  });

  it("bounds large footprint scheduling while counting pending, ready, and resident pages", async () => {
    const { gl } = fakeVirtualTextureGl();
    const sourceRequests: string[] = [];
    const deferredPage: {
      request?: VirtualTexturePageSourceRequest;
      resolve?: (pixels: Uint8Array) => void;
    } = {};
    const manifest = parseVirtualTextureManifest({
      id: "terrain:bounded-requests",
      pageSize: 64,
      physicalSlots: 8,
      virtualSize: [512, 512],
    });
    const resource = new VirtualTextureResource(gl, manifest, {
      pageSource(request) {
        sourceRequests.push(request.pageId);
        if (request.pageId === "m0/1/0") {
          deferredPage.request = request;
          return new Promise<Uint8Array>((resolve) => {
            deferredPage.resolve = resolve;
          });
        }
        return new Uint8Array(request.byteLength);
      },
    });
    const pageFootprint = (x: number, y: number) => ({
      mip: 0,
      uMax: (x + 1) / 8,
      uMin: x / 8,
      vMax: (y + 1) / 8,
      vMin: y / 8,
    });

    resource.requestPages(pageFootprint(0, 0), 1);
    await resource.waitForPendingRequests();
    resource.requestPages(pageFootprint(1, 0), 2);
    await Promise.resolve();
    resource.makeResident({ mip: 0, x: 2, y: 0 }, 2);

    const first = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 3);
    const second = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 4);
    const deferredRequest = deferredPage.request;
    const resolveDeferredPage = deferredPage.resolve;
    if (deferredRequest === undefined || resolveDeferredPage === undefined) {
      throw new Error("expected deferred page request");
    }
    resolveDeferredPage(new Uint8Array(deferredRequest.byteLength));
    await resource.waitForPendingRequests();

    expect(first.pages).toHaveLength(64);
    expect(first.pages.slice(0, 8)).toEqual([
      { mip: 0, x: 0, y: 0 },
      { mip: 0, x: 1, y: 0 },
      { mip: 0, x: 2, y: 0 },
      { mip: 0, x: 3, y: 0 },
      { mip: 0, x: 4, y: 0 },
      { mip: 0, x: 5, y: 0 },
      { mip: 0, x: 6, y: 0 },
      { mip: 0, x: 7, y: 0 },
    ]);
    expect(first).toMatchObject({
      pending: 1,
      ready: 1,
      resident: 1,
      scheduled: 8,
    });
    expect(second).toMatchObject({
      pending: 9,
      ready: 1,
      resident: 1,
      scheduled: 8,
    });
    expect(sourceRequests).toHaveLength(18);
    expect(new Set(sourceRequests).size).toBe(18);
    expect(sourceRequests).not.toContain("m0/2/0");
    expect(resource.stats().requests).toMatchObject({
      pagesLoaded: 18,
      pagesRequested: 130,
      pendingPages: 0,
      readyPages: 18,
      sourceRequests: 18,
    });
  });

  it("deduplicates repeated page requests while a source load is pending", async () => {
    const { gl } = fakeVirtualTextureGl();
    const sourceRequests: VirtualTexturePageSourceRequest[] = [];
    const deferredPage: { resolve?: (pixels: Uint8Array) => void } = {};
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:dedupe",
      pageSize: 64,
      physicalSlots: 2,
      source(request) {
        sourceRequests.push(request);
        return new Promise<Uint8Array>((resolve) => {
          deferredPage.resolve = resolve;
        });
      },
      virtualSize: [64, 64],
    });

    const first = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 1);
    const second = resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 2);
    await Promise.resolve();
    const sourceRequest = sourceRequests[0];
    const resolvePage = deferredPage.resolve;
    if (sourceRequest === undefined || resolvePage === undefined) throw new Error("expected pending source request");
    resolvePage(new Uint8Array(sourceRequest.byteLength));
    await resource.waitForPendingRequests();
    const upload = resource.uploadFrame({ frame: 3, pageTableUploads: 10, physicalAtlasUploads: 10 });

    expect(first).toMatchObject({ pending: 0, scheduled: 1 });
    expect(second).toMatchObject({ pending: 1, scheduled: 0 });
    expect(sourceRequests.map((request) => request.pageId)).toEqual(["m0/0/0"]);
    expect(upload).toMatchObject({
      pageTableUploads: 1,
      physicalAtlasUploads: 1,
    });
    expect(resource.stats().requests).toMatchObject({
      pagesLoaded: 1,
      sourceRequests: 1,
    });
  });

  it("records source errors without corrupting runtime residency", async () => {
    const { gl, texSubImages } = fakeVirtualTextureGl();
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:error",
      pageSize: 64,
      physicalSlots: 2,
      source() {
        throw new Error("worker failed");
      },
      virtualSize: [64, 64],
    });

    resource.requestPages({ mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 }, 1);
    await resource.waitForPendingRequests();
    const upload = resource.uploadFrame({ frame: 2, pageTableUploads: 10, physicalAtlasUploads: 10 });

    expect(upload.bytesUploaded).toBe(0);
    expect(resource.stats()).toMatchObject({
      cache: { residentPages: 0 },
      mappings: {
        dirtyEntriesPending: 0,
      },
      requests: {
        lastError: "worker failed",
        pagesFailed: 1,
        pendingPages: 0,
        readyPages: 0,
      },
    });
    expect(texSubImages).toEqual([]);
  });

  it("backs off failed page source requests instead of retrying every render", async () => {
    const { gl } = fakeVirtualTextureGl();
    const sourceRequests: string[] = [];
    const resource = createVirtualTextureResource(gl, {
      id: "terrain:missing-page",
      pageSize: 64,
      physicalSlots: 2,
      source(request) {
        sourceRequests.push(request.pageId);
        throw new Error("missing page");
      },
      virtualSize: [64, 64],
    });
    const footprint = { mip: 0, uMax: 1, uMin: 0, vMax: 1, vMin: 0 };

    const first = resource.requestPages(footprint, 1);
    await resource.waitForPendingRequests();
    const immediate = resource.requestPages(footprint, 2);
    const stillBackedOff = resource.requestPages(footprint, 30);

    expect(first).toMatchObject({
      pending: 0,
      ready: 0,
      resident: 0,
      scheduled: 1,
    });
    expect(immediate).toMatchObject({
      pending: 0,
      ready: 0,
      resident: 0,
      scheduled: 0,
    });
    expect(stillBackedOff.scheduled).toBe(0);
    expect(sourceRequests).toEqual(["m0/0/0"]);
    expect(resource.stats().requests).toMatchObject({
      lastError: "missing page",
      pagesFailed: 1,
      pendingPages: 0,
      sourceRequests: 1,
    });

    const retry = resource.requestPages(footprint, 31);
    await resource.waitForPendingRequests();
    const secondBackoff = resource.requestPages(footprint, 90);

    expect(retry.scheduled).toBe(1);
    expect(secondBackoff.scheduled).toBe(0);
    expect(sourceRequests).toEqual(["m0/0/0", "m0/0/0"]);
    expect(resource.stats().requests).toMatchObject({
      pagesFailed: 2,
      pendingPages: 0,
      sourceRequests: 2,
    });

    const secondRetry = resource.requestPages(footprint, 91);
    await resource.waitForPendingRequests();

    expect(secondRetry.scheduled).toBe(1);
    expect(sourceRequests).toEqual(["m0/0/0", "m0/0/0", "m0/0/0"]);
    expect(resource.stats().requests).toMatchObject({
      pagesFailed: 3,
      pendingPages: 0,
      sourceRequests: 3,
    });
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  directionalLight,
  imageTexture,
  mesh,
  orthographicCamera,
  planeGeometry,
  scene,
  standardMaterial,
  unlitMaterial,
  virtualTexture,
  type Material,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
  VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
  orientVirtualTextureDemandVRange,
} from "../packages/renderer-webgl/src/virtual-texture-runtime";
import {
  derivedVirtualTextureMipCount,
  encodeVirtualTexturePageTableRgba8,
  parseVirtualTextureManifest,
  VirtualTextureAtlasPageTable,
  virtualTexturePageKey,
  virtualTexturePageUri,
} from "../packages/renderer-webgl/src/virtual-texturing";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";

type FuzzPage = {
  readonly mip: number;
  readonly x: number;
  readonly y: number;
};

const fuzzPage = (random: SeededRandom): FuzzPage => ({
  mip: random.int(0, 4),
  x: random.int(0, 8),
  y: random.int(0, 8),
});

describe("WebGL virtual texturing runtime model", () => {
  it("derives complete ceil-halved mip chains for NPOT page grids", () => {
    for (const [pagesWide, pagesHigh, mipCount] of [
      [3, 1, 3],
      [5, 1, 4],
      [6, 1, 4],
      [3, 5, 4],
      [6, 3, 4],
    ] as const) {
      expect(derivedVirtualTextureMipCount(pagesWide * 64, pagesHigh * 64, 64)).toBe(mipCount);
    }
  });

  it("orients partial V demand ranges before page selection", () => {
    const oriented = orientVirtualTextureDemandVRange(0.7, 0.9, true);
    expect(oriented[0]).toBeCloseTo(0.1);
    expect(oriented[1]).toBeCloseTo(0.3);
    expect(orientVirtualTextureDemandVRange(0.7, 0.9, false)).toEqual([0.7, 0.9]);
  });

  it("parses explicit page-entry manifests into a normalized resource model", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      colorSpace: "srgb",
      id: "terrain",
      mipCount: 2,
      pageSize: 128,
      pages: {
        entries: [
          { mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
          { mip: 1, uri: "pages/mip-1/x0-y0.png", x: 0, y: 0 },
        ],
      },
      physicalSlots: 4,
      virtualSize: [512, 256],
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.manifest).toEqual(expect.objectContaining({
      colorSpace: "srgb",
      height: 256,
      mipCount: 2,
      pageSize: 128,
      physicalSlots: 4,
      width: 512,
    }));
    expect(result.manifest?.pages).toEqual([
      { mip: 0, uri: "pages/mip-0/x0-y0.png", x: 0, y: 0 },
      { mip: 1, uri: "pages/mip-1/x0-y0.png", x: 0, y: 0 },
    ]);
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 0, x: 0, y: 0 }))
      .toBe("pages/mip-0/x0-y0.png");
  });

  it("rejects explicit mip counts outside the dimension-derived chain", () => {
    for (const mipCount of [0, 4, 1.5]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        mipCount,
        pageSize: 128,
        pages: { entries: [{ mip: 0, uri: "page.png", x: 0, y: 0 }] },
        virtualSize: [512, 256],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "vt.manifest.mipCount",
        severity: "error",
      }));
    }
  });

  it("accepts the final mip of NPOT grids and bounds explicit pages at every mip", () => {
    const valid = parseVirtualTextureManifest({
      contractVersion: 1,
      pageSize: 64,
      pages: { entries: [{ mip: 3, uri: "root.png", x: 0, y: 0 }] },
      virtualSize: [192, 320],
    });
    expect(valid.manifest).toBeDefined();

    for (const entry of [
      { mip: 0, uri: "bad-x.png", x: 3, y: 0 },
      { mip: 1, uri: "bad-y.png", x: 0, y: 3 },
      { mip: 4, uri: "bad-mip.png", x: 0, y: 0 },
    ]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        pageSize: 64,
        pages: { entries: [entry] },
        virtualSize: [192, 320],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({
        code: "vt.pages.bounds",
        severity: "error",
      }));
    }
  });

  it("rejects malformed recognized optional fields and explicit page entries", () => {
    for (const [field, value, code] of [
      ["colorSpace", "display-p3", "vt.manifest.colorSpace"],
      ["physicalSlots", 0, "vt.manifest.physicalSlots"],
      ["physicalByteBudget", 1.5, "vt.manifest.physicalByteBudget"],
    ] as const) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        [field]: value,
        pageSize: 64,
        pages: { uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [128, 128],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code, severity: "error" }));
    }

    for (const entries of [
      [{ mip: 0, uri: "valid.png", x: 0, y: 0 }, { mip: 0, uri: "duplicate.png", x: 0, y: 0 }],
      [{ mip: 0, uri: "", x: 0, y: 0 }],
      { mip: 0, uri: "not-an-array.png", x: 0, y: 0 },
    ]) {
      const result = parseVirtualTextureManifest({
        contractVersion: 1,
        pageSize: 64,
        pages: { entries, uriTemplate: "{mip}/{x}/{y}.png" },
        virtualSize: [128, 128],
      });
      expect(result.manifest).toBeUndefined();
      expect(result.diagnostics.some(({ severity }) => severity === "error")).toBe(true);
    }
  });

  it("preserves deliberately sparse valid explicit manifests", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      pageSize: 64,
      pages: { entries: [{ mip: 0, uri: "one-page.png", x: 2, y: 4 }] },
      virtualSize: [192, 320],
    });
    expect(result.diagnostics).toEqual([]);
    expect(result.manifest?.pages).toEqual([{ mip: 0, uri: "one-page.png", x: 2, y: 4 }]);
  });

  it("rejects nonzero borders while preserving resource budgets", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 1,
      borderTexels: 2,
      mipCount: 3,
      pageSize: 64,
      pages: {
        entries: [{ mip: 0, uri: "pages/0.png", x: 0, y: 0 }],
      },
      physicalByteBudget: 80 * 80 * 4 * 3,
      virtualSize: [256, 128],
    });

    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "vt.manifest.borderTexels",
      severity: "unsupported",
    }));
    expect(result.manifest).toEqual(expect.objectContaining({
      mipCount: 3,
      pageSize: 64,
      physicalByteBudget: 80 * 80 * 4 * 3,
    }));
    expect(result.manifest === undefined ? undefined : virtualTexturePageUri(result.manifest, { mip: 0, x: 0, y: 0 }))
      .toBe("pages/0.png");
  });

  it("requires the supported versioned contract", () => {
    const result = parseVirtualTextureManifest({
      contractVersion: 2,
    });
    expect(result.manifest).toBeUndefined();
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: "vt.manifest.contractVersion",
      severity: "error",
    }));
  });

  it("tracks page to atlas slot mappings and dirty page-table updates incrementally", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };

    expect(table.ensureResident(first)).toEqual(expect.objectContaining({ pageKey: "0/0/0", slot: 0 }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0", slot: 0 },
    ]);

    table.ensureResident(first);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);

    expect(table.ensureResident(second)).toEqual(expect.objectContaining({ pageKey: "0/1/0", slot: 1 }));
    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBe(1);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: second, pageKey: "0/1/0", slot: 1 },
    ]);
  });

  it("publishes resident assignment only after an explicit transaction commit", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };
    const transaction = table.planResident(page);

    expect(transaction.assignment).toEqual(expect.objectContaining({ pageKey: "0/0/0", slot: 0 }));
    expect(table.residentSlot(page)).toBeUndefined();
    expect(table.residentCount).toBe(0);
    expect(table.dirtyPageTableUpdateCount).toBe(0);

    table.commitResident(transaction);
    expect(table.residentSlot(page)).toBe(0);
    expect(table.residentCount).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page, pageKey: "0/0/0", slot: 0 });
  });

  it("leaves a planned assignment unpublished when the atlas upload fails", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 1 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);
    table.takeDirtyPageTableUpdates();

    const failedUpload = table.planResident(second);
    expect(failedUpload.assignment.evicted?.pageKey).toBe("0/0/0");
    expect(() => {
      throw new Error("atlas upload failure");
    }).toThrow(/atlas upload failure/);

    expect(table.residentSlot(first)).toBe(0);
    expect(table.residentSlot(second)).toBeUndefined();
    expect(table.dirtyPageTableUpdateCount).toBe(0);

    const retry = table.planResident(second);
    expect(retry.assignment).toEqual(failedUpload.assignment);
    table.commitResident(retry);
    expect(table.residentSlot(first)).toBeUndefined();
    expect(table.residentSlot(second)).toBe(0);
  });

  it("peeks dirty updates allocation-free and acknowledges only successful page-table writes", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);
    table.ensureResident(second);

    const firstUpdate = table.dirtyPageTableUpdate(0);
    expect(firstUpdate).toEqual({ page: first, pageKey: "0/0/0", slot: 0 });
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    // A failed write does not acknowledge or reorder the front update.
    expect(table.dirtyPageTableUpdate(0)).toBe(firstUpdate);
    expect(table.dirtyPageTableUpdateCount).toBe(2);

    table.commitDirtyPageTableUpdate();
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page: second, pageKey: "0/1/0", slot: 1 });
    expect(table.dirtyPageTableUpdateCount).toBe(1);
    table.commitDirtyPageTableUpdate();
    expect(table.dirtyPageTableUpdateCount).toBe(0);
    expect(table.dirtyPageTableUpdate(0)).toBeUndefined();
    expect(() => table.commitDirtyPageTableUpdate()).toThrow(/no dirty update/);
  });

  it("keeps a planned resident transaction valid while acknowledging an older dirty update", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    table.ensureResident(first);

    const transaction = table.planResident(second);
    table.commitDirtyPageTableUpdate();
    expect(() => table.commitResident(transaction)).not.toThrow();
    expect(table.residentSlot(second)).toBe(1);
    expect(table.dirtyPageTableUpdate(0)).toEqual({ page: second, pageKey: "0/1/0", slot: 1 });
  });

  it("rejects foreign, stale, and already committed resident transactions", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const foreign = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = table.planResident({ mip: 0, x: 0, y: 0 });
    const stale = table.planResident({ mip: 0, x: 1, y: 0 });
    expect(() => foreign.commitResident(first)).toThrow(/another page table/);
    table.commitResident(first);
    expect(() => table.commitResident(first)).toThrow(/already committed/);
    expect(() => table.commitResident(stale)).toThrow(/stale/);
  });

  it("returns a touched existing assignment after the second-chance clock cleared its reference bit", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    table.ensureResident(first);
    table.ensureResident(second);
    table.takeDirtyPageTableUpdates();
    table.ensureResident(third);
    table.takeDirtyPageTableUpdates();

    const touch = table.planResident(second);
    expect(touch.assignment).toEqual(expect.objectContaining({
      pageKey: "0/1/0",
      referenceBit: true,
      slot: 1,
    }));
    table.commitResident(touch);
    expect(table.ensureResident(second)).toEqual(expect.objectContaining({ referenceBit: true, slot: 1 }));
  });

  it("selects the nearest resident parent fallback for missing pages", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 4 });
    const parent = { mip: 1, x: 1, y: 1 };
    table.ensureResident(parent);
    table.takeDirtyPageTableUpdates();

    expect(table.resolveResidentFallback({ mip: 0, x: 3, y: 2 }, { maxMip: 3 })).toEqual(
      expect.objectContaining({ page: parent, pageKey: "1/1/1", slot: 0 }),
    );
    expect(table.resolveResidentFallback({ mip: 0, x: 0, y: 0 }, { maxMip: 1 })).toBeUndefined();
  });

  it("evicts with a bounded clock policy and records invalidated page-table entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const first = { mip: 0, x: 0, y: 0 };
    const second = { mip: 0, x: 1, y: 0 };
    const third = { mip: 0, x: 2, y: 0 };
    const fourth = { mip: 0, x: 3, y: 0 };

    table.ensureResident(first);
    table.ensureResident(second);
    table.takeDirtyPageTableUpdates();

    expect(table.ensureResident(third)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: first, slot: 0 }),
      page: third,
      slot: 0,
    }));
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page: first, pageKey: "0/0/0" },
      { page: third, pageKey: "0/2/0", slot: 0 },
    ]);

    expect(table.ensureResident(fourth)).toEqual(expect.objectContaining({
      evicted: expect.objectContaining({ page: second, slot: 1 }),
      page: fourth,
      slot: 1,
    }));
    expect(table.residentSlot(first)).toBeUndefined();
    expect(table.residentSlot(second)).toBeUndefined();
    expect(table.residentSlot(third)).toBe(0);
    expect(table.residentSlot(fourth)).toBe(1);
  });

  it("protects resident parents during child uploads and downgrades evicted children to parent fallback entries", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const parent = { mip: 1, x: 0, y: 0 };
    const firstChild = { mip: 0, x: 0, y: 0 };
    const secondChild = { mip: 0, x: 1, y: 0 };
    const protectedPages = new Set([virtualTexturePageKey(parent)]);

    table.ensureResident(parent);
    table.takeDirtyPageTableUpdates();
    table.ensureResident(firstChild);
    table.takeDirtyPageTableUpdates();
    const assignment = table.ensureResident(secondChild, { protectedPages });

    expect(assignment.evicted).toEqual(expect.objectContaining({ pageKey: "0/0/0" }));
    expect(table.residentSlot(parent)).toBe(0);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      expect.objectContaining({
        fallbackPageKey: "1/0/0",
        pageKey: "0/0/0",
        residentMip: 1,
        slot: 0,
      }),
      expect.objectContaining({ pageKey: "0/1/0", slot: 1 }),
    ]);
  });

  it("keeps page-table residency bounded and slot-unique under fuzzed access", () => {
    forEachFuzzCase({
      cases: 24,
      seed: 0x73f8a91d,
    }, ({ label, random }) => {
      const slotCount = random.int(1, 9);
      const table = new VirtualTextureAtlasPageTable({ slotCount });
      const seenPages = new Map<string, FuzzPage>();

      for (let step = 0; step < 48; step += 1) {
        const page = fuzzPage(random);
        const pageKey = virtualTexturePageKey(page);
        seenPages.set(pageKey, page);

        const residentBefore = [...seenPages.entries()]
          .filter(([, candidate]) => table.residentSlot(candidate) !== undefined);
        const protectedKeys = new Set(
          residentBefore
            .filter(() => random.boolean(0.35))
            .map(([key]) => key),
        );
        const hadUnprotectedResident = residentBefore.some(([key]) => !protectedKeys.has(key));
        const assignment = table.ensureResident(page, { protectedPages: protectedKeys });

        expect(table.residentCount, `${label} step=${step} resident count`).toBeLessThanOrEqual(slotCount);
        expect(table.residentSlot(page), `${label} step=${step} resident slot`).toBe(assignment.slot);
        if (assignment.evicted !== undefined) {
          expect(
            protectedKeys.has(assignment.evicted.pageKey) && hadUnprotectedResident,
            `${label} step=${step} protected eviction`,
          ).toBe(false);
          expect(
            table.residentSlot(assignment.evicted.page),
            `${label} step=${step} evicted page cleared`,
          ).toBeUndefined();
        }

        const residentSlots = [...seenPages.values()]
          .map((candidate) => table.residentSlot(candidate))
          .filter((slot): slot is number => slot !== undefined);
        expect(
          new Set(residentSlots).size,
          `${label} step=${step} unique resident slots`,
        ).toBe(residentSlots.length);

        table.takeDirtyPageTableUpdates();
        const repeat = table.ensureResident(page);
        expect(repeat.slot, `${label} step=${step} repeat slot`).toBe(assignment.slot);
        expect(table.takeDirtyPageTableUpdates(), `${label} step=${step} repeat dirty`).toEqual([]);
      }
    });
  });

  it("encodes RGBA8 page-table entries with reserved alpha and keeps dirty updates incremental after init", () => {
    const table = new VirtualTextureAtlasPageTable({ slotCount: 2 });
    const page = { mip: 0, x: 0, y: 0 };

    expect(encodeVirtualTexturePageTableRgba8({ slot: 0 })).toEqual([1, 0, 0, 255]);
    expect(encodeVirtualTexturePageTableRgba8({ residentMip: 2, slot: 256 })).toEqual([1, 1, 2, 255]);
    expect(encodeVirtualTexturePageTableRgba8({})).toEqual([0, 0, 0, 0]);
    expect(encodeVirtualTexturePageTableRgba8({ slot: 65_534 })).toEqual([255, 255, 0, 255]);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: 65_535 })).toThrow(/0 through 65534/);
    expect(() => encodeVirtualTexturePageTableRgba8({ slot: -1 })).toThrow(/0 through 65534/);

    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([
      { page, pageKey: "0/0/0", slot: 0 },
    ]);
    table.ensureResident(page);
    expect(table.takeDirtyPageTableUpdates()).toEqual([]);
  });
});

type CanvasSize = {
  readonly height: number;
  readonly width: number;
};

type FakeCanvas = HTMLCanvasElement & {
  dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored"): Event;
  getContext: ReturnType<typeof vi.fn>;
};

type GlCall = {
  readonly args: readonly unknown[];
  readonly name: string;
  readonly result?: unknown;
};

type FakeGl = {
  readonly calls: readonly GlCall[];
  readonly gl: WebGL2RenderingContext;
};

type FetchRequest = {
  readonly reject: (reason?: unknown) => void;
  readonly resolve: (value: Response) => void;
  readonly url: string;
};

const fakeCanvas = (
  gl: WebGL2RenderingContext | null,
  size: CanvasSize = { height: 128, width: 128 },
): FakeCanvas => {
  const target = new EventTarget();
  const canvas = {
    addEventListener: target.addEventListener.bind(target),
    get clientHeight() {
      return size.height;
    },
    get clientWidth() {
      return size.width;
    },
    getBoundingClientRect: vi.fn(() => ({
      bottom: size.height,
      height: size.height,
      left: 0,
      right: size.width,
      top: 0,
      width: size.width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })),
    getContext: vi.fn((contextId: string) => (contextId === "webgl2" ? gl : null)),
    dispatchContextEvent(type: "webglcontextlost" | "webglcontextrestored") {
      const event = new Event(type, { cancelable: true });
      target.dispatchEvent(event);
      return event;
    },
    height: 0,
    removeEventListener: target.removeEventListener.bind(target),
    width: 0,
  };

  if (gl !== null) {
    (gl as unknown as { canvas: HTMLCanvasElement }).canvas = canvas as unknown as HTMLCanvasElement;
  }

  return canvas as unknown as FakeCanvas;
};

const fakeGl = (options: {
  readonly atlasUploadFailure?: { enabled: boolean };
  readonly maxTextureImageUnits?: number;
  readonly maxTextureSize?: number;
  readonly pageTableUploadFailure?: { enabled: boolean; error?: unknown };
} = {}): FakeGl => {
  const calls: GlCall[] = [];
  let nextHandleId = 1;
  const uniforms = new Map<string, WebGLUniformLocation>();
  const constants = {
    ACTIVE_ATTRIBUTES: 0x8B89,
    ACTIVE_TEXTURE: 0x84E0,
    ACTIVE_UNIFORMS: 0x8B86,
    ARRAY_BUFFER: 0x8892,
    BLEND: 0x0BE2,
    CLAMP_TO_EDGE: 0x812F,
    COLOR_BUFFER_BIT: 0x4000,
    COMPILE_STATUS: 0x8B81,
    DEPTH_BUFFER_BIT: 0x0100,
    DEPTH_TEST: 0x0B71,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    FRAGMENT_SHADER: 0x8B30,
    LEQUAL: 0x0203,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    LINK_STATUS: 0x8B82,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872,
    MAX_TEXTURE_SIZE: 0x0D33,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    ONE: 1,
    ONE_MINUS_SRC_ALPHA: 0x0303,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    RGBA8: 0x8058,
    SRGB8_ALPHA8: 0x8C43,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_CUBE_MAP: 0x8513,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MAX_LEVEL: 0x813D,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT: 0x1403,
    VERTEX_SHADER: 0x8B31,
  } as const;

  const handle = <Handle>(kind: string): Handle =>
    ({ id: nextHandleId++, kind }) as Handle;

  const uniform = (name: string): WebGLUniformLocation => {
    const existing = uniforms.get(name);
    if (existing !== undefined) return existing;
    const location = { kind: "uniform", name } as unknown as WebGLUniformLocation;
    uniforms.set(name, location);
    return location;
  };

  const record = <Arguments extends readonly unknown[]>(
    name: string,
    implementation?: (...args: Arguments) => unknown,
  ) => vi.fn((...args: Arguments) => {
    const result = implementation?.(...args);
    const capturedArgs = args.map((arg) => arg instanceof Uint8Array ? arg.slice() : arg) as unknown as Arguments;
    calls.push(result === undefined ? { args: capturedArgs, name } : { args: capturedArgs, name, result });
    return result;
  });

  const glTarget = {
    ...constants,
    activeTexture: record("activeTexture"),
    attachShader: record("attachShader"),
    bindAttribLocation: record("bindAttribLocation"),
    bindBuffer: record("bindBuffer"),
    bindTexture: record("bindTexture"),
    bindVertexArray: record("bindVertexArray"),
    blendEquationSeparate: record("blendEquationSeparate"),
    blendFunc: record("blendFunc"),
    bufferData: record("bufferData"),
    clear: record("clear"),
    clearColor: record("clearColor"),
    clearDepth: record("clearDepth"),
    colorMask: record("colorMask"),
    compileShader: record("compileShader"),
    createBuffer: record("createBuffer", () => handle<WebGLBuffer>("buffer")),
    createProgram: record("createProgram", () => handle<WebGLProgram>("program")),
    createShader: record("createShader", () => handle<WebGLShader>("shader")),
    createTexture: record("createTexture", () => handle<WebGLTexture>("texture")),
    createVertexArray: record("createVertexArray", () => handle<WebGLVertexArrayObject>("vertex-array")),
    deleteBuffer: record("deleteBuffer"),
    deleteProgram: record("deleteProgram"),
    deleteShader: record("deleteShader"),
    deleteTexture: record("deleteTexture"),
    deleteVertexArray: record("deleteVertexArray"),
    depthFunc: record("depthFunc"),
    depthMask: record("depthMask"),
    depthRange: record("depthRange"),
    disable: record("disable"),
    disableVertexAttribArray: record("disableVertexAttribArray"),
    drawElements: record("drawElements"),
    enable: record("enable"),
    enableVertexAttribArray: record("enableVertexAttribArray"),
    generateMipmap: record("generateMipmap"),
    getAttribLocation: record<[WebGLProgram, string]>("getAttribLocation", (_program, name) => {
      const normalized = name.toLowerCase();
      if (normalized.includes("normal")) return 1;
      if (normalized.includes("uv")) return 2;
      return 0;
    }),
    getParameter: record<[number]>("getParameter", (parameter) => {
      if (parameter === constants.MAX_TEXTURE_IMAGE_UNITS) return options.maxTextureImageUnits ?? 8;
      if (parameter === constants.MAX_TEXTURE_SIZE) return options.maxTextureSize ?? 4096;
      return 0;
    }),
    getProgramInfoLog: record("getProgramInfoLog", () => ""),
    getProgramParameter: record<[WebGLProgram, number]>("getProgramParameter", (_program, parameter) => {
      if (parameter === constants.LINK_STATUS) return true;
      if (parameter === constants.ACTIVE_ATTRIBUTES || parameter === constants.ACTIVE_UNIFORMS) return 0;
      return true;
    }),
    getShaderInfoLog: record("getShaderInfoLog", () => ""),
    getShaderParameter: record<[WebGLShader, number]>("getShaderParameter", (_shader, parameter) =>
      parameter === constants.COMPILE_STATUS),
    getUniformLocation: record<[WebGLProgram, string]>("getUniformLocation", (_program, name) => uniform(name)),
    linkProgram: record("linkProgram"),
    pixelStorei: record("pixelStorei"),
    shaderSource: record("shaderSource"),
    texImage2D: record("texImage2D"),
    texParameteri: record("texParameteri"),
    texStorage2D: record("texStorage2D"),
    texSubImage2D: record<readonly unknown[]>("texSubImage2D", (...args) => {
      const payload = args[8];
      const pageTableUpload = ArrayBuffer.isView(payload) && !(payload instanceof DataView);
      if (pageTableUpload && options.pageTableUploadFailure?.enabled === true) {
        throw "error" in options.pageTableUploadFailure
          ? options.pageTableUploadFailure.error
          : new Error("page table upload failure");
      }
      if (!pageTableUpload && options.atlasUploadFailure?.enabled === true) {
        throw new Error("atlas upload failure");
      }
    }),
    uniform1f: record("uniform1f"),
    uniform1i: record("uniform1i"),
    uniform2fv: record("uniform2fv"),
    uniform3fv: record("uniform3fv"),
    uniform4fv: record("uniform4fv"),
    uniformMatrix4fv: record("uniformMatrix4fv"),
    useProgram: record("useProgram"),
    vertexAttrib4f: record("vertexAttrib4f"),
    vertexAttribDivisor: record("vertexAttribDivisor"),
    vertexAttribPointer: record("vertexAttribPointer"),
    viewport: record("viewport"),
  };

  return {
    calls,
    gl: glTarget as unknown as WebGL2RenderingContext,
  };
};

class ControlledImage {
  static readonly instances: ControlledImage[] = [];
  static closeCalls = 0;
  static closeError: unknown;

  complete = false;
  crossOrigin: string | null = null;
  height = 4;
  naturalHeight = 4;
  naturalWidth = 4;
  onerror: OnErrorEventHandler = null;
  onload: ((this: HTMLImageElement, event: Event) => unknown) | null = null;
  width = 4;
  #decodeResolvers: Array<() => void> = [];
  #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  #src = "";

  constructor() {
    ControlledImage.instances.push(this);
  }

  get src(): string {
    return this.#src;
  }

  set src(value: string) {
    this.#src = value;
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.#listeners.get(type) ?? new Set<EventListenerOrEventListenerObject>();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  decode(): Promise<void> {
    if (this.complete) return Promise.resolve();
    return new Promise((resolve) => {
      this.#decodeResolvers.push(resolve);
    });
  }

  close(): void {
    ControlledImage.closeCalls += 1;
    if (ControlledImage.closeError !== undefined) throw ControlledImage.closeError;
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.#listeners.get(type)?.delete(listener);
  }

  settleLoad(): void {
    this.complete = true;
    this.onload?.call(this as unknown as HTMLImageElement, new Event("load"));
    for (const listener of this.#listeners.get("load") ?? []) {
      if (typeof listener === "function") {
        listener.call(this, new Event("load"));
      } else {
        listener.handleEvent(new Event("load"));
      }
    }
    for (const resolve of this.#decodeResolvers.splice(0)) resolve();
  }

  settleError(): void {
    this.onerror?.call(this as unknown as HTMLImageElement, new Event("error"));
    for (const listener of this.#listeners.get("error") ?? []) {
      if (typeof listener === "function") {
        listener.call(this, new Event("error"));
      } else {
        listener.handleEvent(new Event("error"));
      }
    }
  }
}

const installFetchQueue = (): FetchRequest[] => {
  const requests: FetchRequest[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => new Promise<Response>((resolve, reject) => {
    requests.push({
      reject,
      resolve,
      url: typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input),
    });
  })));
  return requests;
};

const installCanvas2d = (): {
  readonly canvases: Array<{
    height: number;
    readonly getContext: ReturnType<typeof vi.fn>;
    width: number;
  }>;
  readonly contexts: Array<{
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    putImageData: ReturnType<typeof vi.fn>;
  }>;
} => {
  const canvases: Array<{
    height: number;
    readonly getContext: ReturnType<typeof vi.fn>;
    width: number;
  }> = [];
  const contexts: Array<{
    clearRect: ReturnType<typeof vi.fn>;
    drawImage: ReturnType<typeof vi.fn>;
    imageSmoothingEnabled: boolean;
    imageSmoothingQuality: ImageSmoothingQuality;
    putImageData: ReturnType<typeof vi.fn>;
  }> = [];
  vi.stubGlobal("document", {
    createElement: vi.fn((tagName: string) => {
      if (tagName !== "canvas") throw new Error(`unexpected element ${tagName}`);
      const context = {
        clearRect: vi.fn(),
        drawImage: vi.fn(),
        imageSmoothingEnabled: false,
        imageSmoothingQuality: "low" as ImageSmoothingQuality,
        putImageData: vi.fn(),
      };
      const canvas = {
        height: 0,
        getContext: vi.fn((kind: string) => kind === "2d" ? context : null),
        width: 0,
      };
      contexts.push(context);
      canvases.push(canvas);
      return canvas;
    }),
  });

  return { canvases, contexts };
};

const responseJson = (body: unknown): Response => ({
  json: vi.fn(() => Promise.resolve(body)),
  ok: true,
  status: 200,
  statusText: "OK",
}) as unknown as Response;

const responseText = (url: string, text: string): Response => ({
  ok: true,
  status: 200,
  statusText: "OK",
  text: vi.fn(() => Promise.resolve(text)),
  url,
}) as unknown as Response;

const camera = () => orthographicCamera({
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [0, 0, 4],
  right: 1,
  rotation: [0, 0, 0],
  top: 1,
});

const renderScene = (
  material: Material,
  options: {
    readonly exposureEv100?: number;
    readonly planeSize?: readonly [number, number];
    readonly toneMapping?: "aces-fitted" | "linear-clamp" | "pbr-neutral";
  } = {},
) => scene({
  camera: camera(),
  nodes: [
    directionalLight({
      color: [1, 1, 1, 1],
      direction: [0, 0, -1],
    }),
    mesh({
      geometry: planeGeometry(options.planeSize ?? [2, 2]),
      material,
    }),
  ],
  clearColor: [0, 0, 0, 0],
  ...(options.exposureEv100 === undefined ? {} : { exposureEv100: options.exposureEv100 }),
  ...(options.toneMapping === undefined ? {} : { toneMapping: options.toneMapping }),
});

const renderVirtualTextureMaterials = (materials: readonly Material[]) => scene({
  camera: camera(),
  nodes: materials.map((material) => mesh({ geometry: planeGeometry([1, 1]), material })),
  clearColor: [0, 0, 0, 0],
});

const vtManifest = (physicalSlots = 2) => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [0, 1, 2].map((x) => ({ mip: 0, uri: `pages/${x}-0.png`, x, y: 0 })),
  },
  physicalSlots,
  virtualSize: [12, 4],
});

const vtSinglePageManifest = () => ({
  contractVersion: 1,
  pageSize: 4,
  pages: {
    entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }],
  },
  physicalSlots: 1,
  virtualSize: [4, 4],
});

const vtParentFallbackManifest = (physicalSlots = 3) => ({
  contractVersion: 1,
  mipCount: 2,
  pageSize: 4,
  pages: {
    entries: [
      { mip: 1, uri: "pages/m1-0-0.png", x: 0, y: 0 },
      ...[0, 1, 2].map((x) => ({ mip: 0, uri: `pages/m0-${x}-0.png`, x, y: 0 })),
    ],
  },
  physicalSlots,
  virtualSize: [12, 4],
});

const vtDenseMipManifest = (physicalSlots = 4) => ({
  contractVersion: 1,
  mipCount: 5,
  pageSize: 4,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots,
  virtualSize: [64, 64],
});

const vtZoomCycleManifest = () => ({
  contractVersion: 1,
  mipCount: 4,
  pageSize: 256,
  pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
  physicalSlots: 3,
  virtualSize: [2048, 2048],
});

const flushMicrotasks = async (): Promise<void> => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

const textureAllocations = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" && call.args.length >= 9);

const textureDataUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) => call.name === "texImage2D" || call.name === "texSubImage2D");

const textureResourceBinds = (calls: readonly GlCall[], textureTarget: number): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "bindTexture"
    && call.args[0] === textureTarget
    && call.args[1] !== null
    && call.args[1] !== undefined);

const pageUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && !ArrayBuffer.isView(call.args.at(-1)));

const pageTableUploads = (calls: readonly GlCall[]): readonly GlCall[] =>
  calls.filter((call) =>
    call.name === "texSubImage2D"
    && ArrayBuffer.isView(call.args[8])
    && !(call.args[8] instanceof DataView));

const texParameterTriples = (calls: readonly GlCall[]): readonly (readonly unknown[])[] =>
  calls
    .filter((call) => call.name === "texParameteri")
    .map((call) => call.args.slice(0, 3));

const texParameterGroups = (calls: readonly GlCall[]): readonly (readonly (readonly unknown[])[])[] => {
  const triples = texParameterTriples(calls)
    .filter((triple) => triple[0] === 0x0DE1);
  const groups: Array<readonly (readonly unknown[])[]> = [];
  for (let index = 0; index < triples.length; index += 4) {
    groups.push(triples.slice(index, index + 4));
  }
  return groups;
};

const uploadPayload = (call: GlCall): readonly number[] => {
  const payload = call.args[8];
  return ArrayBuffer.isView(payload) && !(payload instanceof DataView)
    ? Array.from(payload as Uint8Array)
    : [];
};

const pageTableUploadSummary = (call: GlCall): readonly unknown[] => [
  call.args[2],
  call.args[3],
  call.args[4],
  call.args[5],
  uploadPayload(call),
];

const imageBySrc = (fragment: string): ControlledImage | undefined =>
  ControlledImage.instances.find((image) => image.src.includes(fragment));

const settleIncompleteImages = async (size = 4): Promise<void> => {
  for (const image of ControlledImage.instances) {
    if (!image.complete) {
      image.naturalHeight = size;
      image.height = size;
      image.naturalWidth = size;
      image.width = size;
      image.settleLoad();
    }
  }
  await flushMicrotasks();
};

const uniformNames = (calls: readonly GlCall[]): readonly string[] =>
  calls
    .filter((call) => call.name === "getUniformLocation")
    .map((call) => String(call.args[1]));

const namedUniform1iValues = (calls: readonly GlCall[]): Record<string, number[]> => {
  const values: Record<string, number[]> = {};
  for (const call of calls) {
    if (call.name !== "uniform1i") continue;
    const location = call.args[0] as { readonly name?: unknown };
    if (typeof location.name !== "string") continue;
    values[location.name] = [...(values[location.name] ?? []), Number(call.args[1])];
  }
  return values;
};

const namedUniform4fvValues = (calls: readonly GlCall[]): Record<string, number[][]> => {
  const values: Record<string, number[][]> = {};
  for (const call of calls) {
    if (call.name !== "uniform4fv") continue;
    const location = call.args[0] as { readonly name?: unknown };
    if (typeof location.name !== "string") continue;
    const payload = call.args[1];
    const vector = Array.isArray(payload) || ArrayBuffer.isView(payload)
      ? Array.from(payload as ArrayLike<number>, Number)
      : [];
    values[location.name] = [...(values[location.name] ?? []), vector];
  }
  return values;
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  ControlledImage.instances.splice(0);
  ControlledImage.closeCalls = 0;
  ControlledImage.closeError = undefined;
});

describe("WebGL renderer virtual texturing integration", () => {
  it("keeps manifest transport, JSON, parse, and GPU failures distinct", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();

    const transportRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    transportRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/transport.json") })));
    fetchRequests[0]!.reject(new Error("offline"));
    await flushMicrotasks();

    const jsonRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    jsonRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/json.json") })));
    fetchRequests[1]!.resolve({
      json: vi.fn(() => Promise.reject(new SyntaxError("bad JSON"))),
      ok: true,
    } as unknown as Response);
    await flushMicrotasks();

    const parseRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    parseRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/parse.json") })));
    fetchRequests[2]!.resolve(responseJson({ contractVersion: 1 }));
    await flushMicrotasks();

    const { gl: gpuGl } = fakeGl();
    const gpuRoot = createWebGlRoot(fakeCanvas(gpuGl));
    gpuRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/gpu.json") })));
    vi.mocked(gpuGl.texImage2D).mockImplementation(() => {
      throw new Error("allocation rejected");
    });
    fetchRequests[3]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();

    expect(transportRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest transport failed: offline/);
    expect(jsonRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest JSON decode failed: bad JSON/);
    expect(parseRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest parse failed/);
    expect(gpuRoot.snapshot().diagnostics.join("\n")).toMatch(/GPU resource admission failed: allocation rejected/);
    expect(transportRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(jsonRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(parseRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(gpuRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 0, gpuAdmissionFailures: 1 });
  });

  it("uses the shared ceil-derived mip grid for NPOT root demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/npot.json") })));
    fetchRequests[0]!.resolve(responseJson({
      contractVersion: 1,
      pageSize: 4,
      pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
      physicalSlots: 1,
      virtualSize: [12, 4],
    }));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual(["/vt/pages/m2-0-0.png"]);
    root.dispose();
  });

  it.each([
    ["undersized", 3, 4],
    ["oversized", 5, 4],
  ])("rejects and closes an %s authored page before WebGL upload", async (_label, width, height) => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    const page = ControlledImage.instances[0]!;
    page.naturalWidth = width;
    page.width = width;
    page.naturalHeight = height;
    page.height = height;
    page.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(0);
    expect(ControlledImage.closeCalls).toBe(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, residentPages: 0 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/has \dx\d pixels; expected 4x4/);
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.closeCalls).toBe(1);
    root.dispose();
  });

  it("keeps retained pending pages dormant without physical resources and uploads once after explicit restore", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    expect(pageUploads(calls)).toHaveLength(0);

    canvas.dispatchContextEvent("webglcontextlost");
    const wakesWhileBlocked = requestAnimationFrame.mock.calls.length;
    root.render(graph);
    root.render(graph);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesWhileBlocked);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, residentPages: 0 });

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(requestAnimationFrame.mock.calls.length).toBeGreaterThan(wakesWhileBlocked);
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, residentPages: 1 });
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
  });

  it("uses the opted-in generated raster VT policy without manifest requests", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 512;
    ControlledImage.instances[0]!.naturalHeight = 512;
    ControlledImage.instances[0]!.naturalWidth = 512;
    ControlledImage.instances[0]!.width = 512;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPagesTarget: 5,
    }));
    expect(root.snapshot().virtualTexturing.generatedPageRequests).toBeGreaterThan(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_texture: expect.arrayContaining([0]),
      u_useTexture: expect.arrayContaining([1]),
    }));
    expect(contexts[0]?.drawImage).toHaveBeenCalled();
    expect(contexts[0]?.drawImage.mock.calls[0]).toEqual([
      ControlledImage.instances[0],
      0,
      0,
      512,
      512,
      0,
      0,
      256,
      256,
    ]);

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
    }

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedPageFailures: 0,
      generatedPagesTarget: 5,
      manifestFailures: 0,
      manifestRequests: 0,
      manifestsReady: 1,
      residentPages: expect.any(Number),
      uploadedPages: expect.any(Number),
    }));
    expect(root.snapshot().virtualTexturing.generatedPageRequests).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.residentPages).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.uploadedPageBytes).toBeGreaterThanOrEqual(256 * 256 * 4);
    expect(root.snapshot().virtualTexturing.uploadedPages).toBeGreaterThanOrEqual(1);
    expect(canvases[0]).toEqual(expect.objectContaining({ height: 256, width: 256 }));
    expect(uniformNames(calls)).toEqual(expect.arrayContaining(["u_vtAtlas", "u_vtPageTable"]));
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses the opted-in generated VT policy for direct imageTexture SVG", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("unexpected 2D canvas raster fallback");
      }),
    });
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/plain.svg") });
    const svgText = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" onload=\"alert(1)\">",
      "<script>alert(1)</script>",
      "<image href=\"javascript:alert(1)\" width=\"1\" height=\"1\"/>",
      "<rect width=\"512\" height=\"512\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene(material));
    expect(fetchRequests.some((request) => request.url === "/textures/plain.svg")).toBe(true);
    fetchRequests.find((request) => request.url === "/textures/plain.svg")!
      .resolve(responseText("/textures/plain.svg", svgText));
    await flushMicrotasks();

    expect(objectUrlBlobs).toHaveLength(1);
    const normalizedSvgText = await objectUrlBlobs[0]!.text();
    expect(normalizedSvgText).not.toContain("<script");
    expect(normalizedSvgText).not.toContain("onload=");
    expect(normalizedSvgText).not.toContain("javascript:");
    expect(ControlledImage.instances[0]?.src).toBe("blob:royal-svg-texture-1");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(fetchRequests.map((request) => request.url)).toEqual(["/textures/plain.svg"]);

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
      const generatedPageImage = ControlledImage.instances.find((image) => image.src === "blob:royal-svg-texture-2");
      generatedPageImage?.settleLoad();
      await flushMicrotasks();
    }

    expect(objectUrlBlobs.length).toBeGreaterThan(1);
    expect(await objectUrlBlobs[1]?.text()).toContain("<image href=\"data:image/svg+xml;base64,");
    expect(globalThis.document?.createElement).not.toHaveBeenCalled();
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPageFailures: 0,
      generatedPagesTarget: 5,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses generated SVG VT for direct imageTexture SVG data URIs", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-data-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => {
        throw new Error("unexpected 2D canvas raster fallback");
      }),
    });
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const svgText = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" fill=\"#0af\"/></svg>";
    const svgUri = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
    const material = unlitMaterial({ texture: imageTexture(svgUri) });

    root.render(renderScene(material));
    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    fetchRequests[0]!.resolve(responseText(svgUri, svgText));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
      const generatedPageImage = ControlledImage.instances.find((image) => image.src === "blob:royal-svg-data-texture-2");
      generatedPageImage?.settleLoad();
      await flushMicrotasks();
    }

    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    expect(objectUrlBlobs.length).toBeGreaterThan(1);
    expect(globalThis.document?.createElement).not.toHaveBeenCalled();
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPagesTarget: 5,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("bounds large generated VT page preparation work per frame", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedRasterVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/large-generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 4096;
    ControlledImage.instances[0]!.naturalHeight = 4096;
    ControlledImage.instances[0]!.naturalWidth = 4096;
    ControlledImage.instances[0]!.width = 4096;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));

    const generatedPageRequests = root.snapshot().virtualTexturing.generatedPageRequests;
    expect(generatedPageRequests).toBeGreaterThan(0);
    expect(generatedPageRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME);
    expect(generatedPageRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS);
    expect(canvases).toHaveLength(generatedPageRequests);
    expect(contexts).toHaveLength(generatedPageRequests);
    for (const canvas of canvases) {
      expect(canvas).toEqual(expect.objectContaining({ height: 256, width: 256 }));
    }
    for (const context of contexts) {
      expect(context.clearRect).toHaveBeenCalledTimes(1);
      expect(context.drawImage).toHaveBeenCalledTimes(1);
    }
  });

  it("resolves explicit virtualTexture base color through prepared VT residency without ordinary image loads", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const manifestUrl = "/vt/manifest.json";

    root.render(renderScene(unlitMaterial({ texture: virtualTexture(manifestUrl) })));

    expect(fetchRequests.map((request) => request.url)).toEqual([manifestUrl]);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(textureAllocations(calls)).toEqual([]);
    expect(textureDataUploads(calls)).toEqual([]);
    expect(textureResourceBinds(calls, gl.TEXTURE_2D)).toEqual([]);
    expect([
      ...fetchRequests.map((request) => request.url),
      ...ControlledImage.instances.map((image) => image.src),
    ]).not.toContain("/vt/pages/0-0.png");
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      manifestRequests: 1,
      preparedResidencyResolutions: 1,
    }));

    fetchRequests[0]!.resolve(responseJson(vtManifest()));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/0-0.png",
      "/vt/pages/1-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.manifestsReady).toBe(1);
  });

  it("defaults manifest and ref-unspecified VT base color to sRGB", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({
      texture: virtualTexture({ src: "/vt/manifest.json" }),
    });
    const graph = renderScene(material, { exposureEv100: 1.75, toneMapping: "aces-fitted" });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(graph);
    const uniform1i = namedUniform1iValues(calls);
    const uniform4fv = namedUniform4fvValues(calls);

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_surfaceLightCount",
      "u_toneMappingSettings",
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniform1i).toEqual(expect.objectContaining({
      u_surfaceLightCount: expect.arrayContaining([1]),
      u_unlit: expect.arrayContaining([0]),
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([1]),
      u_vtAtlas: expect.arrayContaining([0]),
      u_vtPageTable: expect.arrayContaining([1]),
    }));
    expect(uniform4fv).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 1, 1, 1]]),
      u_toneMappingSettings: expect.arrayContaining([[1, 1 / (1.2 * (2 ** 1.75)), 0, 0]]),
    }));
    expect(uniform4fv.u_color?.at(-1)).toEqual([1, 1, 1, 1]);
    expect(textureAllocations(calls).map((call) => call.args.slice(2, 7))).toEqual(expect.arrayContaining([
      [gl.SRGB8_ALPHA8, 4, 4, 0, gl.RGBA],
      [gl.RGBA8, 3, 1, 0, gl.RGBA],
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("keeps VT physical textures clamped, collapses atlas mip filters, and never generates atlas mipmaps", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          magFilter: "nearest",
          minFilter: "linear-mipmap-linear",
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterGroups(calls)[1]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterTriples(calls).filter((triple) =>
      triple[0] === gl.TEXTURE_2D
      && (triple[1] === gl.TEXTURE_WRAP_S || triple[1] === gl.TEXTURE_WRAP_T)
      && triple[2] === gl.CLAMP_TO_EDGE)).toHaveLength(4);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

  it("collapses nearest mipmap min filters to nearest for the VT atlas", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: { minFilter: "nearest-mipmap-linear" },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toContainEqual([gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST]);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

  it("rotates global request grants so fixed draw order cannot starve later virtual textures", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_unused, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    expect(fetchRequests).toHaveLength(5);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);
    for (const page of ControlledImage.instances) page.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 4 && ControlledImage.instances.length < 5; frame += 1) {
      scheduledFrames.shift()?.(frame);
      await flushMicrotasks();
    }
    expect(ControlledImage.instances).toHaveLength(5);
    ControlledImage.instances[4]!.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 3; frame += 1) root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 5, uploadedPages: 5 });
  });

  it("backs off rejected VT pages with an explicit wake and a bounded retry cap", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    const wakesBeforeFailure = requestAnimationFrame.mock.calls.length;

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesBeforeFailure);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });

    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleError();
    await flushMicrotasks();
    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    ControlledImage.instances[2]!.settleError();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 3, manifestFailures: 0 });
    vi.useRealTimers();
  });

  it("drains another desired VT page immediately when a page load rejects", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_value, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));

    root.render(renderVirtualTextureMaterials(materials));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(5);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });
    root.dispose();
  });

  it("wakes root demand draining when budget release admits a dormant VT", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { virtualTexturePhysicalByteBudget: 80 });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    root.render(renderVirtualTextureMaterials([first, second]));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    root.render(renderScene(second));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    root.dispose();
  });

  it("contains and reports a dormant allocation fault triggered by another VT's release", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { virtualTexturePhysicalByteBudget: 80 });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    root.render(renderVirtualTextureMaterials([first, second]));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    vi.mocked(gl.texImage2D).mockImplementation(() => {
      throw new Error("dormant allocation rejected");
    });

    expect(() => root.render(renderScene(second))).not.toThrow();
    const wakesAfterFailure = requestAnimationFrame.mock.calls.length;
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ gpuAdmissionFailures: 1 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(
      /GPU resource admission failed: dormant allocation rejected/,
    );
    root.render(renderScene(second));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesAfterFailure);
  });

  it("withholds VT visibility and image close until dirty page-table retry succeeds", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const pageTableUploadFailure: { enabled: boolean; error?: unknown } = { enabled: false };
    const { calls, gl } = fakeGl({ pageTableUploadFailure });
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    pageTableUploadFailure.enabled = true;
    pageTableUploadFailure.error = undefined;
    ControlledImage.closeError = new Error("close failure");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    let threw = false;
    let caught: unknown = "not-thrown";
    try {
      root.render(graph);
    } catch (error) {
      threw = true;
      caught = error;
    }
    expect(threw).toBe(true);
    expect(caught).toBeUndefined();
    expect(ControlledImage.closeCalls).toBe(0);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 0, uploadedPages: 0 });

    pageTableUploadFailure.enabled = false;
    expect(() => root.render(graph)).toThrow(ControlledImage.closeError);
    expect(ControlledImage.closeCalls).toBe(1);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 1, uploadedPages: 1 });
  });

  it("requests coarsest resident parent pages before mip-0 children", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/m1-0-0.png",
      "/vt/pages/m0-1-0.png",
      "/vt/pages/m0-0-0.png",
    ]);

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      residentPages: 1,
      shaderBinds: expect.any(Number),
      uploadedPages: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("keeps tiny screen-footprint VT demand on coarse visible mips", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }), {
      planeSize: [0.25, 0.25],
    });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toContain("/vt/pages/m4-0-0.png");
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await settleIncompleteImages();
      root.render(graph);
    }

    const pageRequests = ControlledImage.instances.map((image) => image.src);
    expect(pageRequests.some((src) => src.includes("/vt/pages/m2-"))).toBe(true);
    expect(pageRequests.some((src) => src.includes("/vt/pages/m1-") || src.includes("/vt/pages/m0-"))).toBe(false);
  });

  it("converges an oversubscribed visible working set without stable-camera eviction churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const fullView = renderScene(material);

    root.render(fullView);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages();
      root.render(fullView);
    }
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);
    const stableRequests = ControlledImage.instances.length;
    const stableUpdates = root.snapshot().virtualTexturing.pageTableUpdates;
    for (let frame = 0; frame < 8; frame += 1) root.render(fullView);
    expect(ControlledImage.instances).toHaveLength(stableRequests);
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBe(stableUpdates);
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);

    root.render(renderScene(material, { planeSize: [0.25, 0.25] }));
    expect(root.snapshot().virtualTexturing.residentPages).toBeLessThanOrEqual(3);
  });

  it("re-requests fine pages after a coarse zoom evicts them and the camera zooms back in", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/zoom.json") });
    const fineView = renderScene(material);
    const coarseView = renderScene(material, { planeSize: [1, 1] });

    root.render(fineView);
    fetchRequests[0]!.resolve(responseJson(vtZoomCycleManifest()));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    const fineRequestsBeforeZoomOut = ControlledImage.instances
      .filter((image) => image.src.includes("/pages/m0-"))
      .length;
    expect(fineRequestsBeforeZoomOut).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.residentPages).toBe(3);

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(coarseView);
    }
    expect(ControlledImage.instances.some((image) => image.src.includes("/pages/m1-"))).toBe(true);
    const updatesAfterCoarseSettle = root.snapshot().virtualTexturing.pageTableUpdates;

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    expect(ControlledImage.instances.filter((image) => image.src.includes("/pages/m0-")).length)
      .toBeGreaterThan(fineRequestsBeforeZoomOut);
    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/zoom.json"]);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({ residentPages: 3 }));
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBeGreaterThan(updatesAfterCoarseSettle);
  });

  it("expands resident parent page-table updates over covered mip-0 cells with encoded fallback offsets", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
    ]);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(pageUploads(calls)[0]?.args[0]).toBe(gl.TEXTURE_2D);
  });

  it("replaces parent mappings with exact child page-table entries as children upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    imageBySrc("m0-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [0, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("does not oversubscribe a stable parent-and-child working set", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(2)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    imageBySrc("m0-1-0")?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    expect(imageBySrc("m0-0-0")).toBeUndefined();
    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [1, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("binds VT shader resources instead of the ordinary u_texture sampler after page upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniformNames(calls)).not.toContain("u_texture");
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [gl.TEXTURE0], name: "activeTexture" }),
      expect.objectContaining({ args: [gl.TEXTURE0 + 1], name: "activeTexture" }),
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("honors logical virtual texture UV wrap modes in the VT shader uniforms", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtWrapS: expect.arrayContaining([1]),
      u_vtWrapT: expect.arrayContaining([2]),
    }));
  });

  it("defaults logical virtual texture UV wrapping to clamp-to-edge", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtFlipY: expect.arrayContaining([1]),
      u_vtWrapS: expect.arrayContaining([0]),
      u_vtWrapT: expect.arrayContaining([0]),
    }));
  });

  it("preserves explicit flipY false in virtual-texture shader orientation", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({
      texture: virtualTexture({ flipY: false, src: "/vt/manifest.json" }),
    });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(material));
    expect(namedUniform1iValues(calls).u_vtFlipY).toContain(0);
  });

  it("ignores async VT page completions after dispose", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    const beforeDisposeUploads = pageUploads(calls).length;

    root.dispose();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(beforeDisposeUploads);
    expect(calls.filter((call) => call.name === "deleteTexture")).toHaveLength(2);
    expect(root.snapshot().disposed).toBe(true);
  });

  it("falls back to diagnostic material color when explicit VT lacks sampler budget", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    root.render(graph);

    expect(ControlledImage.instances).toHaveLength(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([0]),
    }));
    expect(namedUniform4fvValues(calls)).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 0, 1, 1]]),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBe(0);
    expect(consoleWarn).toHaveBeenCalled();
  });

  it("records unsupported capability diagnostics and rejects WebGL1 contexts explicitly", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      atlasTextures: 0,
      manifestRequests: 1,
      unsupportedDraws: expect.any(Number),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(consoleWarn).toHaveBeenCalled();

    expect(() => createWebGlRoot(fakeCanvas(null))).toThrow(/webgl2/i);
  });

  it("accepts explicit standardMaterial virtualTexture as a surface base color while it loads", () => {
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(standardMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/manifest.json"]);
    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBe(0);
    expect(root.snapshot().virtualTexturing.preparedResidencyResolutions).toBe(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toMatch(/only unlit base-color virtual textures/i);
  });

  it("freezes normalized root options", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      generatedRasterVirtualTextures: true,
      virtualTexturePhysicalByteBudget: 123_456,
    });

    expect(Object.isFrozen(root.options)).toBe(true);
    expect(root.options).toMatchObject({
      alpha: true,
      antialias: true,
      generatedRasterVirtualTextures: true,
      virtualTexturePhysicalByteBudget: 123_456,
    });
    root.dispose();
  });
});

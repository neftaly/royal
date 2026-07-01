import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderRoot } from "@royal/renderer-core";
import type { MaterialVirtualTextureRuntimeStats } from "../src/material-texture-binding";

const programMocks = vi.hoisted(() => {
  const makeProgram = (name: string) => ({ program: { name } });

  return {
    createGltfProgram: vi.fn(() => makeProgram("gltf")),
    createMeshProgram: vi.fn(() => makeProgram("mesh")),
    createTextProgram: vi.fn(() => makeProgram("text")),
    createWireframeProgram: vi.fn(() => makeProgram("wireframe")),
  };
});

const renderWebGlPassMock = vi.hoisted(() => vi.fn());

vi.mock("../src/programs", () => programMocks);
vi.mock("../src/render-pipeline", () => ({
  renderWebGlPass: renderWebGlPassMock,
}));

import { createWebGlRoot } from "../src/root";

type FakeCanvas = HTMLCanvasElement & {
  readonly getContext: ReturnType<typeof vi.fn>;
};

const privateVirtualTextureStatsSymbol = Symbol.for(
  "royal.renderer-webgl.private.virtualTextureStats.v1",
);

const fakeGl = (): WebGL2RenderingContext => ({
  BACK: 0x0405,
  CULL_FACE: 0x0B44,
  DEPTH_TEST: 0x0B71,
  cullFace: vi.fn(),
  deleteBuffer: vi.fn(),
  deleteProgram: vi.fn(),
  enable: vi.fn(),
  viewport: vi.fn(),
} as unknown as WebGL2RenderingContext);

const fakeCanvas = (gl: WebGL2RenderingContext | null): FakeCanvas => ({
  getBoundingClientRect: vi.fn(() => ({
    bottom: 360,
    height: 360,
    left: 0,
    right: 640,
    top: 0,
    width: 640,
  })),
  getContext: vi.fn(() => gl),
  height: 0,
  width: 0,
} as unknown as FakeCanvas);

const scene = (): RenderRoot => ({
  children: [
    {
      camera: {
        bottom: -1,
        far: 10,
        kind: "orthographic-camera",
        left: -1,
        near: 0.1,
        position: [0, 0, 1],
        right: 1,
        rotation: [0, 0, 0],
        top: 1,
      },
      children: [],
      clearColor: [0, 0, 0, 1],
      kind: "pass",
    },
  ],
  kind: "scene",
});

const runtimeStats = (): MaterialVirtualTextureRuntimeStats => ({
  frame: 7,
  pageTableSize: [4, 2],
  requestPages: {
    pages: [{ mip: 1, x: 2, y: 3 }],
    pending: 1,
    ready: 2,
    resident: 3,
    scheduled: 4,
  },
  resource: {
    cache: {
      byMip: { mip1: 3 },
      capacity: 16,
      freeSlots: 13,
      residentPages: 3,
      slotColumns: 4,
      slotRows: 4,
    },
    mappings: {
      dirtyEntriesPending: 5,
      exactPages: 6,
      fallbackPages: 7,
      mappedPages: 8,
      residentEntries: 9,
      staleResidentReferences: 10,
      totalPages: 11,
      unmappedPages: 12,
      version: 13,
    },
    pendingUploadCount: 14,
    requests: {
      lastError: null,
      pagesFailed: 0,
      pagesLoaded: 15,
      pagesRequested: 16,
      pendingPages: 1,
      readyPages: 2,
      sourceRequests: 17,
    },
    uploads: {
      bytesUploaded: 18,
      dirtyBatches: 19,
      lastFrame: 20,
      lastUploadCount: 21,
      pageTableBytesUploaded: 22,
      pageTableFullRebuilds: 23,
      pageTableTexSubImageCalls: 24,
      pageTableTexelsUploaded: 25,
      physicalAtlasBytesUploaded: 26,
      physicalAtlasPagesUploaded: 27,
    },
  },
  selectedMip: 1,
  uploadFrame: {
    bytesUploaded: 28,
    frame: 7,
    pageTableFullRebuilds: 0,
    pageTableTexSubImageCalls: 1,
    pageTableUploads: 2,
    pendingUploadCount: 3,
    physicalAtlasUploads: 4,
  },
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__ROYAL_ENABLE_PRIVATE_VT_STATS__");
  renderWebGlPassMock.mockReset();
  for (const mock of Object.values(programMocks)) mock.mockClear();
});

describe("createWebGlRoot", () => {
  it("requires a WebGL2 context", () => {
    const canvas = fakeCanvas(null);

    expect(() => createWebGlRoot(canvas)).toThrow("WebGL2 is not available");
    expect(canvas.getContext.mock.calls).toContainEqual(["webgl2", {
      alpha: true,
    }]);
  });

  it("does not expose private virtual texture stats unless explicitly enabled", () => {
    const canvas = fakeCanvas(fakeGl());
    const root = createWebGlRoot(canvas);

    expect(privateVirtualTextureStatsSymbol in canvas).toBe(false);
    root.dispose();
  });

  it("exposes latest private virtual texture stats through a non-enumerable canvas symbol", () => {
    (globalThis as { __ROYAL_ENABLE_PRIVATE_VT_STATS__?: boolean })
      .__ROYAL_ENABLE_PRIVATE_VT_STATS__ = true;
    const canvas = fakeCanvas(fakeGl());
    const emittedStats = runtimeStats();
    renderWebGlPassMock.mockImplementation((_pass, _viewProjectionMatrix, resources) => {
      resources.onVirtualTextureRuntimeStats(emittedStats);
    });

    const root = createWebGlRoot(canvas);
    const descriptor = Object.getOwnPropertyDescriptor(canvas, privateVirtualTextureStatsSymbol);
    expect(descriptor).toMatchObject({
      configurable: true,
      enumerable: false,
    });
    expect(typeof descriptor?.value).toBe("function");

    const reader = descriptor?.value as () => unknown;
    expect(reader()).toEqual({
      cache: {
        entries: 0,
        error: 0,
        loading: 0,
        ready: 0,
      },
      frame: 0,
      lastMaterial: null,
      version: 1,
    });

    root.render(scene());

    expect(reader()).toEqual({
      cache: {
        entries: 0,
        error: 0,
        loading: 0,
        ready: 0,
      },
      frame: 1,
      lastMaterial: emittedStats,
      version: 1,
    });

    root.dispose();

    expect(Object.getOwnPropertyDescriptor(canvas, privateVirtualTextureStatsSymbol)).toBeUndefined();
  });
});

import {
  perspectiveCamera,
  planeGeometry,
  scene,
  mesh,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import type { SurfaceFrameView } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { fakeGl } from "./support/canvas-root-harness";

afterEach(() => vi.unstubAllGlobals());

describe("browser virtual texture runtime", () => {
  it("publishes one page-table revision for a frame's admitted page batch", async () => {
    const manifest = {
      borderTexels: 1,
      colorSpace: "srgb",
      contractVersion: 2,
      mipCount: 2,
      pageSize: 1,
      pages: { uriTemplate: "pages/{mip}-{x}-{y}.png" },
      physicalSlots: 8,
      virtualSize: [2, 2],
    };
    const fetchPage = vi.fn(async (input: URL | RequestInfo) => String(input).endsWith("vt.json")
      ? new Response(JSON.stringify(manifest), {
          headers: { "content-type": "application/json" },
        })
      : new Response(new Blob([new Uint8Array([1])])));
    vi.stubGlobal("document", { baseURI: "https://example.test/" });
    vi.stubGlobal("fetch", fetchPage);
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({
      close: vi.fn(),
      height: 3,
      width: 3,
    })));
    const gl = fakeGl();
    const texStorage2D = vi.fn();
    const texSubImage2D = vi.fn();
    Object.assign(gl, { texStorage2D, texSubImage2D });
    const changed = vi.fn();
    const texture = virtualTexture("https://example.test/vt.json");
    const prepared = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [mesh({
        geometry: planeGeometry(2),
        material: unlitMaterial({ texture }),
      })],
    }));
    const runtime = createBrowserVirtualTextureRuntime(
      gl,
      changed,
      new PersistentGpuBudgetOwner(),
    );
    const matrix = identityMat4();
    const view: SurfaceFrameView = {
      view: matrix,
      viewProjection: matrix,
      viewport: { height: 1024, width: 1024, x: 0, y: 0 },
    };

    runtime.setScene(prepared);
    await vi.waitFor(() => expect(runtime.snapshot(texture).state).toBe("ready"));
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    runtime.update([view]);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(3));

    runtime.update([view]);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledTimes(12));
    texSubImage2D.mockClear();
    changed.mockClear();

    runtime.update([view]);
    expect(texSubImage2D).toHaveBeenCalledTimes(5);
    expect(changed).toHaveBeenCalledTimes(1);
    const settled = runtime.update([view]);
    expect(runtime.update([view])).toBe(settled);

    runtime.dispose();
  });
});

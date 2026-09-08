import { afterEach, expect, it, vi } from "vitest";
import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { canvasRootHarness } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

afterEach(() => vi.unstubAllGlobals());

it("presents a completed VT page without camera changes or a redundant follow-up frame", async () => {
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
    String(input).endsWith(".json")
      ? JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 1, virtualSize: [128, 128], pages: { uriTemplate: "{mip}-{x}-{y}.png" } })
      : new Blob([new Uint8Array([1])]),
  )));
  let resolve!: (image: unknown) => void;
  const decode = vi.fn(() => new Promise((done) => { resolve = done; }));
  vi.stubGlobal("createImageBitmap", decode);
  const { root, canvas, callbacks, flushScheduledFrames, scheduledFailures } = canvasRootHarness();
  const texture = virtualTexture("https://example.test/vt.json");
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture }) })],
    }));
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getVirtualTextureAssetSnapshot(texture).status).toBe("ready");
      expect(decode).toHaveBeenCalledOnce();
    });
    expect(callbacks).toHaveLength(0);
    const before = root.getSnapshot().frame;
    canvas.gl.drawElements.mockClear();
    resolve({ width: 130, height: 130, close: vi.fn() });
    await waitFor(() => expect(callbacks.length).toBeGreaterThan(0));
    expect(flushScheduledFrames()).toBe(1);
    expect(root.getSnapshot().frame).toBe(before + 1);
    expect(root.getSnapshot().resources.virtualTextures).toMatchObject({ residentPages: 1, pendingPages: 0 });
    expect(canvas.gl.drawElements).toHaveBeenCalled();
    expect(callbacks).toHaveLength(0);
    expect(scheduledFailures).toEqual([]);
  } finally {
    root.dispose();
  }
});

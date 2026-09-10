import { afterEach, expect, it, vi } from "vitest";
import { directionalLight, mesh, perspectiveCamera, planeGeometry, scene, standardMaterial, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { canvasRootHarness } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

afterEach(() => vi.unstubAllGlobals());

it.each(["unlit", "standard"])("refreshes %s atlas dimensions after resizing without changing the material", async (kind) => {
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(
    String(input).endsWith(".json")
      ? JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 1, virtualSize: [1024, 1024], pages: { uriTemplate: "{mip}-{x}-{y}.png" } })
      : new Blob([new Uint8Array([1])]),
  )));
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 130, height: 130, close: vi.fn() })));
  const { root, canvas, flushScheduledFrames } = canvasRootHarness({}, {
    getUniformLocation: vi.fn((_program, name) => ({ name })),
  });
  const texture = virtualTexture("https://example.test/growing.json");
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    root.setScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 3] }),
      nodes: [mesh({ geometry: planeGeometry(2), material: kind === "unlit" ? unlitMaterial({ texture }) : standardMaterial({ texture }) }), directionalLight({ direction: [0, 0, -1] })],
    }));
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.residentPages).toBeGreaterThan(1);
      expect(root.getSnapshot().resources.virtualTextures.pendingPages).toBe(0);
    });
    const before = root.getSnapshot().resources.virtualTextures.atlasBytes;
    root.setSize({ cssWidth: 1024, cssHeight: 1024, pixelRatio: 1 });
    await waitFor(() => {
      flushScheduledFrames();
      const snapshot = root.getSnapshot().resources.virtualTextures;
      expect(snapshot.atlasBytes).toBeGreaterThan(before);
      expect(snapshot.unresidentPages).toBe(0);
      expect(snapshot.pendingPages).toBe(0);
    });
    const expectCurrentDimensions = () => {
      const dimensions = Array.from(vi.mocked(canvas.gl.uniform4fv).mock.calls.filter(([location]) =>
        (location as { name?: string }).name === "virtualSettings1").at(-1)![1]);
      expect(Number(dimensions[0]) * Number(dimensions[1]) * 4)
        .toBe(root.getSnapshot().resources.virtualTextures.atlasBytes);
    };
    expectCurrentDimensions();
    const grownBytes = root.getSnapshot().resources.virtualTextures.atlasBytes;
    clock = vi.spyOn(performance, "now").mockReturnValue(0);
    root.setSize({ cssWidth: 256, cssHeight: 256, pixelRatio: 1 });
    flushScheduledFrames();
    clock.mockReturnValue(2001);
    root.invalidate();
    await waitFor(() => {
      flushScheduledFrames();
      expect(root.getSnapshot().resources.virtualTextures.atlasBytes).toBeLessThan(grownBytes);
    });
    expectCurrentDimensions();
  } finally { root.dispose(); clock?.mockRestore(); }
});

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

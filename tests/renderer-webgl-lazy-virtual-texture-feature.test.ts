import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mesh,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import { createWebGlRoot } from "../packages/renderer-webgl/src/root";
import { camera, fakeCanvas, fakeGl } from "./renderer-webgl-working-state-runtime";

const roots = new Set<ReturnType<typeof createWebGlRoot>>();

afterEach(() => {
  for (const root of roots) root.dispose();
  roots.clear();
  vi.unstubAllGlobals();
});

describe("lazy virtual-texture feature", () => {
  it("starts authored VT work after the initial synchronous render", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return new Promise<Response>(() => undefined);
    }));
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => (
      setTimeout(() => callback(performance.now()), 0) as unknown as number
    )));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
      clearTimeout(handle);
    }));
    const texture = virtualTexture("/textures/lazy.vt.json");
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    roots.add(root);
    const graph = scene({
      camera: camera(),
      nodes: [mesh({
        geometry: planeGeometry([1, 1]),
        material: unlitMaterial({ texture }),
      })],
    });

    root.render(graph);
    expect(requests).toEqual([]);

    await import("../packages/renderer-webgl/src/virtual-texture/feature-owner");
    for (let attempt = 0; attempt < 80 && requests.length === 0; attempt += 1) {
      await Promise.resolve();
      root.render(graph);
    }

    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message)).toEqual([]);
    expect(requests).toEqual(["/textures/lazy.vt.json"]);
    expect(root.textureAssetSnapshot(texture)).toMatchObject({
      kind: "virtual",
      state: "loading",
    });
  });
});

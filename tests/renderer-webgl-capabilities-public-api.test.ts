import { describe, expect, it } from "vitest";
import {
  collectRendererCapabilityRows,
} from "@royal/renderer-webgl/capabilities";
import {
  createWebGlRoot,
} from "@royal/renderer-webgl";

describe("renderer-webgl stub public API", () => {
  it("stores rendered scenes without touching WebGL", () => {
    const canvas = {} as HTMLCanvasElement;
    const root = createWebGlRoot(canvas, { alpha: false });
    const scene = {
      children: [],
      kind: "scene",
    } as const;

    root.render(scene);

    expect(root.canvas).toBe(canvas);
    expect(root.snapshot()).toEqual({
      disposed: false,
      frame: 1,
      latestScene: scene,
      options: {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      },
    });
  });

  it("keeps capability probing deterministic while the backend is stubbed", () => {
    const result = collectRendererCapabilityRows();

    expect(result.rows).toContainEqual({
      api: "stub",
      kind: "context_version",
      version: "unknown",
      versionLabel: "Royal stub renderer",
    });
    expect(result.rows).toContainEqual(expect.objectContaining({
      capability: "webgl2",
      kind: "renderer_capability",
      source: "unprobed",
      supported: false,
    }));
    expect(result.diagnostics).toEqual([
      {
        code: "renderer_capability_stubbed",
        key: "stub",
        message: "Renderer capabilities are stubbed and do not reflect device support.",
        relation: "renderer_capability",
        severity: "info",
      },
    ]);
  });
});

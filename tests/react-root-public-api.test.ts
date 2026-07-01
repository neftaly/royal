import { describe, expect, it } from "vitest";
import { createRoot } from "@royal/react";
import {
  pass,
  perspectiveCamera,
  scene,
} from "@royal/renderer-core";

const canvas = (): HTMLCanvasElement => ({}) as HTMLCanvasElement;

const emptyScene = () => scene({
  children: [
    pass({
      camera: perspectiveCamera({
        far: 10,
        fovY: Math.PI / 3,
        near: 0.1,
        position: [0, 0, 2],
        rotation: [0, 0, 0],
      }),
      children: [],
    }),
  ],
});

describe("React root public API", () => {
  it("creates a renderer root without requiring a real WebGL context", () => {
    const root = createRoot(canvas(), {
      backend: "webgl2",
      context: {
        alpha: false,
        antialias: false,
        preserveDrawingBuffer: true,
      },
    });

    expect(root).toMatchObject({
      disposed: false,
      frame: 0,
    });

    root.render(emptyScene());
    expect(root).toMatchObject({
      disposed: false,
      frame: 1,
    });

    root.dispose();
    expect(root).toMatchObject({ disposed: true });
  });

  it("rejects rendering after disposal", () => {
    const root = createRoot(canvas());

    root.dispose();

    expect(() => root.render(emptyScene())).toThrow("disposed Royal renderer root");
  });
});

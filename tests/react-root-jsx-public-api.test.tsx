/** @jsxImportSource @royal/react */
import { describe, expect, it } from "vitest";
import { createRoot } from "@royal/react";

const canvas = (): HTMLCanvasElement => ({}) as HTMLCanvasElement;

describe("React root JSX public API", () => {
  it("renders a Royal JSX scene through the imperative root without React DOM", () => {
    const root = createRoot(canvas());

    root.render(
      <scene>
        <pass>
          <perspectiveCamera
            far={10}
            fovY={Math.PI / 3}
            near={0.1}
            position={[0, 0, 2]}
            rotation={[0, 0, 0]}
          />
        </pass>
      </scene>,
    );

    expect(root.snapshot()).toMatchObject({
      context: {
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: false,
      },
      disposed: false,
      frame: 1,
      latestScene: {
        kind: "scene",
      },
    });
  });

  it("rejects non-scene React content at the imperative root boundary", () => {
    const root = createRoot(canvas());

    expect(() => root.render("plain text")).toThrow("renderer scene");
  });
});

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
      disposed: false,
      frame: 1,
      latestScene: {
        kind: "scene",
      },
    });
  });
});

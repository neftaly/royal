/** @jsxImportSource @royal/react/renderer */
import { describe, expect, it } from "vitest";
import { createRendererRoot } from "@royal/react";
import { fakeCanvas } from "./react-test-fixtures";

describe("React root JSX public API", () => {
  it("renders a Royal JSX scene through the imperative root", () => {
    const root = createRendererRoot(fakeCanvas());

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
      frame: 1,
      latestScene: {
        children: [
          expect.objectContaining({
            kind: "pass",
          }),
        ],
        kind: "scene",
      },
    });
  });

  it("rejects non-scene React content at the imperative root boundary", () => {
    const root = createRendererRoot(fakeCanvas());

    // @ts-expect-error Imperative roots only accept Royal renderer descriptors.
    expect(() => root.render("plain text")).toThrow("renderer scene");
  });
});

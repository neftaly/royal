/** @jsxImportSource @royal/react */
import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  unlitMaterial,
} from "@royal/renderer-core";

type ReactElementLike = {
  readonly $$typeof: symbol;
  readonly props: {
    readonly children?: unknown;
  };
  readonly type: unknown;
};

const perspectiveProps = {
  far: 10,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 4] as const,
  rotation: [0, 0, 0] as const,
};

const isReactElementLike = (value: unknown): value is ReactElementLike =>
  typeof value === "object" &&
  value !== null &&
  "$$typeof" in value &&
  "props" in value &&
  "type" in value;

const Cube = () => (
  <mesh
    geometry={boxGeometry(1)}
    material={unlitMaterial({ color: [1, 0, 0, 1] })}
  />
);

describe("React Canvas renderer tree", () => {
  it("keeps renderer JSX as React elements for Canvas resolution", () => {
    const renderScene = (
      <scene>
        <pass>
          <perspectiveCamera {...perspectiveProps} />
          <Cube />
        </pass>
      </scene>
    );

    expect(isReactElementLike(renderScene)).toBe(true);
    expect(isReactElementLike(renderScene) ? renderScene.type : undefined).toBe("scene");

    const pass = isReactElementLike(renderScene)
      ? renderScene.props.children
      : undefined;
    expect(isReactElementLike(pass)).toBe(true);
    expect(isReactElementLike(pass) ? pass.type : undefined).toBe("pass");

    const passChildren = isReactElementLike(pass)
      ? pass.props.children
      : undefined;
    expect(Array.isArray(passChildren)).toBe(true);
    const child = Array.isArray(passChildren) ? passChildren[1] : undefined;
    expect(isReactElementLike(child)).toBe(true);
    expect(isReactElementLike(child) ? child.type : undefined).toBe(Cube);
  });
});

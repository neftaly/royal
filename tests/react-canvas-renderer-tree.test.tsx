/** @jsxImportSource @royal/react */
import { describe, expect, it } from "vitest";
import { textFieldHeight } from "@royal/react";
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

  it("routes boxed text controls through React primitives", () => {
    const box = { height: 0.5, left: 0.25, top: 0.5, width: 3 };
    const label = (
      <text box={box} color={[1, 1, 1, 1]}>
        Boxed label
      </text>
    );
    const input = (
      <input
        box={box}
        onValueChange={() => undefined}
        value="Controlled"
      />
    );

    expect(isReactElementLike(label)).toBe(true);
    expect(isReactElementLike(label) ? label.type : undefined).not.toBe("text");
    expect(isReactElementLike(input)).toBe(true);
    expect(isReactElementLike(input) ? input.type : undefined).not.toBe("input");
  });

  it("measures text field row height from text metrics and padding", () => {
    expect(textFieldHeight({
      lineHeight: 0.4,
      paddingY: 0.1,
      rows: 3,
    })).toBeCloseTo(1.4);
  });
});

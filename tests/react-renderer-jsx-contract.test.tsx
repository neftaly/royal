/** @jsxImportSource @royal/react/renderer */
import { describe, expect, it } from "vitest";
import { markRendererComponent } from "@royal/react";
import type { RenderObjectHandle } from "@royal/react";
import { jsx } from "@royal/react/renderer/jsx-runtime";
import {
  boxGeometry,
  perspectiveCamera,
  unlitMaterial,
} from "@royal/renderer-core";

const perspectiveProps = {
  far: 10,
  fovY: Math.PI / 3,
  near: 0.1,
  position: [0, 0, 4] as const,
  rotation: [0, 0, 0] as const,
};

const orthographicProps = {
  bottom: -1,
  far: 10,
  left: -1,
  near: 0.1,
  position: [0, 0, 4] as const,
  right: 1,
  rotation: [0, 0, 0] as const,
  top: 1,
};

const orthographicBounds = {
  bottom: -2,
  left: -3,
  right: 3,
  top: 2,
};

describe("renderer JSX contract", () => {
  it("defaults optional orthographic camera props for flat scenes", () => {
    expect(
      <orthographicCamera {...orthographicBounds} />,
    ).toEqual({
      ...orthographicBounds,
      far: 1,
      kind: "orthographic-camera",
      near: -1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    });
  });

  it("ignores empty conditional and whitespace children under scene and pass", () => {
    const showExtraPass = false;
    const showExtraNode = false;

    const renderScene = (
      <scene>
        {" \n\t "}
        {showExtraPass && (
          <pass>
            <perspectiveCamera {...perspectiveProps} />
          </pass>
        )}
        <pass>
          {"\n  "}
          {false}
          {null}
          {undefined}
          <perspectiveCamera {...perspectiveProps} />
          {showExtraNode && (
            <text color={[1, 1, 1, 1]}>
              Hidden
            </text>
          )}
          <mesh>
            <boxGeometry size={1} />
            <unlitMaterial color={[0.2, 0.4, 0.8, 1]} />
          </mesh>
          {" \n "}
        </pass>
        {false}
      </scene>
    );

    expect(renderScene).toEqual({
      children: [
        {
          camera: expect.objectContaining({ kind: "perspective-camera" }),
          children: [
            expect.objectContaining({
              geometry: { kind: "box", size: [1, 1, 1] },
              kind: "mesh",
              material: expect.objectContaining({ kind: "unlit" }),
            }),
          ],
          clearColor: [0, 0, 0, 0],
          kind: "pass",
        },
      ],
      kind: "scene",
    });
  });

  it("requires exactly one camera per pass", () => {
    expect(
      <pass>
        <perspectiveCamera {...perspectiveProps} />
      </pass>,
    ).toMatchObject({
      camera: { kind: "perspective-camera" },
      children: [],
      kind: "pass",
    });

    expect(() => (
      <pass>
        {" \n "}
        {false}
      </pass>
    )).toThrow("pass expects exactly one camera");

    expect(() => (
      <pass>
        <perspectiveCamera {...perspectiveProps} />
        <orthographicCamera {...orthographicProps} />
      </pass>
    )).toThrow("pass expects exactly one camera");

    expect(() => (
      <pass camera={perspectiveCamera(perspectiveProps)}>
        <orthographicCamera {...orthographicProps} />
      </pass>
    )).toThrow("pass expects exactly one camera");
  });

  it("accepts geometry and material children under mesh", () => {
    expect(
      <mesh>
        <boxGeometry size={[1, 2, 3]} />
        <unlitMaterial color={[0.2, 0.4, 0.8, 1]} />
      </mesh>,
    ).toMatchObject({
      geometry: {
        kind: "box",
        size: [1, 2, 3],
      },
      kind: "mesh",
      material: {
        baseColor: {
          color: [0.2, 0.4, 0.8, 1],
          kind: "solid",
        },
        kind: "unlit",
      },
    });
  });

  it("threads render object refs through mesh descriptors", () => {
    const ref: { current: RenderObjectHandle | null } = { current: null };

    expect(
      <mesh ref={ref}>
        <boxGeometry size={1} />
        <unlitMaterial color={[0.2, 0.4, 0.8, 1]} />
      </mesh>,
    ).toMatchObject({
      kind: "mesh",
      ref,
    });
  });

  it("lowers model JSX to glTF descriptors", () => {
    expect(
      <model src="/models/terrain.gltf" version="terrain-v1" />,
    ).toMatchObject({
      asset: {
        uri: "/models/terrain.gltf",
        version: "terrain-v1",
      },
      kind: "gltf",
      src: "/models/terrain.gltf",
    });
  });

  it("rejects conflicting mesh geometry and material sources", () => {
    expect(() => (
      <mesh color={[1, 1, 1, 1]} geometry={boxGeometry(1)}>
        <boxGeometry size={2} />
      </mesh>
    )).toThrow("mesh expects geometry as a prop or child, not both");

    expect(() => (
      <mesh
        geometry={boxGeometry(1)}
        material={unlitMaterial({ color: [1, 0, 0, 1] })}
      >
        <unlitMaterial color={[0, 1, 0, 1]} />
      </mesh>
    )).toThrow("mesh expects only one material source: material, material child, color, or texture");
  });

  it("requires function components to opt into renderer descriptor output", () => {
    const Cube = markRendererComponent((props: { readonly size: number }) => (
      <mesh>
        <boxGeometry size={props.size} />
        <unlitMaterial color={[1, 0, 0, 1]} />
      </mesh>
    ));
    const PlainComponent = () => (
      <mesh geometry={boxGeometry(1)} material={unlitMaterial({ color: [1, 0, 0, 1] })} />
    );

    expect(<Cube size={2} />).toMatchObject({
      geometry: {
        kind: "box",
        size: [2, 2, 2],
      },
      kind: "mesh",
    });
    expect(() => jsx(PlainComponent, null)).toThrow(
      "Royal renderer JSX components must be marked with markRendererComponent",
    );
  });

  it("does not expose virtual textures as JSX renderer nodes", () => {
    if (false) {
      // @ts-expect-error virtual textures are TextureRefs passed through texture props.
      <virtualTexture src="/textures/terrain.vt.json" />;
    }

    expect(() => jsx(
      "virtualTexture" as never,
      { src: "/textures/terrain.vt.json" },
    )).toThrow("Unsupported Royal JSX element");
  });
});

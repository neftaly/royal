/** @jsxImportSource @royal/react/renderer */
import { describe, expect, it } from "vitest";
import type { RenderObjectHandle } from "@royal/react";
import { jsx } from "@royal/react/renderer/jsx-runtime";
import {
  boxGeometry,
  perspectiveCamera,
  studioEnvironment,
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
      far: 1000,
      kind: "orthographic-camera",
      near: -1000,
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
          clear: "color-depth",
          clearColor: [0, 0, 0, 0],
          depthTest: true,
          kind: "pass",
        },
      ],
      kind: "scene",
    });
  });

  it("threads overlay pass clear and depth props through JSX", () => {
    expect(
      <pass clear="none" depthTest={false}>
        <perspectiveCamera {...perspectiveProps} />
      </pass>,
    ).toMatchObject({
      camera: { kind: "perspective-camera" },
      children: [],
      clear: "none",
      clearColor: [0, 0, 0, 0],
      depthTest: false,
      kind: "pass",
    });
  });

  it("threads pass environment and color mapping props through JSX", () => {
    const environment = studioEnvironment({ intensity: 1.1 });

    expect(
      <pass
        camera={perspectiveCamera(perspectiveProps)}
        environment={environment}
        exposure={0.9}
        toneMapping="aces"
      />,
    ).toMatchObject({
      camera: { kind: "perspective-camera" },
      children: [],
      environment,
      exposure: 0.9,
      kind: "pass",
      toneMapping: "aces",
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
      <model
        animation={{ clip: "idle", timeSeconds: 2.5 }}
        src="/models/terrain.gltf"
        variant="winter"
        version="terrain-v1"
      />,
    ).toMatchObject({
      animation: {
        clip: "idle",
        timeSeconds: 2.5,
      },
      asset: {
        uri: "/models/terrain.gltf",
        version: "terrain-v1",
      },
      kind: "gltf",
      src: "/models/terrain.gltf",
      variant: "winter",
    });
  });

  it("does not leak pointer handlers into renderer descriptors", () => {
    const meshDescriptor = (
      <mesh onClick={() => undefined}>
        <boxGeometry size={1} />
        <unlitMaterial color={[0.2, 0.4, 0.8, 1]} />
      </mesh>
    );
    const modelDescriptor = (
      <model
        onPointerEnter={() => undefined}
        src="/models/terrain.gltf"
      />
    );

    expect(meshDescriptor).toMatchObject({ kind: "mesh" });
    expect(meshDescriptor).not.toHaveProperty("onClick");
    expect(modelDescriptor).toMatchObject({ kind: "gltf" });
    expect(modelDescriptor).not.toHaveProperty("onPointerEnter");
  });

  it("rejects surface-local text boxes in renderer-only JSX", () => {
    expect(() => jsx("text", {
      box: { left: 0, top: 0, width: 1 },
      color: [1, 1, 1, 1],
      text: "Boxed text",
    })).toThrow("text box props require the @royal/react Canvas runtime");
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

  it("accepts plain function components that return renderer descriptors", () => {
    const Cube = (props: { readonly size: number }) => (
      <mesh>
        <boxGeometry size={props.size} />
        <unlitMaterial color={[1, 0, 0, 1]} />
      </mesh>
    );

    expect(<Cube size={2} />).toMatchObject({
      geometry: {
        kind: "box",
        size: [2, 2, 2],
      },
      kind: "mesh",
    });
    expect(jsx(Cube, { size: 3 })).toMatchObject({
      geometry: {
        kind: "box",
        size: [3, 3, 3],
      },
      kind: "mesh",
    });
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

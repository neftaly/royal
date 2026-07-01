import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
} from "@royal/renderer-core";
import * as reactRoyal from "@royal/react";
import { jsx } from "@royal/react/jsx-runtime";

describe("renderer-core public API", () => {
  it("builds plain render descriptors without backend state", () => {
    const camera = perspectiveCamera({
      far: 100,
      fovY: Math.PI / 4,
      near: 0.1,
      position: [0, 0, 5],
      rotation: [0, 0, 0],
    });
    const texture = imageTexture("/crate.png");
    const cube = mesh({
      geometry: boxGeometry(1),
      material: standardMaterial({ texture }),
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const label = text({
      color: [1, 1, 1, 1],
      text: "Royal",
    });
    const root = scene({
      children: [
        pass({
          camera,
          children: [cube, label],
        }),
      ],
    });

    expect(root).toEqual({
      children: [
        {
          camera,
          children: [cube, label],
          clearColor: [0, 0, 0, 0],
          kind: "pass",
        },
      ],
      kind: "scene",
    });
    expect(cube.material.baseColor).toMatchObject({
      kind: "asset",
      uri: "/crate.png",
    });
    expect(label.layout.source).toBe("Royal");
  });

  it("keeps React as an adapter instead of a renderer-core barrel", () => {
    expect(reactRoyal).toHaveProperty("Canvas");
    expect(reactRoyal).toHaveProperty("createRoot");
    expect(reactRoyal).not.toHaveProperty("boxGeometry");
    expect(reactRoyal).not.toHaveProperty("mesh");
    expect(reactRoyal).not.toHaveProperty("text");
  });

  it("lowers Royal JSX tags into renderer descriptors", () => {
    const node = jsx("mesh", {
      color: [0.2, 0.4, 0.8, 1],
      geometry: boxGeometry([1, 2, 3]),
    });

    expect(node).toMatchObject({
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
        kind: "standard",
      },
    });
  });
});

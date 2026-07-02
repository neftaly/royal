import { describe, expect, it } from "vitest";
import {
  boxGeometry,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
} from "@royal/renderer-core";
import * as rendererCore from "@royal/renderer-core";
import * as reactRoyal from "@royal/react";
import { layoutText } from "@royal/renderer-core/text/layout";
import { textMesh } from "@royal/renderer-core/text/mesh";
import { text as textNode } from "@royal/renderer-core/text/node";
import { shapeText } from "@royal/renderer-core/text/shaping";
import { jsx } from "@royal/react/renderer/jsx-runtime";

describe("renderer-core public API", () => {
  it("defaults orthographic camera pose and depth for flat UI scenes", () => {
    expect(orthographicCamera({
      bottom: -1,
      left: -2,
      right: 2,
      top: 1,
    })).toEqual({
      bottom: -1,
      far: 1000,
      kind: "orthographic-camera",
      left: -2,
      near: -1000,
      position: [0, 0, 0],
      right: 2,
      rotation: [0, 0, 0],
      top: 1,
    });
  });

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

  it("keeps internal texture helpers out of the renderer-core barrel", () => {
    expect(rendererCore).not.toHaveProperty("virtualTextureAsset");

    if (false) {
      // @ts-expect-error virtualTextureAsset is an internal texture helper.
      rendererCore.virtualTextureAsset;
    }
  });

  it("exposes focused text API subpaths", () => {
    const shaped = shapeText({ fontSize: 1, text: "Royal" });
    const layout = layoutText({ fontSize: 1, text: "Royal" });
    const label = textNode({ color: [1, 1, 1, 1], fontSize: 1, text: "Royal" });
    const bounds: import("@royal/renderer-core/text/types").TextBounds = layout.bounds;

    expect(shaped.run.glyphs).toHaveLength(5);
    expect(layout.source).toBe("Royal");
    expect(bounds.xMax).toBeGreaterThan(bounds.xMin);
    expect(textMesh(label).indices.length).toBeGreaterThan(0);
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

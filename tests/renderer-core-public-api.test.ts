import { readFile } from "node:fs/promises";
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
import * as editableTextApi from "@royal/renderer-core/text/editable";
import * as textFontApi from "@royal/renderer-core/text/font";
import * as webglApi from "@royal/renderer-webgl";
import * as reactRoyal from "@royal/react";
import * as reactJsxRuntime from "@royal/react/jsx-runtime";
import { createTextFontFace, createTextFontFaceAsync } from "@royal/renderer-core/text/font";
import { layoutText } from "@royal/renderer-core/text/layout";
import { textMesh } from "@royal/renderer-core/text/mesh";
import { text as textNode } from "@royal/renderer-core/text/node";
import { shapeText } from "@royal/renderer-core/text/shaping";
import { loadTestTextFont, testTextFontUrl } from "./text-font-fixture";

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

  it("builds plain render descriptors without backend state", async () => {
    const font = await loadTestTextFont();
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
      font,
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
          clear: "color-depth",
          clearColor: [0, 0, 0, 0],
          depthTest: true,
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
    expect(reactRoyal).toHaveProperty("Button");
    expect(reactRoyal).toHaveProperty("Canvas");
    expect(reactRoyal).toHaveProperty("Input");
    expect(reactRoyal).toHaveProperty("Text");
    expect(reactRoyal).toHaveProperty("Textarea");
    expect(reactRoyal).toHaveProperty("createRendererRoot");
    expect(reactRoyal).toHaveProperty("useInvalidate");
    expect(reactRoyal).not.toHaveProperty("ButtonPrimitive");
    expect(reactRoyal).not.toHaveProperty("createRoot");
    expect(reactRoyal).not.toHaveProperty("markRendererComponent");
    expect(reactRoyal).not.toHaveProperty("updateOrbitPerspectiveCamera");
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

  it("keeps public facades narrow at package boundaries", () => {
    expect(Object.keys(reactJsxRuntime).sort()).toEqual(["Fragment", "jsx", "jsxs"]);
    expect(reactJsxRuntime).not.toHaveProperty("createRendererElement");
    expect(reactJsxRuntime).not.toHaveProperty("markRendererComponent");
    expect(reactJsxRuntime).not.toHaveProperty("toMesh");
    expect(reactJsxRuntime).not.toHaveProperty("toText");

    expect(textFontApi).toHaveProperty("createTextFontFace");
    expect(textFontApi).toHaveProperty("createTextFontFaceAsync");
    expect(textFontApi).not.toHaveProperty("fontForFace");
    expect(textFontApi).not.toHaveProperty("fontFaceDescriptor");
    expect(textFontApi).not.toHaveProperty("missingTextFontMessage");
    expect(textFontApi).not.toHaveProperty("textFontDescriptor");

    expect(editableTextApi).toHaveProperty("layoutEditableText");
    expect(editableTextApi).toHaveProperty("createEditableTextEditorState");
    expect(editableTextApi).not.toHaveProperty("clampTextIndex");
    expect(editableTextApi).not.toHaveProperty("nextTextIndex");
    expect(editableTextApi).not.toHaveProperty("previousTextIndex");

    expect(webglApi).toHaveProperty("createWebGlRoot");
    expect(webglApi).not.toHaveProperty("WebGlRoot");

    if (false) {
      // @ts-expect-error JSX runtime internals are not public API.
      reactJsxRuntime.createRendererElement;
      // @ts-expect-error Text font internals are not public API.
      textFontApi.fontForFace;
      // @ts-expect-error Editable string-index helpers are not public API.
      editableTextApi.clampTextIndex;
      // @ts-expect-error WebGlRoot is a factory-created handle type, not a public constructor.
      webglApi.WebGlRoot;
    }
  });

  it("throws when text is used without a real font face", () => {
    expect(() => shapeText({ fontSize: 1, text: "Royal" })).toThrow(/requires a TextFontFace/);
    expect(() => layoutText({ fontSize: 1, text: "Royal" })).toThrow(/requires a TextFontFace/);
    expect(() => textNode({ color: [1, 1, 1, 1], fontSize: 1, text: "Royal" })).toThrow(/requires a TextFontFace/);
  });

  it("exposes focused text API subpaths", async () => {
    const font = await loadTestTextFont();
    const shaped = shapeText({ font, fontSize: 1, text: "Royal" });
    const layout = layoutText({ font, fontSize: 1, text: "Royal" });
    const label = textNode({ color: [1, 1, 1, 1], font, fontSize: 1, text: "Royal" });
    const bounds: import("@royal/renderer-core/text/types").TextBounds = layout.bounds;

    expect(shaped.run.glyphs).toHaveLength(5);
    expect(layout.source).toBe("Royal");
    expect(bounds.xMax).toBeGreaterThan(bounds.xMin);
    expect(textMesh(label).indices.length).toBeGreaterThan(0);
  });

  it("loads WOFF2 text fonts through the async font API", async () => {
    const font = await createTextFontFaceAsync({
      data: await readFile(testTextFontUrl("woff2")),
      source: testTextFontUrl("woff2").pathname,
    });
    const label = textNode({
      color: [1, 1, 1, 1],
      font,
      fontSize: 1,
      text: "Royal",
    });

    expect(font.family).toBe("Atkinson Hyperlegible");
    expect(textMesh(label).indices.length).toBeGreaterThan(0);
  });

  it("keeps WOFF2 decompression out of the sync font API", async () => {
    const data = await readFile(testTextFontUrl("woff2"));

    expect(() => createTextFontFace({ data })).toThrow(/WOFF2 text fonts require createTextFontFaceAsync/);
  });

});

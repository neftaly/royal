import type { RenderRoot } from "@royal/renderer-core";
import {
  rendererRootOptionsSemanticKey,
  type RoyalRendererRoot,
} from "@royal/renderer-webgl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
  Canvas,
  createOrbitCameraController,
  createOrbitControls,
  OrbitControls,
  type CanvasProps,
  createRendererRoot,
  useCanvasPick,
  useCanvasSize,
  useGltfAssetStatus,
  useTextureAssetStatus,
  useOrbitCamera,
  useOrbitCameraView,
  useRendererLifecycle,
} from "../../packages/react/src/index";
import { selectObservedRoot } from "../../packages/react/src/observation/select-root";

const emptyScene = {
  camera: {},
  clearColor: [0, 0, 0, 0],
  kind: "scene",
  nodes: [],
} as unknown as RenderRoot;

describe("replacement React public API", () => {
  it("server-renders an ordinary canvas with stable pre-mount observation", () => {
    const Status = () => createElement("output", null, useRendererLifecycle().state);
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { "aria-label": "preview", scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain('<canvas aria-label="preview"></canvas>');
    expect(html).toContain("<output>unavailable</output>");
  });

  it("keeps Canvas an ordinary DOM boundary with explicit Royal ownership", () => {
    const props = {
      "aria-label": "preview",
      "data-testid": "royal",
      className: "viewport",
      rendererOptions: { alpha: false, antialias: true },
      scene: emptyScene,
    } satisfies CanvasProps;
    expect(createElement(Canvas, props).props).toMatchObject(props);
    expectTypeOf(createRendererRoot).toBeFunction();
    expectTypeOf(useCanvasSize).toBeFunction();
    expectTypeOf(useGltfAssetStatus).toBeFunction();
    expectTypeOf(useTextureAssetStatus).toBeFunction();
    expectTypeOf(createOrbitCameraController).toBeFunction();
    expectTypeOf(createOrbitControls).toBeFunction();
    expectTypeOf(OrbitControls).toBeFunction();
    expectTypeOf(useOrbitCamera).toBeFunction();
    expectTypeOf(useOrbitCameraView).toBeFunction();
    expectTypeOf(useCanvasPick).toBeFunction();
    expectTypeOf(useRendererLifecycle).toBeFunction();
  });

  it("server-renders exact glTF status as idle before root mount", () => {
    const Status = () => createElement("output", null, useGltfAssetStatus("/model.glb").state);
    const html = renderToStaticMarkup(createElement(
      Canvas,
      { scene: emptyScene },
      createElement(Status),
    ));
    expect(html).toContain("<output>idle</output>");
  });

  it("gives semantically equal creation options the same canvas lifetime", () => {
    expect(rendererRootOptionsSemanticKey(undefined)).toBe("11");
    expect(rendererRootOptionsSemanticKey({})).toBe("11");
    expect(rendererRootOptionsSemanticKey({ alpha: true, antialias: true })).toBe("11");
    expect(rendererRootOptionsSemanticKey({ alpha: false })).toBe("01");
    expect(rendererRootOptionsSemanticKey({ antialias: false })).toBe("10");
  });

  it("rejects option aliases and invalid values instead of guessing", () => {
    expect(() => rendererRootOptionsSemanticKey({
      antiAlias: false,
    } as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0])).toThrow(
      "unsupported field antiAlias",
    );
    expect(() => rendererRootOptionsSemanticKey({
      alpha: 1,
    } as unknown as Parameters<typeof rendererRootOptionsSemanticKey>[0])).toThrow(
      "option alpha must be a boolean",
    );
  });

  it("uses one context-or-explicit-root placement model", () => {
    const root = {} as RoyalRendererRoot;
    expect(selectObservedRoot(undefined, { root }, "useThing")).toBe(root);
    expect(selectObservedRoot(undefined, { root: null }, "useThing")).toBeNull();
    expect(selectObservedRoot(root, undefined, "useThing")).toBe(root);
    expect(() => selectObservedRoot(undefined, undefined, "useThing")).toThrow(
      "useThing must be used inside <Canvas> or receive { root }",
    );
  });
});

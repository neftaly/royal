import { expect, it } from "vitest";
import { freezeSvgViewportUnits } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-document";
import { svgRasterViewport } from "../../packages/renderer-webgl/src/virtual-texture/svg-raster-viewport";

it("freezes viewport lengths in attributes and calculations without changing CSS strings or fragment IDs", () => {
  expect(freezeSvgViewportUnits('calc(50vw - 2vh) 1e1vmin -5vmax', 200, 100))
    .toBe('calc(100px - 2px) 10px -10px');
  const literal = 'font-family:"50vw"; fill:url(#50vw); /* 50vw */';
  expect(freezeSvgViewportUnits(literal, 200, 100)).toBe(literal);
});

it.each([
  ["297mm", "210mm", 297 * 96 / 25.4, 210 * 96 / 25.4],
  ["2in", "72pt", 192, 96],
  ["200", "100", 200, 100],
  ["200", null, 200, 200 * 210 / 297],
  [null, "100", 100 * 297 / 210, 100],
  ["100%", "100%", 297, 210],
] as const)("resolves the full SVG viewport for %s × %s", async (width, height, expectedWidth, expectedHeight) => {
  const viewport = await svgRasterViewport({
    document: { documentElement: { getAttribute: (name: string) => name === "width" ? width : height } } as unknown as XMLDocument,
    viewBox: [-10, 20, 297, 210],
  });
  expect(viewport[0]).toBeCloseTo(expectedWidth);
  expect(viewport[1]).toBeCloseTo(expectedHeight);
});

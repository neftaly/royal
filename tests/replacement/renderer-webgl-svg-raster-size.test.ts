import { expect, it } from "vitest";
import { svgRasterSize } from "../../packages/renderer-webgl/src/texture/svg-raster-size";

it.each([
  ["50mm", "80mm", 600, 960],
  ["5cm", "8cm", 600, 960],
  ["1in", "2in", 305, 610],
  ["72pt", "144pt", 305, 610],
  ["6pc", "12pc", 305, 610],
  ["200Q", "320q", 600, 960],
  ["5e1mm", "+.8e2mm", 600, 960],
  ["600px", "960", 600, 960],
  ["50mm", "960px", 600, 960],
  ["1000mm", "500mm", 12000, 6000],
] as const)("sizes %s × %s independently of browser rounding", (width, height, x, y) => {
  expect(svgRasterSize(width, height, null, 188, 302)).toEqual({ width: x, height: y });
});

it("infers a missing physical dimension from viewBox aspect ratio", () => {
  expect(svgRasterSize("50mm", null, "0 0 5 8", 188, 301)).toEqual({ width: 600, height: 960 });
  expect(svgRasterSize("100%", "80mm", "0,0,5,8", 189, 302)).toEqual({ width: 600, height: 960 });
});

it("does not interpret the browser's fallback dimension as physical size", () => {
  expect(svgRasterSize("50mm", null, null, 188, 150)).toEqual({ width: 600, height: 150 });
  expect(svgRasterSize("50mm", null, null, 188, 0)).toEqual({ width: 600, height: 150 });
  expect(svgRasterSize(null, "80mm", null, 0, 302)).toEqual({ width: 300, height: 960 });
});

it("retains browser sizing for relative/CSS dimensions and dimensionless sources", () => {
  expect(svgRasterSize("100%", "auto", "0 0 5 8", 94, 150)).toEqual({ width: 94, height: 150 });
  expect(svgRasterSize(null, null, "0 0 5 8", 0, 0)).toEqual({ width: 94, height: 150 });
  expect(svgRasterSize(null, null, null, 0, 0)).toEqual({ width: 300, height: 150 });
});

it.each(["0mm", "-1mm", "1e999mm", "1e20px"])("rejects unusable declared sizes %s", width => {
  expect(() => svgRasterSize(width, "10mm", null, 0, 0)).toThrow(RangeError);
});

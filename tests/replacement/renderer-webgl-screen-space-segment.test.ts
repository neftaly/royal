import { describe, expect, it } from "vitest";
import {
  edgeMaterial,
  perspectiveCamera,
  scene,
  sceneOverlay,
  screenSpacePartition,
  screenSpaceSegment,
} from "@royal/renderer-core";
import { prepareCanonicalScreenSpaceSegmentScene } from "../../packages/renderer-webgl/src/surface/screen-space-segment-scene";
import { canvasRootHarness as harness } from "./support/canvas-root-harness";

describe("screen-space segment lowering", () => {
  it("packs endpoints once and retains only consecutive compatible runs", () => {
    const blue = edgeMaterial({ color: [0, 0.5, 1, 1], widthCssPixels: 3 });
    const equalBlue = edgeMaterial({ color: [0, 0.5, 1, 1], widthCssPixels: 3 });
    const orange = edgeMaterial({ color: [1, 0.25, 0, 1], widthCssPixels: 2 });
    const nodes = [
      screenSpaceSegment({ end: [1, 0, 0], material: blue, start: [0, 0, 0] }),
      screenSpaceSegment({ end: [1, 1, 0], material: equalBlue, start: [0, 1, 0] }),
      screenSpaceSegment({ end: [1, 2, 0], material: orange, start: [0, 2, 0] }),
      screenSpaceSegment({ end: [1, 3, 0], material: blue, start: [0, 3, 0] }),
    ];

    const prepared = prepareCanonicalScreenSpaceSegmentScene(nodes);

    expect([...prepared.endpoints]).toEqual([
      0, 0, 0, 1, 0, 0,
      0, 1, 0, 1, 1, 0,
      0, 2, 0, 1, 2, 0,
      0, 3, 0, 1, 3, 0,
    ]);
    expect(prepared.runs).toEqual([
      { count: 2, first: 0, material: blue },
      { count: 1, first: 2, material: orange },
      { count: 1, first: 3, material: blue },
    ]);
  });

  it("batches retained endpoints by consecutive edge style", () => {
    const { callbacks, canvas, root } = harness();
    const shared = edgeMaterial({ color: [0.2, 0.6, 1, 1], widthCssPixels: 4 });
    const partitioned = edgeMaterial({
      color: [1, 0.4, 0.1, 0.75],
      coverage: screenSpacePartition({ cellSizeCssPixels: 2, count: 2, index: 1 }),
      widthCssPixels: 3,
    });
    const overlay = (offset: number) => sceneOverlay({
      nodes: [
        screenSpaceSegment({ start: [offset, 0, 0], end: [1, 0, 0], material: shared }),
        screenSpaceSegment({ start: [0, 1, 0], end: [1, 1, 0], material: shared }),
        screenSpaceSegment({ start: [0, 2, 0], end: [1, 2, 0], material: partitioned }),
      ],
    });
    root.setSize({ cssHeight: 200, cssWidth: 300, pixelRatio: 2 });
    root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 3] }), nodes: [] }));
    root.setOverlay(overlay(-1));
    callbacks.shift()!();

    expect(canvas.gl.bufferData).toHaveBeenCalledWith(
      canvas.gl.ARRAY_BUFFER,
      expect.objectContaining({ byteLength: 3 * 6 * 4 }),
      canvas.gl.STATIC_DRAW,
    );
    expect(canvas.gl.drawArraysInstanced.mock.calls).toEqual([
      [canvas.gl.TRIANGLES, 0, 6, 2],
      [canvas.gl.TRIANGLES, 0, 6, 1],
    ]);
    expect(canvas.gl.uniform2f.mock.calls.some(([, x, y]) => x === 300 && y === 200))
      .toBe(true);
    expect(canvas.gl.uniform2f.mock.calls.some(([, x, y]) => x === 4 && y === 4))
      .toBe(true);
    expect(canvas.gl.activeTexture).toHaveBeenCalledWith(canvas.gl.TEXTURE0 + 12);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("startNearDistance")
      && String(source).includes("widthCssPixels"))).toBe(true);
    expect(canvas.gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes("linearToSrgb(segmentColor.rgb)"))).toBe(true);

    root.setOverlay(overlay(-2));
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
    root.invalidate();
    callbacks.shift()!();
    expect(canvas.gl.bufferData).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  appendFrameView,
  createFrameViews,
  resetFrameViews,
} from "../packages/renderer-webgl/src/frame-views";
import {
  identityMat4,
  multiplyMat4Into,
  type Mat4,
} from "../packages/renderer-webgl/src/math/mat4";
import { forEachFuzzCase } from "./fuzz";

const mat4From = (values: ArrayLike<number>): Mat4 => [
  values[0]!, values[1]!, values[2]!, values[3]!,
  values[4]!, values[5]!, values[6]!, values[7]!,
  values[8]!, values[9]!, values[10]!, values[11]!,
  values[12]!, values[13]!, values[14]!, values[15]!,
];

describe("retained frame views", () => {
  it("matches Float32 matrix multiplication while retaining warm capacity", () => {
    const frameViews = createFrameViews();

    forEachFuzzCase({ cases: 128, seed: 0x4656_4945 }, ({ random }) => {
      resetFrameViews(frameViews, null, true);
      const viewCount = random.int(1, 5);
      for (let viewIndex = 0; viewIndex < viewCount; viewIndex += 1) {
        const projection = Float32Array.from(
          random.array(16, () => random.number(-4, 4)),
        );
        const view = Float32Array.from(
          random.array(16, () => random.number(-4, 4)),
        );
        appendFrameView(
          frameViews,
          projection,
          view,
          random.int(-100, 101),
          random.int(-100, 101),
          random.int(0, 2049),
          random.int(0, 2049),
        );

        const expected = Float32Array.from(multiplyMat4Into(
          identityMat4(),
          mat4From(projection),
          mat4From(view),
        ));
        const offset = viewIndex * 16;
        for (let matrixIndex = 0; matrixIndex < 16; matrixIndex += 1) {
          expect(frameViews.viewProjections[offset + matrixIndex])
            .toBeCloseTo(expected[matrixIndex]!, 5);
        }
      }
    });

    const projections = frameViews.projections;
    const views = frameViews.views;
    const viewProjections = frameViews.viewProjections;
    const viewports = frameViews.viewports;
    resetFrameViews(frameViews, null, false);
    appendFrameView(frameViews, identityMat4(), identityMat4(), 0, 0, 1, 1);
    expect(frameViews.projections).toBe(projections);
    expect(frameViews.views).toBe(views);
    expect(frameViews.viewProjections).toBe(viewProjections);
    expect(frameViews.viewports).toBe(viewports);
  });

  it("snapshots caller matrices and rejects lossy viewports", () => {
    const frameViews = createFrameViews();
    const projection = identityMat4();
    const view = identityMat4();
    appendFrameView(frameViews, projection, view, 0, 0, 1, 1);
    projection[0] = 2;
    view[5] = 3;
    expect(frameViews.projections[0]).toBe(1);
    expect(frameViews.views[5]).toBe(1);

    expect(() => appendFrameView(frameViews, projection, view, 0.5, 0, 1, 1))
      .toThrow(/signed 32-bit integer/);
    expect(() => appendFrameView(frameViews, projection, view, 0, 0, -1, 1))
      .toThrow(/at least 1/);
    expect(() => appendFrameView(frameViews, projection, view, 0, 0, 0, 1))
      .toThrow(/width.*at least 1/);
    expect(() => appendFrameView(frameViews, projection, view, 0, 0, 1, 0))
      .toThrow(/height.*at least 1/);
  });
});

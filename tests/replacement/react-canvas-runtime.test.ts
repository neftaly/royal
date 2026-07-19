import { describe, expect, it } from "vitest";
import { selectOwnedCanvasRoot } from "../../packages/react/src/runtime/canvas";

describe("React canvas runtime ownership", () => {
  it("publishes only the live root owned by the current canvas generation", () => {
    const previousCanvas = {} as HTMLCanvasElement;
    const currentCanvas = {} as HTMLCanvasElement;
    const previousRoot = {};
    const currentRoot = {};

    expect(selectOwnedCanvasRoot(currentCanvas, currentCanvas, currentRoot, currentRoot))
      .toBe(currentRoot);
    expect(selectOwnedCanvasRoot(previousCanvas, currentCanvas, previousRoot, previousRoot))
      .toBeNull();
    expect(selectOwnedCanvasRoot(currentCanvas, currentCanvas, previousRoot, currentRoot))
      .toBeNull();
  });
});

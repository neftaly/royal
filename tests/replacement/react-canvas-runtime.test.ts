import { describe, expect, it } from "vitest";
import {
  createCanvasRootRecovery,
  selectOwnedCanvasRoot,
} from "../../packages/react/src/runtime/canvas";

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

  it("retries a lost creation only after restoration on the same canvas", () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    let retries = 0;
    const recovery = createCanvasRootRecovery(canvas, () => {
      retries += 1;
    });

    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(retries).toBe(0);

    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(true);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(retries).toBe(0);

    recovery.waitForRestore();
    expect(retries).toBe(1);

    recovery.waitForRestore();
    canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(retries).toBe(2);

    recovery.release();
    const releasedLoss = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(releasedLoss);
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(releasedLoss.defaultPrevented).toBe(false);
    expect(retries).toBe(2);
  });
});

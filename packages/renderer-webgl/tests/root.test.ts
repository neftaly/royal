import { describe, expect, it, vi } from "vitest";
import { createWebGlRoot } from "../src/root";

describe("createWebGlRoot", () => {
  it("requires a WebGL2 context", () => {
    const getContext = vi.fn(() => null);
    const canvas = { getContext } as unknown as HTMLCanvasElement;

    expect(() => createWebGlRoot(canvas)).toThrow("WebGL2 is not available");
    expect(getContext).toHaveBeenCalledWith("webgl2", {
      alpha: true,
    });
  });
});

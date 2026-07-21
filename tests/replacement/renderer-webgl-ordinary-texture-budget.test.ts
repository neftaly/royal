import { describe, expect, it } from "vitest";
import { ordinaryTextureStorageBudget } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";

describe("ordinary texture persistent storage budget", () => {
  it("keeps the general-purpose quarter reserve when scene storage is small", () => {
    expect(ordinaryTextureStorageBudget(1_000, 100)).toBe(750);
  });

  it("reserves exact heavy-scene geometry and composite storage before fitting", () => {
    expect(ordinaryTextureStorageBudget(
      268_435_456,
      97_289_244 + 23_890_464,
    )).toBe(147_255_748);
  });

  it("settles at zero when required non-texture storage exhausts the ceiling", () => {
    expect(ordinaryTextureStorageBudget(1_000, 1_500)).toBe(0);
  });
});

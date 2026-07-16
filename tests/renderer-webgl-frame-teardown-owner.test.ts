import { describe, expect, it } from "vitest";
import { WebGlFrameTeardownOwner } from "../packages/renderer-webgl/src/frame/teardown-owner";

const setup = (failures: ReadonlySet<string> = new Set(), actionable = true) => {
  const calls: string[] = [];
  const action = (name: string) => {
    calls.push(name);
    if (failures.has(name)) throw new Error(name);
  };
  const owner = new WebGlFrameTeardownOwner({
    advanceFrame: () => action("advance"),
    bindDefaultFramebuffer: () => action("framebuffer"),
    bindDefaultVertexArray: () => action("vertex-array"),
    clearArrayBuffer: () => action("array-buffer"),
    clearElementArrayBuffer: () => action("element-array-buffer"),
    consumeSurfaceSignals: () => action("surface-signals"),
    disableScissor: () => action("disable-scissor"),
    drainVirtualTextureRequests: () => action("drain-virtual-textures"),
    endClusteredLights: (frame) => action(`clustered-lights:${frame}`),
    endInstanceTransforms: (commit) => action(`instance-transforms:${commit}`),
    finalizeOrdinaryTextureIntent: (commit) => action(`ordinary-textures:${commit}`),
    finishVirtualTextures: (commit) => action(`virtual-textures:${commit}`),
    hasActionableVirtualTextureUploads: () => {
      action("check-virtual-textures");
      return actionable;
    },
    invalidate: () => action("invalidate"),
    processVirtualTextureUploads: () => action("upload-virtual-textures"),
    releaseUnusedPackets: () => action("release-packets"),
  });
  return { calls, owner };
};

describe("WebGL frame teardown owner", () => {
  it("commits a successful frame in deterministic order without per-frame actions", () => {
    const { calls, owner } = setup();

    expect(owner.finish(undefined, false, 7, true)).toBeUndefined();
    expect(calls).toEqual([
      "surface-signals",
      "instance-transforms:true",
      "release-packets",
      "clustered-lights:7",
      "virtual-textures:true",
      "upload-virtual-textures",
      "ordinary-textures:true",
      "advance",
      "drain-virtual-textures",
      "check-virtual-textures",
      "invalidate",
      "disable-scissor",
      "framebuffer",
      "vertex-array",
      "array-buffer",
      "element-array-buffer",
    ]);
  });

  it("aborts dependent commits, skips uploads, and preserves the first failure", () => {
    const { calls, owner } = setup(new Set(["surface-signals", "framebuffer"]), false);

    expect(owner.finish(undefined, false, 3, false)?.value).toEqual(new Error("surface-signals"));
    expect(calls).toEqual([
      "surface-signals",
      "instance-transforms:false",
      "release-packets",
      "clustered-lights:3",
      "virtual-textures:false",
      "ordinary-textures:false",
      "advance",
      "drain-virtual-textures",
      "check-virtual-textures",
      "framebuffer",
      "vertex-array",
      "array-buffer",
      "element-array-buffer",
    ]);
  });
});

import { describe, expect, it, vi } from "vitest";
import { unlitMaterial, virtualTexture } from "@royal/renderer-core";
import type { CpuGeometry } from "../packages/renderer-webgl/src/geometry-recipes";
import { identityMat4 } from "../packages/renderer-webgl/src/math/mat4";
import { VirtualTextureDemandOwner } from "../packages/renderer-webgl/src/virtual-texture/demand-owner";
import type { VirtualTextureGpuArena } from "../packages/renderer-webgl/src/virtual-texture/gpu-arena";
import type {
  VirtualTextureFramePublication,
  VirtualTextureRuntimeShell,
} from "../packages/renderer-webgl/src/virtual-texture/runtime-shell";
import type { VirtualTextureRuntimeState } from "../packages/renderer-webgl/src/virtual-texture/runtime";
import type { SurfaceMaterial } from "../packages/renderer-webgl/src/webgl/materials";

describe("virtual texture demand publication owner", () => {
  it("reuses one stable draw-context shape across authored sampler changes", () => {
    const owner = new VirtualTextureDemandOwner({
      consumeGpuOutcomes: () => undefined,
      ensureGpuResource: () => true,
      frame: () => 1,
      gpu: {} as VirtualTextureGpuArena,
      recordUnsupported: () => undefined,
      runtime: {} as VirtualTextureRuntimeShell,
    });
    const geometry: CpuGeometry = {
      bucketKey: "stable-demand-context",
      mode: "triangles",
      positions: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      texCoords0: new Float32Array([0, 0, 1, 0, 0.5, 1]),
      texCoords1: new Float32Array([0.1, 0.1, 0.9, 0.1, 0.5, 0.9]),
    };
    const transformed = {
      ...unlitMaterial({
        texture: virtualTexture({
          manifestUri: "/transformed.vt.json",
          sampler: { wrapS: "repeat", wrapT: "mirrored-repeat" },
        }),
      }),
      textureCoordinates: {
        baseColorTexture: { row0: [1, 0, 0, 0], row1: [0, 1, 0, 0], set: 1 },
      },
    } as SurfaceMaterial;
    const plain = unlitMaterial({ texture: virtualTexture("/plain.vt.json") });
    const model = identityMat4();
    const first = owner.drawDemandContext(
      1,
      geometry,
      transformed,
      { kind: "single", model },
      model,
      model,
      [128, 128],
    );
    const second = owner.drawDemandContext(
      1,
      geometry,
      plain,
      { kind: "single", model },
      model,
      model,
      [128, 128],
    );

    expect(second).toBe(first);
    expect(second).toMatchObject({ textureCoordinates: undefined, wrapS: undefined, wrapT: undefined });
    expect(Object.hasOwn(second!, "textureCoordinates")).toBe(true);
    expect(Object.hasOwn(second!, "wrapS")).toBe(true);
    expect(Object.hasOwn(second!, "wrapT")).toBe(true);
  });

  it("preserves the transaction failure while completing every close step", () => {
    const primary = new Error("admission failed");
    const consume = vi.fn(() => { throw new Error("outcome close failed"); });
    const schedule = vi.fn(() => { throw new Error("request schedule failed"); });
    const clearFinishedFrame = vi.fn();
    const state = { manifest: {} } as VirtualTextureRuntimeState;
    const publication: VirtualTextureFramePublication = {
      admissions: [state],
      commits: new Map(),
      demanded: new Set([state]),
    };
    const runtime = {
      clearFinishedFrame,
      finishFrame: () => publication,
      requests: { schedule },
      resources: new Map(),
    } as unknown as VirtualTextureRuntimeShell;
    const owner = new VirtualTextureDemandOwner({
      consumeGpuOutcomes: consume,
      ensureGpuResource: () => { throw primary; },
      frame: () => 1,
      gpu: {} as VirtualTextureGpuArena,
      recordUnsupported: () => undefined,
      runtime,
    });

    expect(() => owner.finishFrame(true)).toThrow(primary);
    expect(consume).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledOnce();
    expect(clearFinishedFrame).toHaveBeenCalledOnce();
  });
});

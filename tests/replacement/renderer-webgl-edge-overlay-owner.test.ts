import { edgeMaterial } from "@royal/renderer-core";
import { describe, expect, it } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import type {
  CanonicalEdgeOverlayScene,
  CanonicalEdgeSurface,
} from "../../packages/renderer-webgl/src/surface/edge-overlay-scene";
import { EdgeOverlayOwner } from "../../packages/renderer-webgl/src/surface/edge-overlay-owner";
import { ScreenSpacePartitionPatternOwner } from "../../packages/renderer-webgl/src/surface/screen-space-partition-pattern";
import type { BorrowedSurfaceGeometryMatch } from "../../packages/renderer-webgl/src/surface/surface-gpu-owner";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";

const overlayFixture = (positions: readonly number[] = [-0.5, 0.5]) => {
  const geometryIdentity = {};
  const vertexBuffer = {} as WebGLBuffer;
  const indexBuffer = {} as WebGLBuffer;
  const surfaces = positions.map((x): CanonicalEdgeSurface => {
    const model = identityMat4();
    model[12] = x;
    return {
      model,
      modelHandedness: 1,
      worldBounds: {
        max: [x + 0.2, 0.2, 0.2],
        min: [x - 0.2, -0.2, -0.2],
      },
    } as unknown as CanonicalEdgeSurface;
  });
  const matches = surfaces.map((_surface): BorrowedSurfaceGeometryMatch => ({
    resource: {
      geometry: {
        identity: geometryIdentity,
        indexBuffer,
        indexCount: 3,
        indexOffset: 0,
        indexType: 0x1401,
        key: "shared",
        vertexBuffer,
      },
      identity: {},
      instanceCount: 0,
      vertexArray: {} as WebGLVertexArrayObject,
    },
    status: "ready",
  }));
  const scene = {
    runs: [{
      material: edgeMaterial({ color: [1, 0.5, 0.1, 1], widthCssPixels: 2 }),
      occurrences: [
        { objectId: 1, surfaceIndices: [0] },
        { objectId: 2, surfaceIndices: [1] },
      ],
    }],
    surfaces,
  } as CanonicalEdgeOverlayScene;
  const matchBySurface = new Map(surfaces.map((surface, index) => [surface, matches[index]!]));
  return { matchBySurface, scene };
};

const combinedOverlayFixture = () => {
  const identities = [{}, {}];
  const buffers = identities.map(() => ({
    index: {} as WebGLBuffer,
    vertex: {} as WebGLBuffer,
  }));
  const surfaces = [-0.5, -0.5, 0.5, 0.5].map((x, index) => {
    const model = identityMat4();
    model[12] = x;
    return {
      geometry: {
        indices: new Uint8Array([0, 1, 2]),
        key: `primitive-${index % 2}`,
        positions: new Float32Array([0, 0, 0, 0.2, 0, 0, 0, 0.2, 0]),
      },
      model,
      modelHandedness: 1,
      worldBounds: {
        max: [x + 0.2, 0.2, 0.2],
        min: [x - 0.2, -0.2, -0.2],
      },
    } as unknown as CanonicalEdgeSurface;
  });
  const resources = identities.map((identity, index) => ({
    geometry: {
      identity,
      indexBuffer: buffers[index]!.index,
      indexCount: 3,
      indexOffset: 0,
      indexType: 0x1401,
      key: `primitive-${index}`,
      vertexBuffer: buffers[index]!.vertex,
    },
    identity: {},
    instanceCount: 0,
    vertexArray: {} as WebGLVertexArrayObject,
  }));
  const matches = [resources[0]!, resources[1]!, resources[0]!, resources[1]!]
    .map((resource): BorrowedSurfaceGeometryMatch => ({ resource, status: "ready" }));
  const scene = {
    runs: [{
      material: edgeMaterial({ color: [1, 0.5, 0.1, 1], widthCssPixels: 2 }),
      occurrences: [
        { objectId: 1, surfaceIndices: [0, 1] },
        { objectId: 2, surfaceIndices: [2, 3] },
      ],
    }],
    surfaces,
  } as CanonicalEdgeOverlayScene;
  const matchBySurface = new Map(surfaces.map((surface, index) => [surface, matches[index]!]));
  return { matchBySurface, scene };
};

const view = () => ({
  view: identityMat4(),
  viewProjection: identityMat4(),
  viewport: { height: 10, width: 10, x: 0, y: 0 },
});

describe("edge-overlay batch ownership", () => {
  it("uploads one retained transform block for multiple views", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    expect(owner.drawViews(
      [view(), view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).toBe(false);

    expect(gl.bufferSubData).toHaveBeenCalledOnce();
    expect(gl.bufferSubData).toHaveBeenCalledWith(
      gl.ARRAY_BUFFER,
      0,
      expect.any(Float32Array),
      0,
      68,
    );
    expect(gl.drawElementsInstanced).toHaveBeenCalledTimes(2);
    expect(gl.invalidateFramebuffer).toHaveBeenCalledTimes(2);
    expect(gl.invalidateFramebuffer).toHaveBeenNthCalledWith(
      1,
      gl.FRAMEBUFFER,
      [gl.DEPTH_ATTACHMENT],
    );
    owner.dispose();
  });

  it("restricts screen-space work to the projected overlay and pairs binary samples", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    owner.drawViews(
      [{
        ...view(),
        viewport: { height: 100, width: 100, x: 7, y: 11 },
      }],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );

    expect(gl.scissor.mock.calls).toContainEqual([12, 36, 76, 28]);
    expect(gl.scissor.mock.calls).toContainEqual([12, 38, 76, 24]);
    expect(gl.scissor.mock.calls).toContainEqual([19, 48, 76, 26]);
    const maskSampler = gl.createSampler.mock.results[0]!.value as WebGLSampler;
    const signalSampler = gl.createSampler.mock.results[1]!.value as WebGLSampler;
    expect(gl.samplerParameteri).toHaveBeenCalledWith(
      maskSampler,
      gl.TEXTURE_MIN_FILTER,
      gl.NEAREST,
    );
    expect(gl.samplerParameteri).toHaveBeenCalledWith(
      signalSampler,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR,
    );
    owner.dispose();
  });

  it("does not clear or scissor a screen-space pass that already covers the target", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    for (const surface of scene.surfaces) {
      (surface as { worldBounds: CanonicalEdgeSurface["worldBounds"] }).worldBounds = {
        max: [4, 4, 0.2],
        min: [-4, -4, -0.2],
      };
    }
    owner.setScene(scene);

    owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );

    expect(gl.clear).toHaveBeenCalledOnce();
    expect(gl.scissor).not.toHaveBeenCalled();
    owner.dispose();
  });

  it("keeps fully offscreen occurrences out of a visible view's batch", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture([-0.5, 5]);
    owner.setScene(scene);

    owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );

    expect(gl.bufferSubData).not.toHaveBeenCalled();
    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledOnce();
    owner.dispose();
  });

  it("uploads and retains one combined occurrence-major edge geometry", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = combinedOverlayFixture();
    const state = new WebGlStateOwner(gl);
    owner.setScene(scene);

    owner.drawViews(
      [view()],
      null,
      state,
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );

    expect(gl.drawElementsInstanced).toHaveBeenCalledWith(
      gl.TRIANGLES,
      6,
      gl.UNSIGNED_BYTE,
      0,
      2,
    );
    expect(gl.drawElements).not.toHaveBeenCalled();
    const createdBuffers = gl.createBuffer.mock.calls.length;
    gl.bufferData.mockClear();

    owner.drawViews(
      [view()],
      null,
      state,
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );

    expect(gl.createBuffer).toHaveBeenCalledTimes(createdBuffers);
    expect(gl.bufferData).toHaveBeenCalledOnce();
    owner.setScene(null);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(3);
    expect(budget.snapshot().retainedBytes).toBe(900);
    owner.dispose();
  });

  it("does not admit combined geometry ahead of required targets", () => {
    const gl = fakeGl();
    const targetAndTransformBytes = 10 * 10 * 9 + 2 * 17 * 4;
    const budget = new PersistentGpuBudgetOwner(targetAndTransformBytes);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = combinedOverlayFixture();
    owner.setScene(scene);

    expect(() => owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(4);
    expect(budget.snapshot()).toMatchObject({ deniedClaims: 0, retainedBytes: 900 });
    owner.dispose();
  });

  it("falls back if retained combined geometry cannot be allocated", () => {
    const gl = fakeGl();
    gl.createBuffer
      .mockReturnValueOnce({} as WebGLBuffer)
      .mockReturnValueOnce({} as WebGLBuffer)
      .mockReturnValueOnce(null);
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = combinedOverlayFixture();
    owner.setScene(scene);

    expect(() => owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(4);
    expect(budget.snapshot().retainedBytes).toBe(900);
    owner.dispose();
  });

  it("falls back to ordinary ordered draws when targets leave no batch capacity", () => {
    const gl = fakeGl();
    const targetBytes = 10 * 10 * 9;
    const budget = new PersistentGpuBudgetOwner(targetBytes);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    expect(() => owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.bufferSubData).not.toHaveBeenCalled();
    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    expect(gl.shaderSource.mock.calls.some((call) =>
      String(call[1]).includes("#define BATCHED"))).toBe(false);
    expect(budget.snapshot()).toMatchObject({ deniedClaims: 0, retainedBytes: targetBytes });
    owner.dispose();
  });

  it("releases a retained batch before a required target grows", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner(1_036);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    );
    expect(budget.snapshot().retainedBytes).toBe(1_036);

    gl.drawElements.mockClear();
    gl.drawElementsInstanced.mockClear();
    expect(() => owner.drawViews(
      [{ ...view(), viewport: { height: 10, width: 11, x: 0, y: 0 } }],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.deleteBuffer).toHaveBeenCalledOnce();
    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    expect(budget.snapshot()).toMatchObject({ deniedClaims: 0, retainedBytes: 990 });
    owner.dispose();
  });

  it.each([
    {
      fail(gl: ReturnType<typeof fakeGl>) {
        gl.createBuffer.mockReturnValue(null);
      },
      label: "buffer allocation",
    },
    {
      fail(gl: ReturnType<typeof fakeGl>) {
        gl.createVertexArray
          .mockReturnValueOnce({} as WebGLVertexArrayObject)
          .mockReturnValueOnce(null);
      },
      label: "vertex-array allocation",
    },
  ])("falls back to ordinary ordered draws after $label failure", ({ fail }) => {
    const gl = fakeGl();
    fail(gl);
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    expect(() => owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.bufferSubData).not.toHaveBeenCalled();
    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("falls back if the optional batch shader cannot link", () => {
    const gl = fakeGl();
    gl.getProgramParameter.mockImplementation(() =>
      gl.createProgram.mock.calls.length < 5);
    const budget = new PersistentGpuBudgetOwner(1_000_000);
    const owner = new EdgeOverlayOwner(
      gl,
      budget,
      new ScreenSpacePartitionPatternOwner(gl, budget),
    );
    const { matchBySurface, scene } = overlayFixture();
    owner.setScene(scene);

    expect(() => owner.drawViews(
      [view()],
      null,
      new WebGlStateOwner(gl),
      1,
      1,
      (surface) => matchBySurface.get(surface)!,
    )).not.toThrow();

    expect(gl.drawElementsInstanced).not.toHaveBeenCalled();
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    expect(gl.deleteProgram).toHaveBeenCalledOnce();
    owner.dispose();
  });
});

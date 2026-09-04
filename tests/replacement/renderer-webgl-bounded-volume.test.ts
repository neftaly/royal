import {
  boundedVolume,
  boxGeometry,
  perspectiveCamera,
  scene,
  triangleGeometry,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { BoundedVolumeGpuOwner } from "../../packages/renderer-webgl/src/surface/bounded-volume-gpu-owner";
import { boundedVolumePresentationMode } from "../../packages/renderer-webgl/src/surface/bounded-volume-presentation-plan";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { WebGlStateOwner } from "../../packages/renderer-webgl/src/webgl/state-owner";
import { fakeGl } from "./support/canvas-root-harness";

const tetrahedron = () => triangleGeometry({
  indices: [
    0, 2, 1,
    0, 1, 3,
    0, 3, 2,
    1, 2, 3,
  ],
  positions: [
    1, 1, 1,
    -1, -1, 1,
    -1, 1, -1,
    1, -1, -1,
  ],
});

const lower = (geometry: ReturnType<typeof boxGeometry> | ReturnType<typeof triangleGeometry>) =>
  prepareCanonicalSurfaceScene(scene({
    camera: perspectiveCamera({ position: [0, 0, 5] }),
    nodes: [boundedVolume({
      color: [0.1, 1.5, 0.4, 0.8],
      extinctionPerMetre: 2,
      geometry,
    })],
  }));

describe("bounded volume lowering", () => {
  it("lowers boxes and convex triangle hulls without making them pickable", () => {
    const box = lower(boxGeometry([2, 4, 6]));
    expect(box.surfaces).toEqual([]);
    expect(box.pickSurfaces).toEqual([]);
    expect(box.volumes).toHaveLength(1);
    expect(box.volumes[0]).toMatchObject({
      densityProfileCount: 3,
      extinctionPerMetre: 2,
      planeCount: 6,
    });
    expect(box.volumes[0]!.worldBounds).toEqual({
      max: [1, 2, 3],
      min: [-1, -2, -3],
    });

    const tetrahedral = lower(tetrahedron());
    expect(tetrahedral.volumes[0]!.planeCount).toBe(4);
  });

  it("rejects open and inconsistently wound triangle boundaries before GL work", () => {
    const tetra = tetrahedron();
    expect(() => lower(triangleGeometry({
      indices: [...tetra.indices.slice(0, -3)],
      positions: tetra.positions,
    }))).toThrow(/closed and consistently wound/);

    const reversed = [...tetra.indices];
    [reversed[0], reversed[1]] = [reversed[1]!, reversed[0]!];
    expect(() => lower(triangleGeometry({
      indices: reversed,
      positions: tetra.positions,
    }))).toThrow(/convex with consistent outward winding|closed and consistently wound/);
  });

  it("rejects non-invertible volume transforms before resource allocation", () => {
    expect(() => boundedVolume({
      color: [1, 1, 1, 1],
      extinctionPerMetre: 1,
      geometry: boxGeometry(1),
      transform: { scale: [1, 0, 1] },
    })).toThrow(/scale must be non-zero/);
  });
});

describe("bounded volume presentation planning", () => {
  it("preserves direct presentation and rejects only unsafe float composites", () => {
    expect(boundedVolumePresentationMode(true, false, {
      hasFloatBlendTarget: false,
      hasFloatColorTarget: true,
    })).toBe('direct');
    expect(boundedVolumePresentationMode(true, true, {
      hasFloatBlendTarget: false,
      hasFloatColorTarget: true,
    })).toBe('omitted');
    expect(boundedVolumePresentationMode(true, true, {
      hasFloatBlendTarget: false,
      hasFloatColorTarget: false,
    })).toBe('linear');
    expect(boundedVolumePresentationMode(true, true, {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    })).toBe('linear');
    expect(boundedVolumePresentationMode(false, false, {
      hasFloatBlendTarget: true,
      hasFloatColorTarget: true,
    })).toBe('none');
  });
});

describe("bounded volume GPU ownership", () => {
  const view = {
    view: identityMat4(),
    viewProjection: identityMat4(),
    viewport: { height: 64, width: 64, x: 0, y: 0 },
  };
  const depthBinding = { sampler: null, target: "2d" as const, texture: {} as WebGLTexture };

  it("selects direct presentation without assuming a zero-origin destination viewport", () => {
    const gl = Object.assign(fakeGl(), { uniform2fv: vi.fn(), uniform3fv: vi.fn() });
    const owner = new BoundedVolumeGpuOwner(gl, new PersistentGpuBudgetOwner());
    owner.setScene(lower(boxGeometry(1)).volumes);
    const state = new WebGlStateOwner(gl);
    const offsetView = {
      ...view,
      viewport: { height: 48, width: 56, x: 7, y: 11 },
    };

    owner.drawView(
      offsetView,
      null,
      depthBinding,
      true,
      { exposure: 1.5, toneMapping: 'pbr-neutral' },
      state,
    );

    expect(Array.from(vi.mocked(gl.uniform3fv).mock.calls[0]![1] as Float32Array))
      .toEqual([1.5, 1, 1]);
    expect(Array.from(vi.mocked(gl.uniform4fv).mock.calls[0]![1] as Float32Array))
      .toEqual([7, 11, 56, 48]);
    expect(gl.shaderSource.mock.calls.some(([, source]) =>
      String(source).includes('vec3 pbrNeutral')
      && !String(source).includes('__PRESENTATION_FUNCTIONS__'))).toBe(true);
    owner.dispose();
  });

  it("retains proxy buffers when only authored volume values change", () => {
    const gl = Object.assign(fakeGl(), { uniform2fv: vi.fn(), uniform3fv: vi.fn() });
    const owner = new BoundedVolumeGpuOwner(gl, new PersistentGpuBudgetOwner());
    const first = lower(boxGeometry(1)).volumes;
    const second = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({ position: [0, 0, 5] }),
      nodes: [boundedVolume({
        color: [0.2, 2, 0.4, 0.7],
        extinctionPerMetre: 3,
        geometry: boxGeometry(1),
        transform: { position: [0.1, 0, 0] },
      })],
    })).volumes;
    const state = new WebGlStateOwner(gl);

    owner.setScene(first);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    owner.setScene(second);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);

    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.drawElements).toHaveBeenCalledTimes(2);
    owner.dispose();
  });

  it("reuploads different triangle proxies that collide under the canonical bounds key", () => {
    const gl = Object.assign(fakeGl(), { uniform2fv: vi.fn(), uniform3fv: vi.fn() });
    const owner = new BoundedVolumeGpuOwner(gl, new PersistentGpuBudgetOwner());
    const firstGeometry = tetrahedron();
    const secondGeometry = triangleGeometry({
      indices: firstGeometry.indices,
      positions: [
        1, 1, 1,
        -1, -1, 1,
        -1, 0.75, -1,
        1, -1, -1,
      ],
    });
    const state = new WebGlStateOwner(gl);

    owner.setScene(lower(firstGeometry).volumes);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    owner.setScene(lower(secondGeometry).volumes);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);

    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    owner.dispose();
  });

  it("does not churn allocation attempts after a persistent-budget denial", () => {
    const gl = Object.assign(fakeGl(), { uniform2fv: vi.fn(), uniform3fv: vi.fn() });
    const budget = new PersistentGpuBudgetOwner(1);
    const owner = new BoundedVolumeGpuOwner(gl, budget);
    owner.setScene(lower(boxGeometry(1)).volumes);
    const state = new WebGlStateOwner(gl);

    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);

    expect(budget.snapshot().deniedClaims).toBe(1);
    expect(gl.createBuffer).not.toHaveBeenCalled();
    owner.dispose();
  });

  it("retries a denied proxy only after persistent capacity is released", () => {
    const gl = Object.assign(fakeGl(), { uniform2fv: vi.fn(), uniform3fv: vi.fn() });
    const budget = new PersistentGpuBudgetOwner(200);
    const competingClaim = {};
    expect(budget.tryClaim(competingClaim, 100)).toBe(true);
    const owner = new BoundedVolumeGpuOwner(gl, budget);
    owner.setScene(lower(boxGeometry(1)).volumes);
    const state = new WebGlStateOwner(gl);

    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    expect(budget.snapshot().deniedClaims).toBe(1);

    budget.release(competingClaim);
    owner.drawView(view, {} as WebGLFramebuffer, depthBinding, true, null, state);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    owner.dispose();
  });
});

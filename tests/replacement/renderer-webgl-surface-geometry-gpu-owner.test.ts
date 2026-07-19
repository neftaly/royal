import {
  boxGeometry,
  mesh,
  perspectiveCamera,
  planeGeometry,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { SurfaceGeometryGpuOwner } from "../../packages/renderer-webgl/src/surface/surface-geometry-gpu-owner";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  nextSurfaceAdmissionCount,
  retainedSurfaceAdmissionCount,
} from "../../packages/renderer-webgl/src/surface/gpu-admission";

const fakeGl = (): WebGL2RenderingContext => ({
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,
  FLOAT: 0x1406,
  STATIC_DRAW: 0x88e4,
  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_INT: 0x1405,
  UNSIGNED_SHORT: 0x1403,
  bindBuffer: vi.fn(),
  bindVertexArray: vi.fn(),
  bufferData: vi.fn(),
  bufferSubData: vi.fn(),
  createBuffer: vi.fn(() => ({})),
  createVertexArray: vi.fn(() => ({})),
  deleteBuffer: vi.fn(),
  deleteVertexArray: vi.fn(),
  disableVertexAttribArray: vi.fn(),
  enableVertexAttribArray: vi.fn(),
  vertexAttrib3f: vi.fn(),
  vertexAttribDivisor: vi.fn(),
  vertexAttribPointer: vi.fn(),
} as unknown as WebGL2RenderingContext);

const surface = (geometry: ReturnType<typeof planeGeometry> | ReturnType<typeof boxGeometry>) =>
  prepareCanonicalSurfaceScene(scene({
    camera: perspectiveCamera({}),
    nodes: [mesh({
      geometry,
      material: unlitMaterial({ color: [1, 1, 1, 1] }),
    })],
  })).surfaces;

describe("surface geometry GPU owner", () => {
  it("advances bounded prefixes and retains only reusable resource identities", () => {
    const first = surface(planeGeometry(1));
    const sameGeometry = surface(planeGeometry(1));
    const changedGeometry = surface(boxGeometry(1));
    expect(nextSurfaceAdmissionCount(0, 381, 16)).toBe(16);
    expect(nextSurfaceAdmissionCount(376, 381, 16)).toBe(381);
    expect(retainedSurfaceAdmissionCount(first, sameGeometry, 1)).toBe(1);
    expect(retainedSurfaceAdmissionCount(first, changedGeometry, 1)).toBe(0);
  });

  it("retains committed handles and rolls back only newly prepared handles", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(gl);
    owner.prepare(surface(planeGeometry(1))).commit();
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);

    owner.prepare(surface(boxGeometry(1))).rollback();
    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(2);
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);

    owner.prepare(surface(planeGeometry(1))).commit();
    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(2);
    owner.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(4);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
  });

  it("packs compatible admission work into one shared GPU arena", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(gl);
    const surfaces = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
      ],
    })).surfaces;
    const plan = owner.prepare(surfaces);
    expect(plan.surfaces).toHaveLength(2);
    expect(plan.surfaces[0]!.geometry.vertexArray)
      .toBe(plan.surfaces[1]!.geometry.vertexArray);
    expect(plan.surfaces[0]!.geometry.indexOffset).toBe(0);
    expect(plan.surfaces[1]!.geometry.indexOffset).toBeGreaterThan(0);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(2);
    plan.commit();
    owner.prepare([surfaces[0]!]).commit();
    const restored = owner.prepare(surfaces);
    expect(restored.surfaces[0]!.geometry.vertexArray)
      .toBe(restored.surfaces[1]!.geometry.vertexArray);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    restored.commit();
    owner.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });
});

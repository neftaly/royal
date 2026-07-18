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
});

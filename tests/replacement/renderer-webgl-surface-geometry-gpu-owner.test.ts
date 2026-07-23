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
import { PersistentGpuBudgetOwner } from "../../packages/renderer-webgl/src/resource/persistent-gpu-budget";
import { FrameUploadBudgetOwner } from "../../packages/renderer-webgl/src/resource/frame-upload-budget";
import {
  prepareCanonicalSurfaceScene,
  type CanonicalDrawSurface,
} from "../../packages/renderer-webgl/src/surface/scene-lowering";
import {
  retainedSurfaceAdmissionCount,
  surfaceGeometryResourceKey,
  surfaceGeometryUploadByteLength,
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
  it("borrows an already compatible zero-offset index stream", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(gl);
    const [prepared] = surface(planeGeometry(1));
    const indices = new Uint8Array(prepared!.geometry.indices);
    owner.prepare([{
      ...prepared!,
      geometry: { ...prepared!.geometry, indices },
    }]).commit();
    const [upload] = vi.mocked(gl.bufferSubData).mock.calls
      .filter(([target]) => target === gl.ELEMENT_ARRAY_BUFFER);
    expect(upload).toHaveLength(3);
    expect(upload![2]).toBe(indices);
  });

  it("accounts committed geometry and denies allocation before crossing the root budget", () => {
    const budget = new PersistentGpuBudgetOwner(1024);
    const owner = new SurfaceGeometryGpuOwner(fakeGl(), budget);
    owner.prepare(surface(planeGeometry(1))).commit();
    expect(budget.snapshot().retainedBytes).toBeGreaterThan(0);
    owner.dispose();
    expect(budget.snapshot().retainedBytes).toBe(0);

    const denied = new SurfaceGeometryGpuOwner(fakeGl(), new PersistentGpuBudgetOwner(1));
    expect(() => denied.prepare(surface(planeGeometry(1))))
      .toThrow("persistent GPU budget denied surface geometry");
  });

  it("advances bounded prefixes and retains only reusable resource identities", () => {
    const first = surface(planeGeometry(1));
    const sameGeometry = surface(planeGeometry(1));
    const changedGeometry = surface(boxGeometry(1));
    const withInstances = [{
      ...first[0]!,
      instances: {
        count: 1,
        key: "instances-a",
        localModels: new Float32Array(16),
      },
    }];
    const withDifferentInstances = [{
      ...withInstances[0]!,
      instances: { ...withInstances[0]!.instances, key: "instances-b" },
    }];
    expect(retainedSurfaceAdmissionCount(first, sameGeometry, 1)).toBe(1);
    expect(retainedSurfaceAdmissionCount(first, changedGeometry, 1)).toBe(0);
    expect(retainedSurfaceAdmissionCount(withInstances, withInstances, 1)).toBe(1);
    expect(retainedSurfaceAdmissionCount(withInstances, withDifferentInstances, 1)).toBe(0);
  });

  it("admits exact geometry bytes as a progressive prefix without starving an oversize primitive", () => {
    const gl = fakeGl();
    const uploadBudget = new FrameUploadBudgetOwner(60);
    const owner = new SurfaceGeometryGpuOwner(
      gl,
      new PersistentGpuBudgetOwner(),
      uploadBudget,
    );
    const first = surface(planeGeometry(1))[0]!;
    const second = {
      ...first,
      geometry: { ...first.geometry, key: `${first.geometry.key}:second` },
    };
    expect(surfaceGeometryUploadByteLength(first, 1)).toBe(54);

    const firstFrame = owner.prepare([first, second], 2);
    expect(firstFrame.surfaces).toHaveLength(1);
    expect(owner.snapshot()).toEqual({
      admittedBytes: 54,
      budgetBytes: 60,
      deferredUploads: 1,
    });
    firstFrame.commit();

    owner.beginFrame();
    const secondFrame = owner.prepare([first, second], 2, 1);
    expect(secondFrame.offset).toBe(1);
    expect(secondFrame.surfaces).toHaveLength(1);
    expect(owner.snapshot()).toEqual({
      admittedBytes: 54,
      budgetBytes: 60,
      deferredUploads: 0,
    });
    secondFrame.commit();

    const oversize = new SurfaceGeometryGpuOwner(
      fakeGl(),
      new PersistentGpuBudgetOwner(),
      new FrameUploadBudgetOwner(1),
    );
    const oversizeFrame = oversize.prepare([first]);
    expect(oversizeFrame.surfaces).toHaveLength(1);
    expect(oversize.snapshot().admittedBytes).toBe(54);
    oversizeFrame.rollback();
  });

  it("admits every zero-upload surface which reuses one geometry transaction", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(
      gl,
      new PersistentGpuBudgetOwner(),
      new FrameUploadBudgetOwner(60),
    );
    const shared = surface(planeGeometry(1))[0]!;
    const surfaces = Array<CanonicalDrawSurface>(719).fill(shared);

    const admission = owner.prepare(surfaces);

    expect(admission.surfaces).toHaveLength(719);
    expect(owner.snapshot()).toEqual({
      admittedBytes: 54,
      budgetBytes: 60,
      deferredUploads: 0,
    });
    admission.commit();
    expect(vi.mocked(gl.bufferSubData)).toHaveBeenCalledTimes(2);
  });

  it("does not collapse UV1-only and UV0-plus-UV1 geometry layouts", () => {
    const prepared = surface(planeGeometry(1))[0]!;
    const texture = {
      contentKey: "layout-texture",
      kind: "asset" as const,
      src: "/layout.png",
    };
    const textureCoordinates1 = {
      row0: [1, 0, 0, 1] as const,
      row1: [0, 1, 0, 0] as const,
    };
    const uv1Only = {
      ...prepared,
      material: {
        ...prepared.material,
        baseColorAsset: texture,
        baseColorTextureCoordinates: textureCoordinates1,
        requiresTextureCoordinates: true,
      },
    };
    const uv0AndUv1 = {
      ...prepared,
      material: {
        baseColor: [1, 1, 1, 1] as const,
        baseColorAsset: texture,
        baseColorTextureCoordinates: textureCoordinates1,
        emissiveFactor: [0, 0, 0] as const,
        kind: "standard" as const,
        metallicFactor: 0,
        normalAsset: { ...texture, contentKey: "layout-normal" },
        normalScale: 1,
        occlusionStrength: 1,
        requiresTextureCoordinates: true,
        roughnessFactor: 1,
      },
    };
    expect(surfaceGeometryResourceKey(uv1Only)).toContain(":uv1:");
    expect(surfaceGeometryResourceKey(uv0AndUv1)).toContain(":uv01:");
    expect(surfaceGeometryResourceKey(uv1Only)).not.toBe(
      surfaceGeometryResourceKey(uv0AndUv1),
    );
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

  it("retains and releases distinct instance vertex-array identities", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(gl);
    const base = surface(planeGeometry(1))[0]!;
    const localModels = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);
    const instanced = (key: string) => ({
      ...base,
      instances: { count: 1, key, localModels },
    });
    owner.prepare([instanced("instances:a"), instanced("instances:b")]).commit();
    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(3);

    owner.prepare([instanced("instances:a"), instanced("instances:b")]).commit();
    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(3);

    owner.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(4);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(3);
  });

  it("packs compatible admission work into one shared GPU arena", () => {
    const gl = fakeGl();
    const owner = new SurfaceGeometryGpuOwner(gl);
    const surfaces = prepareCanonicalSurfaceScene(scene({
      camera: perspectiveCamera({}),
      nodes: [
        mesh({
          geometry: boxGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
        mesh({
          geometry: planeGeometry(1),
          material: unlitMaterial({ color: [1, 1, 1, 1] }),
        }),
      ],
    })).surfaces;
    const firstAdmission = owner.prepare(surfaces, 1);
    const firstGeometry = firstAdmission.surfaces[0]!.geometry;
    expect(firstAdmission.surfaces).toHaveLength(1);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(2);
    firstAdmission.commit();

    const secondAdmission = owner.prepare(surfaces, 2, 1);
    expect(secondAdmission.offset).toBe(1);
    expect(secondAdmission.surfaces).toHaveLength(1);
    expect(firstGeometry.vertexArray)
      .toBe(secondAdmission.surfaces[0]!.geometry.vertexArray);
    expect(firstGeometry.indexOffset).toBe(0);
    expect(secondAdmission.surfaces[0]!.geometry.indexOffset).toBeGreaterThan(0);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(4);
    const indexUploads = vi.mocked(gl.bufferSubData).mock.calls
      .filter(([target]) => target === gl.ELEMENT_ARRAY_BUFFER);
    expect(indexUploads).toHaveLength(2);
    expect(indexUploads[0]).toHaveLength(5);
    expect(indexUploads[1]).toHaveLength(5);
    expect(indexUploads[0]![2]).toBe(indexUploads[1]![2]);
    secondAdmission.rollback();

    owner.beginFrame();
    const committedSecondAdmission = owner.prepare(surfaces, 2, 1);
    expect(committedSecondAdmission.surfaces).toHaveLength(1);
    expect(gl.bufferSubData).toHaveBeenCalledTimes(6);
    committedSecondAdmission.commit();

    owner.prepare(surfaces, 2).commit();
    expect(gl.bufferSubData).toHaveBeenCalledTimes(6);
    owner.dispose();
    expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
    expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
  });

  it("claims bounded arena chunks only when their first surface is admitted", () => {
    const gl = fakeGl();
    const budget = new PersistentGpuBudgetOwner();
    const owner = new SurfaceGeometryGpuOwner(gl, budget);
    const base = surface(planeGeometry(1))[0]!;
    const large = (key: string) => ({
      ...base,
      geometry: {
        ...base.geometry,
        indices: new Uint32Array([0, 1, 2]),
        key,
        positions: new Float32Array(600_000),
      },
    });
    const surfaces = [large("large-a"), large("large-b")];

    const firstFrame = owner.prepare(surfaces, 2);
    expect(firstFrame.surfaces).toHaveLength(1);
    expect(gl.createBuffer).toHaveBeenCalledTimes(2);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(1);
    expect(budget.snapshot().retainedBytes).toBe(2_400_012);
    firstFrame.commit();

    owner.beginFrame();
    const secondFrame = owner.prepare(surfaces, 2);
    expect(secondFrame.surfaces).toHaveLength(2);
    expect(gl.createBuffer).toHaveBeenCalledTimes(4);
    expect(gl.createVertexArray).toHaveBeenCalledTimes(2);
    expect(budget.snapshot().retainedBytes).toBe(4_800_024);
    secondFrame.commit();
  });
});

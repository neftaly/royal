import { afterEach, describe, expect, it, vi } from "vitest";
import {
  boxGeometry,
  createGltfInstanceTransforms,
  gltf,
  gltfInstances,
  mesh,
  orthographicCamera,
  scene,
  unlitMaterial,
} from "@royal/renderer-core";
import { createWebGlRoot } from "@royal/renderer-webgl";
import {
  createStrictWebGl2Context,
  createWebGlTestCanvas,
} from "./webgl-test-harness";

const fakeCanvas = (gl: WebGL2RenderingContext): HTMLCanvasElement =>
  createWebGlTestCanvas(gl, { height: 200, width: 400 });

const fakeGl = (): WebGL2RenderingContext => createStrictWebGl2Context().gl;

const loadedTriangleGltfFetch = (): ReturnType<typeof vi.fn> => {
  const positions = new Float32Array([
    -0.35, -0.35, 0,
    0.35, -0.35, 0,
    0, 0.35, 0,
  ]);
  const buffer = positions.buffer.slice(0);

  return vi.fn(async (url: string) => {
    if (url === "/models/right.gltf") {
      return {
        json: async () => ({
          accessors: [
            {
              bufferView: 0,
              componentType: 5126,
              count: 3,
              type: "VEC3",
            },
          ],
          bufferViews: [
            {
              buffer: 0,
              byteLength: buffer.byteLength,
            },
          ],
          buffers: [
            {
              byteLength: buffer.byteLength,
              uri: "right.bin",
            },
          ],
          meshes: [
            {
              primitives: [
                {
                  attributes: {
                    POSITION: 0,
                  },
                  mode: 4,
                },
              ],
            },
          ],
          nodes: [
            {
              mesh: 0,
            },
          ],
          scene: 0,
          scenes: [
            {
              nodes: [0],
            },
          ],
        }),
        ok: true,
      };
    }

    if (url === "/models/right.bin") {
      return {
        arrayBuffer: async () => buffer,
        ok: true,
      };
    }

    throw new Error(`unexpected fetch ${url}`);
  });
};


afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("WebGL picking", () => {
  it("validates the shared pick-input contract before renderer state", () => {
    const root = createWebGlRoot(fakeCanvas(fakeGl()));

    expect(() => root.pick({
      clientX: 10,
      clientY: 20,
      screenX: 10,
    } as unknown as Parameters<typeof root.pick>[0]))
      .toThrow(/unsupported field.*screenX/i);
    expect(() => root.pick({ clientX: Number.NaN, clientY: 20 }))
      .toThrow("Royal pick input clientX must be a finite number");

    root.dispose();
  });

  it("returns the intended mesh or loaded glTF target for DOM client coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", loadedTriangleGltfFetch());
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const leftMesh = mesh({
      geometry: boxGeometry([0.7, 0.7, 0.7]),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      pickingId: "left-mesh",
      transform: {
        position: [-1, 0, 0],
        rotation: [0, 0, 0],
      },
    });
    const rightGltf = gltf({
      bounds: {
        max: [0.35, 0.35, 0.35],
        min: [-0.35, -0.35, -0.35],
      },
      pickingId: "right-gltf",
      src: "/models/right.gltf",
      transform: {
        position: [1, 0, 0],
        rotation: [0, 0, 0],
      },
    });

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [leftMesh, rightGltf],
    }));

    expect(root.pick({ clientX: 100, clientY: 100 })?.target).toMatchObject({
      id: "left-mesh",
      kind: "mesh",
      node: leftMesh,
    });
    await vi.waitFor(() => {
      expect(root.pick({ clientX: 300, clientY: 100 })?.target).toMatchObject({
        id: "right-gltf",
        kind: "gltf",
        node: rightGltf,
      });
    });
    const preparedScratch = root.snapshot().picking;
    expect(preparedScratch).toMatchObject({ candidates: 1, exactTests: 1 });
    expect(preparedScratch.candidateHighWater).toBeGreaterThanOrEqual(1);
    root.pick({ clientX: 300, clientY: 100 });
    expect(root.snapshot().picking.candidateHighWater).toBe(preparedScratch.candidateHighWater);
    expect(root.pick({ clientX: 200, clientY: 10 })).toBeUndefined();
  });

  it("does not accept a mesh AABB hit unless the ray intersects rendered triangles", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const rotatedMesh = mesh({
      geometry: boxGeometry([2, 0.2, 0.2]),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      pickingId: "rotated-mesh",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, Math.PI / 4],
      },
    });

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [rotatedMesh],
    }));

    expect(root.pick({ clientX: 272, clientY: 100 })).toBeUndefined();
    expect(root.pick({ clientX: 200, clientY: 100 })?.target).toMatchObject({
      id: "rotated-mesh",
      kind: "mesh",
      node: rotatedMesh,
    });
  });

  it("does not pick unloaded glTF asset bounds as a fallback", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const rotatedGltf = gltf({
      bounds: {
        max: [1, 0.1, 0.1],
        min: [-1, -0.1, -0.1],
      },
      pickingId: "rotated-gltf",
      src: "/models/rotated.gltf",
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, Math.PI / 4],
      },
    });

    root.render(scene({
      camera: orthographicCamera({
            bottom: -1,
            far: 10,
            left: -2,
            near: 0.1,
            position: [0, 0, 4],
            right: 2,
            rotation: [0, 0, 0],
            top: 1,
      }),
      nodes: [rotatedGltf],
    }));

    expect(root.pick({ clientX: 272, clientY: 100 })).toBeUndefined();
  });

  it("uses optional geometry as an exact mesh picking proxy", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const proxyMesh = mesh({
      geometry: boxGeometry([3, 1, 1]),
      material: unlitMaterial({ color: [1, 0, 0, 1] }),
      pickingGeometry: boxGeometry(0.5),
      pickingId: "proxy-mesh",
    });

    root.render(scene({
      camera: orthographicCamera({
        bottom: -1,
        far: 10,
        left: -2,
        near: 0.1,
        position: [0, 0, 4],
        right: 2,
        rotation: [0, 0, 0],
        top: 1,
      }),
      nodes: [proxyMesh],
    }));

    expect(root.pick({ clientX: 300, clientY: 100 })).toBeUndefined();
    expect(root.pick({ clientX: 200, clientY: 100 })?.target).toMatchObject({
      id: "proxy-mesh",
      kind: "mesh",
      node: proxyMesh,
    });
    expect(root.snapshot().picking).toMatchObject({ candidates: 1, exactTests: 1 });
  });

  it("picks a glTF proxy before its asset is prepared", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const proxyGltf = gltf({
      pickingGeometry: boxGeometry(0.7),
      pickingId: "pending-gltf",
      src: "/models/pending.gltf",
      transform: { position: [1, 0, 0], rotation: [0, 0, 0] },
    });

    root.render(scene({
      camera: orthographicCamera({
        bottom: -1,
        far: 10,
        left: -2,
        near: 0.1,
        position: [0, 0, 4],
        right: 2,
        rotation: [0, 0, 0],
        top: 1,
      }),
      nodes: [proxyGltf],
    }));

    expect(root.pick({ clientX: 300, clientY: 100 })?.target).toEqual({
      id: "pending-gltf",
      kind: "gltf",
      node: proxyGltf,
    });
    expect(root.snapshot().picking).toMatchObject({ candidates: 1, exactTests: 1 });
  });

  it("reuses one proxy geometry across glTF instances while preserving instance identity", () => {
    vi.stubGlobal("devicePixelRatio", 1);
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const root = createWebGlRoot(fakeCanvas(fakeGl()));
    const instances = createGltfInstanceTransforms({
      count: 2,
      logicalIds: ["left", "right"],
      positions: [-1, 0, 0, 1, 0, 0],
    });
    const proxyInstances = gltfInstances({
      instances,
      pickingGeometry: boxGeometry(0.7),
      pickingId: "pending-instances",
      src: "/models/pending.gltf",
    });

    root.render(scene({
      camera: orthographicCamera({
        bottom: -1,
        far: 10,
        left: -2,
        near: 0.1,
        position: [0, 0, 4],
        right: 2,
        rotation: [0, 0, 0],
        top: 1,
      }),
      nodes: [proxyInstances],
    }));

    expect(root.pick({ clientX: 300, clientY: 100 })?.target).toEqual({
      id: "pending-instances",
      instanceId: "right",
      instanceIndex: 1,
      kind: "gltf-instances",
      node: proxyInstances,
    });
    expect(root.snapshot().picking).toMatchObject({ candidates: 1, exactTests: 1 });
  });
});

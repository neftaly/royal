import { describe, expect, it, vi } from "vitest";
import {
  createStaticDracoDecoder,
  createStaticDracoTaskPlanner,
  decodeStaticDracoTask,
  prepareSelectedStaticDracoDecoder,
  type StaticDracoTaskExecutor,
} from "../../packages/renderer-webgl/src/gltf/draco";

type TestDracoMeshDecoder = NonNullable<
  Parameters<typeof createStaticDracoDecoder>[3]
>;

describe("static Draco adapter", () => {
  it("decodes and retains only demanded canonical attributes, including TEXCOORD_1", () => {
    const requested: number[] = [];
    const decodeMesh: TestDracoMeshDecoder = () => ({
      faces_: new Int32Array([0, 1, 2]),
      getAttributeByUniqueId: (id: number) => {
        requested.push(id);
        const components = id === 7 || id === 9 ? 3 : 2;
        return {
          extractTo: () => id === 7
            ? new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0])
            : id === 9
              ? new Float32Array([255, 0, 0, 0, 255, 0, 0, 0, 255])
            : new Float32Array([0, 0, 1, 0, 0.5, 1]),
          numComponents: components,
        };
      },
      numFaces: () => 1,
      numPoints: () => 3,
    });
    const decode = createStaticDracoDecoder({
      accessors: [
        { componentType: 5126, count: 3, type: "VEC3" },
        { componentType: 5126, count: 3, type: "VEC2" },
        { componentType: 5123, count: 3, type: "SCALAR" },
        { componentType: 5121, count: 3, normalized: true, type: "VEC3" },
      ],
      bufferViews: [{ buffer: 0, byteLength: 1 }],
    }, new Uint8Array([0]), "demanded.glb", decodeMesh);
    const primitive = {
      attributes: { COLOR_0: 3, POSITION: 0, TEXCOORD_1: 1 },
      extensions: {
        KHR_draco_mesh_compression: {
          attributes: { COLOR_0: 9, POSITION: 7, TEXCOORD_1: 8 },
          bufferView: 0,
        },
      },
      indices: 2,
    };

    const decoded = decode(primitive, "meshes[0].primitives[0]");
    expect(requested).toEqual([]);
    expect(decoded.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(decoded.attribute("TEXCOORD_0")).toBeUndefined();
    expect(requested).toEqual([]);
    expect(decoded.attribute("POSITION")).toEqual(new Float32Array([
      -1, -1, 0, 1, -1, 0, 0, 1, 0,
    ]));
    expect(decoded.attribute("TEXCOORD_1")).toEqual(new Float32Array([
      0, 0, 1, 0, 0.5, 1,
    ]));
    expect(decoded.attribute("COLOR_0")).toEqual(new Float32Array([
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ]));
    expect(requested).toEqual([7, 8, 9]);
    expect(decoded.attribute("TEXCOORD_1")).toBe(decoded.attribute("TEXCOORD_1"));
    expect(requested).toEqual([7, 8, 9]);
  });

  it("erases document and buffer layout before codec execution", () => {
    const binary = new Uint8Array([9, 8, 7, 6]);
    const plan = createStaticDracoTaskPlanner({
      accessors: [
        { componentType: 5126, count: 3, type: "VEC3" },
        { componentType: 5123, count: 3, type: "SCALAR" },
      ],
      bufferViews: [{ buffer: 0, byteLength: 2, byteOffset: 1 }],
    }, binary, "planned.glb");
    const task = plan({
      attributes: { POSITION: 0 },
      extensions: {
        KHR_draco_mesh_compression: {
          attributes: { POSITION: 4 },
          bufferView: 0,
        },
      },
      indices: 1,
    }, "meshes[0].primitives[0]");

    expect(task).toMatchObject({
      attributes: [{ components: 3, semantic: "POSITION", uniqueId: 4 }],
      label: "planned.glb",
      path: "meshes[0].primitives[0]",
    });
    expect(task.bytes).toEqual(new Uint8Array([8, 7]));
    expect(structuredClone(task)).toEqual(task);
    const decoded = decodeStaticDracoTask(task, () => ({
      faces_: new Int32Array([0, 1, 2]),
      getAttributeByUniqueId: () => ({
        extractTo: () => new Float32Array(9),
        numComponents: 3,
      }),
      numFaces: () => 1,
      numPoints: () => 3,
    }));
    expect(decoded.indices).toEqual(new Uint16Array([0, 1, 2]));
    expect(decoded.attribute("POSITION")).toEqual(new Float32Array(9));
  });

  it("executes one selected-scene task set behind the unchanged lowering decoder", async () => {
    const primitive = {
      attributes: { POSITION: 0 },
      extensions: {
        KHR_draco_mesh_compression: {
          attributes: { POSITION: 2 },
          bufferView: 0,
        },
      },
      indices: 1,
    };
    const execute = vi.fn(async (tasks: Parameters<StaticDracoTaskExecutor>[0]) => tasks.map((task) => ({
      attributes: [{ semantic: "POSITION" as const, values: new Float32Array(9) }],
      indices: new Uint16Array([0, 1, 2]),
      path: task.path,
    })));
    const decode = await prepareSelectedStaticDracoDecoder({
      accessors: [
        { componentType: 5126, count: 3, type: "VEC3" },
        { componentType: 5123, count: 3, type: "SCALAR" },
      ],
      bufferViews: [{ buffer: 0, byteLength: 1 }],
      meshes: [{ primitives: [primitive] }, { primitives: [{ ...primitive }] }],
      nodes: [{ mesh: 0 }, { mesh: 1 }],
      scene: 0,
      scenes: [{ nodes: [0] }, { nodes: [1] }],
    }, new Uint8Array([7]), "selected.gltf", execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toHaveLength(1);
    expect(decode(primitive, "meshes[0].primitives[0]").indices)
      .toEqual(new Uint16Array([0, 1, 2]));
    expect(() => decode(primitive, "meshes[1].primitives[0]"))
      .toThrow("has no prepared Draco result");
  });
});

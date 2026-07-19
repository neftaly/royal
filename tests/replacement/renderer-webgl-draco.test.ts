import { describe, expect, it } from "vitest";
import {
  createStaticDracoDecoder,
  type StaticDracoMeshDecoder,
} from "../../packages/renderer-webgl/src/gltf/draco";

describe("static Draco adapter", () => {
  it("decodes and retains only demanded canonical attributes, including TEXCOORD_1", () => {
    const requested: number[] = [];
    const decodeMesh: StaticDracoMeshDecoder = () => ({
      faces_: new Int32Array([0, 1, 2]),
      getAttributeByUniqueId: (id: number) => {
        requested.push(id);
        const components = id === 7 ? 3 : 2;
        return {
          extractTo: () => id === 7
            ? new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0])
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
      ],
      bufferViews: [{ buffer: 0, byteLength: 1 }],
    }, new Uint8Array([0]), "demanded.glb", decodeMesh);
    const primitive = {
      attributes: { POSITION: 0, TEXCOORD_1: 1 },
      extensions: {
        KHR_draco_mesh_compression: {
          attributes: { POSITION: 7, TEXCOORD_1: 8 },
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
    expect(requested).toEqual([7, 8]);
    expect(decoded.attribute("TEXCOORD_1")).toBe(decoded.attribute("TEXCOORD_1"));
    expect(requested).toEqual([7, 8]);
  });
});

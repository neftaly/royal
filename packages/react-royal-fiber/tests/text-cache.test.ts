import { describe, expect, it, vi } from "vitest";

vi.mock("@royal/renderer-core", async () => await import("../../renderer-core/src/index"));

import {
  textMeshFromLayout,
  vectorText,
  vectorTextMesh,
  type TextMesh,
} from "@royal/renderer-core";
import { TextCache, textBufferDataFromMesh } from "../src/webgl/text-cache";

const fakeGl = (): {
  readonly counts: {
    createBuffer: number;
    deleteBuffer: number;
  };
  readonly gl: WebGLRenderingContext;
} => {
  const counts = {
    createBuffer: 0,
    deleteBuffer: 0,
  };

  return {
    counts,
    gl: {
      ARRAY_BUFFER: 0x8892,
      ELEMENT_ARRAY_BUFFER: 0x8893,
      STATIC_DRAW: 0x88e4,
      bindBuffer() {},
      bufferData() {},
      createBuffer: () => {
        counts.createBuffer += 1;
        return {} as WebGLBuffer;
      },
      deleteBuffer() {
        counts.deleteBuffer += 1;
      },
    } as unknown as WebGLRenderingContext,
  };
};

describe("TextCache", () => {
  it("packs positions, glyph coordinates, and uint16 indices from text mesh data", () => {
    const mesh = textMeshFromLayout(vectorText({
      color: [1, 1, 1, 1],
      text: "oi",
    }).layout);
    const data = textBufferDataFromMesh(mesh);

    expect(data.position.length).toBe(mesh.vertices.length * 3);
    expect(data.glyphCoord.length).toBe(mesh.vertices.length * 2);
    expect(data.index.length).toBe(mesh.indices.length);
    expect(Array.from(data.glyphCoord.slice(0, 6))).toEqual([0, 1, 1, 1, 1, expect.any(Number)]);
    expect(data.glyphCoord[5]).toBeCloseTo(0.78);
    expect(data.glyphCoord[6]).toBe(0);
    expect(data.glyphCoord[7]).toBeCloseTo(0.78);
  });

  it("rejects meshes that exceed the uint16 index contract", () => {
    const mesh: TextMesh = {
      bounds: {
        xMax: 1,
        xMin: 0,
        yMax: 1,
        yMin: 0,
      },
      contours: [],
      indices: [0, 65535, 65536],
      vertices: [],
    };

    expect(() => textBufferDataFromMesh(mesh)).toThrow("VectorText geometry exceeds uint16 index capacity");
  });

  it("caches generated buffers by vector text node identity", () => {
    const { counts, gl } = fakeGl();
    const cache = new TextCache(gl);
    const node = vectorText({
      color: [1, 1, 1, 1],
      text: "AV",
    });
    const sameShapeDifferentNode = vectorText({
      color: [1, 1, 1, 1],
      text: "AV",
    });

    expect(cache.get(node)).toBe(cache.get(node));
    expect(counts.createBuffer).toBe(3);

    cache.get(sameShapeDifferentNode);
    expect(counts.createBuffer).toBe(6);

    cache.dispose();
    expect(counts.deleteBuffer).toBe(6);
  });

  it("sweeps buffers for text nodes not used in the latest frame", () => {
    const { counts, gl } = fakeGl();
    const cache = new TextCache(gl);
    const first = vectorText({
      color: [1, 1, 1, 1],
      text: "first",
    });
    const second = vectorText({
      color: [1, 1, 1, 1],
      text: "second",
    });

    cache.beginFrame();
    const firstAsset = cache.get(first);
    expect(cache.get(first)).toBe(firstAsset);
    cache.endFrame();

    expect(counts.createBuffer).toBe(3);
    expect(counts.deleteBuffer).toBe(0);

    cache.beginFrame();
    expect(cache.get(first)).toBe(firstAsset);
    cache.endFrame();

    expect(counts.createBuffer).toBe(3);
    expect(counts.deleteBuffer).toBe(0);

    cache.beginFrame();
    cache.get(second);
    cache.endFrame();

    expect(counts.createBuffer).toBe(6);
    expect(counts.deleteBuffer).toBe(3);

    cache.dispose();
    expect(counts.deleteBuffer).toBe(6);
  });

  it("packs empty text as empty buffers", () => {
    const mesh = vectorTextMesh(vectorText({
      color: [1, 1, 1, 1],
      text: "",
    }));
    const data = textBufferDataFromMesh(mesh);

    expect(data.position).toHaveLength(0);
    expect(data.glyphCoord).toHaveLength(0);
    expect(data.index).toHaveLength(0);
  });
});

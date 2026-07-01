import { gltf } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { GltfCache } from "../src/gltf-cache";
import { makeTriangleFixture } from "../../../tests/gltf-fixture";
import { fakeGl, waitFor } from "../../../tests/webgl-test-utils";

type MutableFixtureJson = {
  accessors: Array<Record<string, unknown>>;
  buffers: Array<Record<string, unknown>>;
  bufferViews: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  meshes: Array<{
    primitives: Array<{
      attributes?: Record<string, unknown>;
      indices?: unknown;
      material?: unknown;
    }>;
  }>;
};

const installFixture = (
  configure?: (json: MutableFixtureJson) => void,
  createImageBitmapImpl: () => Promise<ImageBitmap> = () => Promise.resolve({} as ImageBitmap),
): void => {
  const fixture = makeTriangleFixture();
  const json = structuredClone(fixture.json) as MutableFixtureJson;
  configure?.(json);

  const responses = new Map<string, Response>([
    ["https://example.test/triangle.gltf", Response.json(json)],
    ["https://example.test/triangle.bin", new Response(fixture.bin)],
    ["https://example.test/triangle.png", new Response(new Blob(["image"]))],
  ]);

  vi.stubGlobal("fetch", vi.fn((url: string) => {
    const response = responses.get(url);
    if (response === undefined) return Promise.resolve(new Response(null, { status: 404 }));
    return Promise.resolve(response.clone());
  }));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(createImageBitmapImpl),
  );
};

const loadBounds = async (
  cache: GltfCache,
  node: ReturnType<typeof gltf>,
) => {
  expect(cache.get(node)).toBeUndefined();
  await waitFor(() => cache.get(node) !== undefined);
  return cache.getBounds(node);
};

const triangleSrc = "https://example.test/triangle.gltf";

const loadError = async (
  configure?: (json: MutableFixtureJson) => void,
  options: Partial<Parameters<typeof gltf>[0]> = {},
): Promise<Error> => {
  installFixture(configure);
  const { gl } = fakeGl();
  const cache = new GltfCache(gl, () => undefined);
  const node = gltf({ src: triangleSrc, ...options });
  let error: unknown;

  cache.get(node);
  try {
    await waitFor(() => {
      try {
        cache.get(node);
        return false;
      } catch (caught: unknown) {
        error = caught;
        return true;
      }
    });
  } finally {
    cache.dispose();
  }

  expect(error).toBeInstanceOf(Error);
  return error as Error;
};

describe("GltfCache bounds", () => {
  it("uses parsed accessor min/max when available", async () => {
    installFixture((json) => {
      json.accessors[0] = {
        ...json.accessors[0],
        max: [5, 6, 7],
        min: [-2, -3, -4],
      };
    });
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({
      src: triangleSrc,
      transform: {
        position: [10, 1, -2],
        rotation: [0, 0, 0],
        scale: [2, 1, 0.5],
      },
    });

    const bounds = await loadBounds(cache, node);

    expect(bounds?.minX).toBeCloseTo(6);
    expect(bounds?.maxX).toBeCloseTo(20);
    expect(bounds?.minY).toBeCloseTo(-2);
    expect(bounds?.maxY).toBeCloseTo(7);
    expect(bounds?.minZ).toBeCloseTo(-4);
    expect(bounds?.maxZ).toBeCloseTo(1.5);
    cache.dispose();
  });

  it("falls back to loaded position data when accessor bounds are absent", async () => {
    installFixture();
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ src: triangleSrc });

    const bounds = await loadBounds(cache, node);

    expect(bounds?.minX).toBeCloseTo(-1);
    expect(bounds?.maxX).toBeCloseTo(1);
    expect(bounds?.minY).toBeCloseTo(-1);
    expect(bounds?.maxY).toBeCloseTo(1);
    expect(bounds?.minZ).toBeCloseTo(0);
    expect(bounds?.maxZ).toBeCloseTo(0);
    cache.dispose();
  });
});

describe("GltfCache subset diagnostics", () => {
  it("rejects GLB assets as outside the JSON .gltf subset", async () => {
    await expect(loadError(undefined, {
      src: "https://example.test/triangle.glb",
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: JSON .gltf documents are required; GLB binary containers are not supported",
    });
  });

  it("requires external buffer URIs instead of embedded buffers", async () => {
    await expect(loadError((json) => {
      json.buffers[0] = {};
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: buffer 0 must use an external buffer uri; GLB buffer chunks and embedded buffers are not supported",
    });
  });

  it("rejects data URI buffers as outside the external-buffer subset", async () => {
    await expect(loadError((json) => {
      json.buffers[0] = { uri: "data:application/octet-stream;base64,AAAA" };
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: buffer 0 must use an external buffer uri; data URIs are not supported",
    });
  });

  it("reports interleaved accessors as a subset limitation", async () => {
    await expect(loadError((json) => {
      json.bufferViews[0] = {
        ...json.bufferViews[0],
        byteStride: 12,
      };
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: accessor 0 uses byteStride; interleaved accessors are not supported",
    });
  });

  it("requires float vertex accessors with the shader attribute shape", async () => {
    await expect(loadError((json) => {
      json.accessors[0] = {
        ...json.accessors[0],
        componentType: 5122,
      };
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: accessor 0 must be FLOAT VEC3",
    });
  });

  it("requires UNSIGNED_SHORT scalar index accessors", async () => {
    await expect(loadError((json) => {
      json.accessors[3] = {
        ...json.accessors[3],
        componentType: 5125,
      };
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: index accessor 3 must be UNSIGNED_SHORT SCALAR",
    });
  });

  it("requires indexed primitives", async () => {
    await expect(loadError((json) => {
      delete json.meshes[0]!.primitives[0]!.indices;
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: indexed primitives are required; unindexed primitives are not supported",
    });
  });

  it("requires NORMAL attributes", async () => {
    await expect(loadError((json) => {
      delete json.meshes[0]!.primitives[0]!.attributes!.NORMAL;
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: primitive NORMAL accessor is required",
    });
  });

  it("requires TEXCOORD_0 attributes", async () => {
    await expect(loadError((json) => {
      delete json.meshes[0]!.primitives[0]!.attributes!.TEXCOORD_0;
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: primitive TEXCOORD_0 accessor is required",
    });
  });

  it("requires primitive materials with base-color textures", async () => {
    await expect(loadError((json) => {
      delete json.meshes[0]!.primitives[0]!.material;
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: primitive material with pbrMetallicRoughness.baseColorTexture is required",
    });
  });

  it("requires pbrMetallicRoughness baseColorTexture on materials", async () => {
    await expect(loadError((json) => {
      json.materials[0] = {};
    })).resolves.toMatchObject({
      message: "Unsupported glTF subset: material 0 pbrMetallicRoughness.baseColorTexture is required",
    });
  });
});

describe("GltfCache textures", () => {
  it("keeps stable base-color texture identity while the WebGL texture loads", async () => {
    let resolveImage!: (image: ImageBitmap) => void;
    const imagePromise = new Promise<ImageBitmap>((resolve) => {
      resolveImage = resolve;
    });
    installFixture(undefined, () => imagePromise);
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ src: triangleSrc });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);

    const asset = cache.get(node);
    expect(asset).toBeDefined();
    const primitive = asset!.primitives[0]!;
    const baseColorTexture = primitive.material.baseColorTexture;
    const textureIdentity = "https://example.test/triangle.gltf\u0000https://example.test/triangle.gltf\u00000";
    expect(primitive.material.index).toBe(0);
    expect(baseColorTexture).toMatchObject({
      identity: textureIdentity,
      source: {
        documentId: "https://example.test/triangle.gltf\u0000https://example.test/triangle.gltf",
        id: textureIdentity,
        image: {
          index: 0,
          resolvedUri: "https://example.test/triangle.png",
          uri: "triangle.png",
        },
        src: "https://example.test/triangle.gltf",
        textureIndex: 0,
      },
      state: "fallback",
    });
    expect(primitive.texture).toBe(baseColorTexture.texture);

    const fallbackTexture = baseColorTexture.texture;
    resolveImage({} as ImageBitmap);
    await waitFor(() => baseColorTexture.state === "ready");

    expect(primitive.material.baseColorTexture).toBe(baseColorTexture);
    expect(baseColorTexture.texture).not.toBe(fallbackTexture);
    expect(primitive.texture).toBe(baseColorTexture.texture);
    cache.dispose();
  });

  it("keeps the renderer fallback texture when a glTF texture is unavailable", async () => {
    const decodeError = new Error("decode failed");
    let rejectImage!: (error: unknown) => void;
    const imagePromise = new Promise<ImageBitmap>((_resolve, reject) => {
      rejectImage = reject;
    });
    installFixture(undefined, () => imagePromise);
    const { gl } = fakeGl();
    const onReady = vi.fn();
    const cache = new GltfCache(gl, onReady);
    const node = gltf({ src: triangleSrc });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);
    expect(onReady).toHaveBeenCalledTimes(1);

    const asset = cache.get(node);
    expect(asset).toBeDefined();
    const primitive = asset!.primitives[0]!;
    const fallbackTexture = primitive.texture;

    const imageSettled = imagePromise.catch(() => undefined);
    rejectImage(decodeError);
    await imageSettled;
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(cache.get(node)).toBe(asset);
    expect(primitive.material.baseColorTexture.state).toBe("fallback");
    expect(primitive.material.baseColorTexture.texture).toBe(fallbackTexture);
    expect(primitive.texture).toBe(fallbackTexture);
    cache.dispose();
  });

  it("deletes fallback and late-loaded textures when disposed", async () => {
    let resolveImage!: (image: ImageBitmap) => void;
    const imagePromise = new Promise<ImageBitmap>((resolve) => {
      resolveImage = resolve;
    });
    installFixture(undefined, () => imagePromise);
    const { counts, gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ src: triangleSrc });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);

    expect(counts.createTexture).toBe(1);
    expect(counts.deleteTexture).toBe(0);

    cache.dispose();
    expect(counts.deleteTexture).toBe(1);

    resolveImage({} as ImageBitmap);
    await waitFor(() => counts.deleteTexture === 2);
    expect(counts.createTexture).toBe(2);
  });

  it("reuses loaded assets by URI and version", async () => {
    installFixture();
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ src: triangleSrc, version: 1 });
    const sameRevision = gltf({
      src: triangleSrc,
      version: 1,
    });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);
    const fetchCalls = vi.mocked(fetch).mock.calls.length;

    expect(cache.get(sameRevision)).toBe(cache.get(node));
    expect(fetch).toHaveBeenCalledTimes(fetchCalls);
    cache.dispose();
  });
});

import { gltf } from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import { GltfCache } from "../src/gltf-cache";
import { makeTriangleFixture } from "../../../tests/gltf-fixture";
import { fakeGl, waitFor } from "../../../tests/webgl-test-utils";

type MutableFixtureJson = {
  readonly accessors: Array<Record<string, unknown>>;
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

const triangleAsset = (
  overrides: Partial<Parameters<typeof gltf>[0]["asset"]> = {},
): Parameters<typeof gltf>[0]["asset"] => ({
  id: "triangle",
  uri: "https://example.test/triangle.gltf",
  ...overrides,
});

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
      asset: triangleAsset(),
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
    const node = gltf({ asset: triangleAsset() });

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

describe("GltfCache textures", () => {
  it("keeps stable base-color texture identity while the WebGL texture loads", async () => {
    let resolveImage!: (image: ImageBitmap) => void;
    const imagePromise = new Promise<ImageBitmap>((resolve) => {
      resolveImage = resolve;
    });
    installFixture(undefined, () => imagePromise);
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ asset: triangleAsset() });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);

    const asset = cache.get(node);
    expect(asset).toBeDefined();
    const primitive = asset!.primitives[0]!;
    const baseColorTexture = primitive.material.baseColorTexture;
    const textureIdentity = "triangle\u0000https://example.test/triangle.gltf\u00000";
    expect(primitive.material.index).toBe(0);
    expect(baseColorTexture).toMatchObject({
      identity: textureIdentity,
      source: {
        documentId: "triangle\u0000https://example.test/triangle.gltf",
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

  it("deletes fallback and late-loaded textures when disposed", async () => {
    let resolveImage!: (image: ImageBitmap) => void;
    const imagePromise = new Promise<ImageBitmap>((resolve) => {
      resolveImage = resolve;
    });
    installFixture(undefined, () => imagePromise);
    const { counts, gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ asset: triangleAsset() });

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

  it("reuses loaded assets by id and revision", async () => {
    installFixture();
    const { gl } = fakeGl();
    const cache = new GltfCache(gl, () => undefined);
    const node = gltf({ asset: triangleAsset({ revision: 1 }) });
    const sameRevision = gltf({
      asset: triangleAsset({
        revision: 1,
        uri: "https://example.test/alternate-triangle.gltf",
      }),
    });

    expect(cache.get(node)).toBeUndefined();
    await waitFor(() => cache.get(node) !== undefined);

    expect(cache.get(sameRevision)).toBe(cache.get(node));
    expect(fetch).not.toHaveBeenCalledWith("https://example.test/alternate-triangle.gltf");
    cache.dispose();
  });
});

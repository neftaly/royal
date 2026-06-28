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
    vi.fn(() => Promise.resolve({} as ImageBitmap)),
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
      src: "https://example.test/triangle.gltf",
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
    const node = gltf({ src: "https://example.test/triangle.gltf" });

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

import { describe, expect, it, vi } from "vitest";
import {
  readHostGltfResource,
  resolveRendererRootDependencies,
  createGltfResourceReaderPlatform,
  type GltfResourceReader,
} from "../../packages/renderer-webgl/src/runtime/gltf-resource-reader";

describe("renderer-root glTF resource reader", () => {
  it("validates one narrow stable dependency object", () => {
    const reader = vi.fn();
    expect(resolveRendererRootDependencies({ gltfResourceReader: reader }))
      .toEqual({ gltfResourceReader: reader });
    expect(() => resolveRendererRootDependencies(null as never)).toThrow("must be an object");
    expect(() => resolveRendererRootDependencies({ unknown: true } as never))
      .toThrow("unsupported field unknown");
    expect(() => resolveRendererRootDependencies({ gltfResourceReader: 1 } as never))
      .toThrow("must be a function");
  });

  it("forwards identity and cancellation while rejecting invalid runtime output", async () => {
    const signal = new AbortController().signal;
    const request = { kind: "buffer", uri: "/model.bin", version: "v3" } as const;
    const bytes = new Uint8Array([1, 2, 3]);
    const reader = vi.fn<GltfResourceReader>(async () => bytes);
    await expect(readHostGltfResource(reader, request, signal)).resolves.toBe(bytes);
    expect(reader).toHaveBeenCalledWith(request, signal);

    await expect(readHostGltfResource(
      vi.fn(async () => new ArrayBuffer(3) as never),
      request,
      signal,
    )).rejects.toThrow("must return Uint8Array");
  });

  it("adapts root, buffer, and external-image reads to one host identity", async () => {
    const bytes = new Uint8Array([1]);
    const reader = vi.fn<GltfResourceReader>(async () => bytes);
    const platform = createGltfResourceReaderPlatform({ gltfResourceReader: reader })!;
    const asset = { src: "/models/table.gltf", version: "release-8" } as const;
    const signal = new AbortController().signal;

    await platform.readGltf!(asset, signal);
    await platform.readGltfResource(asset, "/models/shared.bin", signal);
    await platform.readGltfTextureResource!({
      gltfResource: true,
      kind: "asset",
      src: "/models/shared.png",
      version: "release-8",
    }, signal);

    expect(platform.readGltfResourceRanges).toBe(false);
    expect(reader.mock.calls.map(([request]) => request)).toEqual([
      { kind: "root", uri: "/models/table.gltf", version: "release-8" },
      { kind: "buffer", uri: "/models/shared.bin", version: "release-8" },
      { kind: "image", uri: "/models/shared.png", version: "release-8" },
    ]);
    expect(reader.mock.calls.every(([, receivedSignal]) => receivedSignal === signal)).toBe(true);
  });
});

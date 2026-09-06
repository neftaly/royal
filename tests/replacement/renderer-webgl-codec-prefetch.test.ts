import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
import { readCanonicalStaticGltfSource } from "../../packages/renderer-webgl/src/gltf/static-source";
import { staticTriangleGlb } from "./support/static-glb";

const codecs = vi.hoisted(() => ({
  draco: vi.fn(async () => ({})),
  meshopt: vi.fn(async () => ({})),
}));
vi.mock("../../packages/renderer-webgl/src/gltf/codec-loader", () => ({
  loadDracoCodec: codecs.draco,
  loadMeshoptCodec: codecs.meshopt,
}));
beforeEach(() => vi.clearAllMocks());

it("starts Draco delivery while external geometry is still in flight", async () => {
  const fixture = new URL("../../apps/examples-react/public/fixtures/khronos/Duck/glTF-Draco/", import.meta.url);
  const bytes = new Uint8Array(readFileSync(new URL("Duck.gltf", fixture)));
  const binary = new Uint8Array(readFileSync(new URL("Duck.bin", fixture)));
  let release!: (bytes: Uint8Array) => void;
  const read = vi.fn(() => new Promise<Uint8Array>((resolve) => { release = resolve; }));
  const pending = readCanonicalStaticGltfSource(bytes, "Duck", "https://assets.test/Duck.gltf", read);
  expect(read).toHaveBeenCalledOnce();
  expect(codecs.draco).toHaveBeenCalledOnce();
  expect(codecs.meshopt).not.toHaveBeenCalled();
  release(binary);
  await expect(pending).resolves.toMatchObject({ container: "gltf" });
});

it("does not load codecs for ordinary uncompressed geometry", async () => {
  await readCanonicalStaticGltfSource(staticTriangleGlb(), "triangle", "https://assets.test/triangle.glb", vi.fn());
  expect(codecs.draco).not.toHaveBeenCalled();
  expect(codecs.meshopt).not.toHaveBeenCalled();
});

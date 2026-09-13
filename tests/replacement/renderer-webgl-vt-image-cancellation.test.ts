import { afterEach, expect, it, vi } from "vitest";
import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { identityMat4 } from "../../packages/renderer-webgl/src/math/mat4";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { fakeGl } from "./support/canvas-root-harness";
import { readVirtualTexturePage } from "../../packages/renderer-webgl/src/virtual-texture/browser-page-source";
import { parseVirtualTextureManifest } from "../../packages/renderer-webgl/src/virtual-texture/manifest";
import { waitFor } from "./support/wait-for";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["remove", "dispose", "invalidate"])("settles a late resize correctly after %s", async action => {
  vi.stubGlobal("document", { baseURI: "https://fixture.invalid/" });
  vi.stubGlobal("fetch", vi.fn(async (input: URL | RequestInfo) => new Response(String(input).endsWith('.json')
    ? JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 8,
      virtualSize: [128, 128], pages: { uriTemplate: '{page}.png' } }) : new Uint8Array([1]))));
  let release: ((bitmap: ImageBitmap) => void) | undefined;
  const firstClose = vi.fn(), resizedClose = vi.fn();
  vi.stubGlobal("createImageBitmap", vi.fn()
    .mockResolvedValueOnce({ width: 128, height: 128, close: firstClose })
    .mockImplementationOnce(() => new Promise<ImageBitmap>(resolve => { release = resolve; })));
  const gl = fakeGl(), runtime = createBrowserVirtualTextureRuntime(gl, vi.fn());
  const camera = perspectiveCamera({}), matrix = identityMat4();
  const view = { view: matrix, viewProjection: matrix, viewport: { x: 0, y: 0, width: 128, height: 128 } };
  try {
    runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera, nodes: [mesh({ geometry: planeGeometry(2),
      material: unlitMaterial({ texture: virtualTexture('https://fixture.invalid/index.json') }) })] })));
    await waitFor(() => { runtime.update([view]); expect(release).toBeDefined(); });
    expect(firstClose).toHaveBeenCalledOnce();
    expect(createImageBitmap).toHaveBeenCalledTimes(2);
    if (action === "remove") runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera, nodes: [] })));
    else if (action === "dispose") runtime.dispose();
    else runtime.invalidate();
    const uploads = vi.mocked(gl.texSubImage2D).mock.calls.length;
    release!({ width: 144, height: 144, close: resizedClose } as unknown as ImageBitmap);
    if (action === "invalidate") {
      // CPU work survives context loss; it must stay queued until a restored update.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(resizedClose).not.toHaveBeenCalled();
      expect(gl.texSubImage2D).toHaveBeenCalledTimes(uploads);
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 1, pendingPageBytes: 144 * 144 * 4, uploadedPages: 0 });
      await waitFor(() => { runtime.update([view]); expect(runtime.runtimeSnapshot().residentPages).toBe(1); });
      expect(createImageBitmap).toHaveBeenCalledTimes(2);
    }
    await waitFor(() => {
      expect(resizedClose).toHaveBeenCalledOnce();
      expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, pendingPageBytes: 0, uploadedPages: action === "invalidate" ? 1 : 0 });
    });
    if (action !== "invalidate") expect(gl.texSubImage2D).toHaveBeenCalledTimes(uploads);
    expect(firstClose).toHaveBeenCalledOnce();
  } finally { runtime.dispose(); }
});

it.each([128, 144, 4096].flatMap(size => [false, true].map(cancelled => ({ size, cancelled }))))(
  "owns a $size-pixel bitmap correctly, cancelled $cancelled", async ({ size, cancelled }) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1]))));
  let release: ((bitmap: ImageBitmap) => void) | undefined;
  vi.stubGlobal("createImageBitmap", vi.fn()
    .mockImplementationOnce(() => new Promise<ImageBitmap>(resolve => { release = resolve; }))
    .mockResolvedValue({ width: 144, height: 144, close: vi.fn() }));
  const manifest = parseVirtualTextureManifest({ contractVersion: 2, pageSize: 128, borderTexels: 8,
    virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } });
  const controller = new AbortController();
  const pending = readVirtualTexturePage("https://fixture.invalid/index.json", manifest,
    { mip: 0, x: 0, y: 0 }, controller.signal);
  await waitFor(() => expect(release).toBeDefined());
  const rejected = cancelled ? expect(pending).rejects.toMatchObject({ name: "AbortError" }) : undefined;
  if (cancelled) controller.abort();
  const close = vi.fn();
  release!({ width: size, height: size, close } as unknown as ImageBitmap);
  if (cancelled) await rejected;
  else {
    const page = await pending;
    expect(page?.kind).toBe("image");
    if (page?.kind !== "image") throw new Error("Expected image page");
    expect(page.source).toMatchObject({ width: 144, height: 144 });
    page.close();
  }
  expect(close).toHaveBeenCalledOnce();
  expect(createImageBitmap).toHaveBeenCalledTimes(cancelled || size === 144 ? 1 : 2);
});

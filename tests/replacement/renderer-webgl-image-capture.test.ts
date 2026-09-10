import { rendererAcquireExternalClock } from "../../packages/renderer-webgl/src/frame/external-frame";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boxGeometry, directionalLight, gltf, mesh, perspectiveCamera, scene, standardMaterial } from "@royal/renderer-core";
import { captureImage, captureImageRequest, type ImageCaptureHost } from "../../packages/renderer-webgl/src/runtime/image-capture";
import { canvasRootHarness, emptyScene } from "./support/canvas-root-harness";
import { staticTriangleDocument, staticTriangleGlb } from "./support/static-glb";

const hostHarness = () => {
  const frames: Array<() => void> = [];
  const callbacks: BlobCallback[] = [];
  const lifecycle = new Set<() => void>();
  let now = 0;
  const host: ImageCaptureHost = {
    assertCurrent: vi.fn(),
    prepare: vi.fn(() => { now += 10; return true; }),
    draw: vi.fn(() => { now += 2; return true; }),
    encode: (callback) => { callbacks.push(callback); },
    now: () => now,
    requestFrame: (callback) => { frames.push(callback); },
    subscribeLifecycle: (callback) => {
      lifecycle.add(callback);
      return () => { lifecycle.delete(callback); };
    },
  };
  return { host, frames, callbacks, lifecycle, advance: (ms: number) => { now += ms; } };
};

afterEach(() => vi.useRealTimers());

describe("bounded renderer image capture", () => {
  it("waits for the lazy linear compositor before encoding transparent standard surfaces", async () => {
    const { root, canvas, callbacks } = canvasRootHarness({}, {
      getExtension: vi.fn((name: string) => name === 'EXT_color_buffer_float' || name === 'EXT_float_blend' ? {} : null) as WebGL2RenderingContext['getExtension'],
    });
    const encode = vi.fn((callback: BlobCallback) => {
      expect(canvas.gl.createFramebuffer).toHaveBeenCalled();
      expect(canvas.gl.drawArrays).toHaveBeenCalled();
      callback(new Blob(['png']));
    });
    Object.assign(canvas, { toBlob: encode });
    try {
      root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 });
      root.setScene(scene({ camera: perspectiveCamera({ position: [0, 0, 4] }), nodes: [
        mesh({ geometry: boxGeometry(1), material: standardMaterial({ color: [1, 0.5, 0.2, 0.5] }) }),
        directionalLight({ direction: [0, 0, -1] }),
      ] }));
      const result = captureImage(root); void result.catch(() => undefined);
      expect(encode).not.toHaveBeenCalled();
      await vi.waitFor(() => {
        callbacks.splice(0).forEach(callback => callback());
        expect(encode, JSON.stringify(root.getSnapshot())).toHaveBeenCalledOnce();
      });
      await result;
    } finally { root.dispose(); }
  });

  it("starts encoding in the draw task and reports nonoverlapping stage timings", async () => {
    const { host, callbacks, lifecycle, advance } = hostHarness();
    const result = captureImageRequest(host, {});
    expect(callbacks).toHaveLength(1);
    advance(7);
    const blob = new Blob(["PNG"], { type: "image/png" });
    callbacks[0]!(blob);
    expect(await result).toEqual({ blob, timings: {
      preparationMs: 10, drawSubmissionMs: 2, readbackAndEncodingMs: 7, totalMs: 19,
    } });
    expect(lifecycle.size).toBe(0);
  });

  it("rechecks readiness after drawing and never encodes a pending publication", async () => {
    const h = hostHarness();
    vi.mocked(h.host.draw).mockReturnValueOnce(false);
    const result = captureImageRequest(h.host, {});
    expect(h.callbacks).toHaveLength(0);
    h.frames.shift()!();
    expect(h.callbacks).toHaveLength(1);
    h.callbacks[0]!(new Blob());
    await result;
  });

  it.each(["waiting", "encoding"])("cancels during %s and ignores late callbacks", async (phase) => {
    const h = hostHarness();
    if (phase === "waiting") vi.mocked(h.host.prepare).mockReturnValue(false);
    const controller = new AbortController();
    const result = captureImageRequest(h.host, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    h.frames.forEach((callback) => callback());
    h.callbacks.forEach((callback) => callback(new Blob()));
    expect(h.lifecycle.size).toBe(0);
    expect(h.host.prepare).toHaveBeenCalledTimes(1);
  });

  it("rejects an already-aborted request before any preparation", async () => {
    const h = hostHarness();
    const controller = new AbortController();
    controller.abort();
    await expect(captureImageRequest(h.host, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(h.host.prepare).not.toHaveBeenCalled();
  });

  it.each(["waiting", "encoding"])("times out during %s even without another frame", async (phase) => {
    vi.useFakeTimers();
    const h = hostHarness();
    if (phase === "waiting") vi.mocked(h.host.prepare).mockReturnValue(false);
    const result = captureImageRequest(h.host, { timeoutMs: 30 });
    const rejected = expect(result).rejects.toThrow(/timed out/);
    vi.advanceTimersByTime(30);
    await rejected;
    expect(h.lifecycle.size).toBe(0);
    h.callbacks.forEach((callback) => callback(new Blob()));
  });

  it("rejects encoding after the deadline even before the timeout task runs", async () => {
    const h = hostHarness();
    const result = captureImageRequest(h.host, { timeoutMs: 30 });
    h.advance(30);
    h.callbacks[0]!(new Blob());
    await expect(result).rejects.toThrow(/timed out/);
    expect(h.lifecycle.size).toBe(0);
  });

  it("does not prepare another frame after an elapsed deadline", async () => {
    const h = hostHarness();
    vi.mocked(h.host.prepare).mockReturnValue(false);
    const result = captureImageRequest(h.host, { timeoutMs: 30 });
    h.advance(30);
    h.frames.shift()!();
    await expect(result).rejects.toThrow(/timed out/);
    expect(h.host.prepare).toHaveBeenCalledOnce();
  });

  it.each([null, {}, true, { aborted: false }])("rejects malformed cancellation signals (%j)", async (signal) => {
    const h = hostHarness();
    await expect(captureImageRequest(h.host, { signal } as never)).rejects.toThrow(/AbortSignal/);
    expect(h.host.prepare).not.toHaveBeenCalled();
    expect(h.lifecycle.size).toBe(0);
  });

  it("rejects lifecycle loss while encoding and releases observation", async () => {
    const h = hostHarness();
    const result = captureImageRequest(h.host, {});
    vi.mocked(h.host.assertCurrent).mockImplementation(() => { throw new Error("context lost"); });
    h.lifecycle.forEach((callback) => callback());
    await expect(result).rejects.toThrow("context lost");
    expect(h.lifecycle.size).toBe(0);
  });

  it("rejects unsupported policy fields and invalid deadlines before drawing", async () => {
    const h = hostHarness();
    for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
      await expect(captureImageRequest(h.host, { timeoutMs })).rejects.toThrow(/timeoutMs/);
    }
    await expect(captureImageRequest(h.host, { extra: true } as never)).rejects.toThrow(/unsupported field/);
    await expect(captureImageRequest(h.host, { refinement: "fast" } as never)).rejects.toThrow(/refinement/);
    expect(h.host.draw).not.toHaveBeenCalled();
  });

  it("rejects an external clock immediately, then permits capture after release", async () => {
    const { root, canvas } = canvasRootHarness();
    Object.assign(canvas, { toBlob: (callback: BlobCallback) => callback(new Blob()) });
    root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 });
    root.setScene(emptyScene());
    const external = root[rendererAcquireExternalClock]();
    await expect(captureImage(root)).rejects.toThrow(/canvas frame clock/);
    external.release();
    await expect(captureImage(root)).resolves.toHaveProperty("blob");
    root.dispose();
  });

  it("rejects null and throwing encoders", async () => {
    const h = hostHarness();
    const result = captureImageRequest(h.host, {});
    h.callbacks[0]!(null);
    await expect(result).rejects.toThrow(/encode/);
    await expect(captureImageRequest({ ...h.host, encode: () => { throw new Error("tainted"); } }, {}))
      .rejects.toThrow("tainted");
  });

  it("waits for real glTF preparation and submits the final canvas frame before encoding", async () => {
    let release!: (bytes: Uint8Array) => void;
    const { root, canvas, callbacks } = canvasRootHarness({
      readGltf: () => new Promise((resolve) => { release = resolve; }),
    });
    const encode = vi.fn((callback: BlobCallback) => {
      expect(canvas.gl.drawElements.mock.calls.length + canvas.gl.drawElementsInstanced.mock.calls.length).toBeGreaterThan(0);
      callback(new Blob(["PNG"]));
    });
    Object.assign(canvas, { toBlob: encode });
    try {
      root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 });
      root.setScene(scene({ camera: perspectiveCamera({ position: [1, 2, 6] }), nodes: [gltf("/triangle.glb")] }));
      const result = captureImage(root);
      void result.catch(() => undefined);
      expect(encode).not.toHaveBeenCalled();
      await vi.waitFor(() => expect(release).toBeTypeOf("function"));
      release(staticTriangleGlb(staticTriangleDocument()));
      await vi.waitFor(() => {
        const frameCallbacks = callbacks.splice(0);
        frameCallbacks.forEach((callback) => callback());
        expect(encode, JSON.stringify(root.getSnapshot())).toHaveBeenCalledOnce();
      }, { timeout: 5000 });
      expect((await result).blob.size).toBe(3);
    } finally { root.dispose(); }
  });

  it.each(["dispose", "loss", "scene", "size"])("rejects %s during encoding and permits cleanup", async (change) => {
    const { root, canvas } = canvasRootHarness();
    let callback!: BlobCallback;
    Object.assign(canvas, { toBlob: (value: BlobCallback) => { callback = value; } });
    root.setSize({ cssWidth: 60, cssHeight: 60, pixelRatio: 1 });
    root.setScene(emptyScene());
    const result = captureImage(root);
    await expect(captureImage(root)).rejects.toThrow(/already in progress/);
    if (change === "dispose") root.dispose();
    if (change === "loss") canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    if (change === "scene") root.setScene(emptyScene());
    if (change === "size") root.setSize({ cssWidth: 30, cssHeight: 30, pixelRatio: 1 });
    callback(new Blob());
    await expect(result).rejects.toThrow();
    root.dispose();
  });
});

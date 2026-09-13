import { mesh, perspectiveCamera, planeGeometry, scene, unlitMaterial, virtualTexture } from "@royal/renderer-core";
import { afterEach, expect, it, vi } from "vitest";
import { AsyncPreparationOwner } from "../../packages/renderer-webgl/src/resource/async-preparation-owner";
import { createBrowserVirtualTextureRuntime } from "../../packages/renderer-webgl/src/virtual-texture/runtime";
import { prepareCanonicalSurfaceScene } from "../../packages/renderer-webgl/src/surface/scene-lowering";
import { fakeGl } from "./support/canvas-root-harness";
import { waitFor } from "./support/wait-for";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("preserves provisional storage during reentrant scene-replacement notifications", async () => {
  const reads: Array<(response: Response) => void> = [];
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => reads.push(resolve))));
  const observed: Array<boolean | undefined> = [];
  const runtime = createBrowserVirtualTextureRuntime(fakeGl(), () => { observed.push(runtime.authoredStorageRequired); });
  const prepare = (name: string) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}), nodes: [
    mesh({ geometry: planeGeometry(2), material: unlitMaterial({ texture: virtualTexture(`/${name}.json`) }) }),
  ] }));
  const response = () => new Response(JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 8,
    virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } }));
  try {
    runtime.setScene(prepare("first"));
    await waitFor(() => expect(reads).toHaveLength(1));
    reads[0]!(response());
    await waitFor(() => expect(runtime.authoredStorageRequired).toBe(true));
    observed.length = 0;
    runtime.setScene(prepare("second"));
    expect(observed).toEqual([undefined]);
    expect(runtime.authoredStorageRequired).toBeUndefined();
    await waitFor(() => expect(reads).toHaveLength(2));
    reads[1]!(response());
    await waitFor(() => expect(runtime.authoredStorageRequired).toBe(true));
  } finally { runtime.dispose(); }
});

it("keeps ignored-abort transports bounded through scene replacement and refills on settlement", async () => {
  const reads: { url: string; signal: AbortSignal; resolve(response: Response): void }[] = [];
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>(resolve => {
    reads.push({ url: String(input), signal: init!.signal!, resolve });
  })));
  const geometry = planeGeometry(2), changed = vi.fn(), gl = fakeGl();
  const runtime = createBrowserVirtualTextureRuntime(gl, changed);
  const assets = Array.from({ length: 24 }, (_, index) => virtualTexture(`https://example.test/${index}/vt.json`));
  const prepare = (start: number) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
    nodes: assets.slice(start, start + 8).map(texture => mesh({ geometry, material: unlitMaterial({ texture }) })),
  }));
  const response = () => new Response(JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 8,
    virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } }));
  try {
    runtime.setScene(prepare(0));
    await waitFor(() => expect(reads).toHaveLength(8));
    runtime.setScene(prepare(8));
    const latest = prepare(16);
    runtime.setScene(latest);
    for (let frame = 0; frame < 100; frame++) { runtime.setScene(latest); runtime.update([]); }
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(reads).toHaveLength(8);
    expect(reads.every(read => read.signal.aborted)).toBe(true);
    const notifications = changed.mock.calls.length;
    const allocations = vi.mocked(gl.createTexture).mock.calls.length;
    // One obsolete successful response frees exactly one slot for the latest scene.
    reads[0]!.resolve(response());
    await waitFor(() => expect(reads).toHaveLength(9));
    expect(reads[8]!.url).toContain("/16/");
    expect(changed).toHaveBeenCalledTimes(notifications);
    expect(gl.createTexture).toHaveBeenCalledTimes(allocations);
    reads.slice(1, 8).forEach(read => read.resolve(response()));
    await waitFor(() => expect(reads).toHaveLength(16));
    expect(reads.slice(8).map(read => read.url)).toEqual(assets.slice(16).map((_, index) => `https://example.test/${index + 16}/vt.json`));
    expect(changed).toHaveBeenCalledTimes(notifications);
    reads.slice(8).forEach(read => read.resolve(response()));
    await waitFor(() => assets.slice(16).forEach(asset => expect(runtime.snapshot(asset).status).toBe("ready")));
    expect(reads).toHaveLength(16);
  } finally { runtime.dispose(); }
});

it.each(["transport", "http", "json", "schema"])("refills after a %s manifest failure and retries only a new version", async failure => {
  const reads: { resolve(response: Response): void; reject(error: Error): void }[] = [];
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    reads.push({ resolve, reject });
  })));
  const manifest = { contractVersion: 2, pageSize: 128, borderTexels: 8,
    virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } };
  const assets = Array.from({ length: 9 }, (_, index) => virtualTexture(`https://example.test/${index}/vt.json`));
  const geometry = planeGeometry(2);
  const prepare = () => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
    nodes: assets.map(texture => mesh({ geometry, material: unlitMaterial({ texture }) })),
  }));
  const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn());
  try {
    const prepared = prepare(); runtime.setScene(prepared);
    await waitFor(() => expect(reads).toHaveLength(8));
    if (failure === "transport") reads[0]!.reject(new Error("Manifest transport failed"));
    else reads[0]!.resolve(failure === "http" ? new Response("Unavailable", { status: 503 })
      : new Response(failure === "json" ? "{" : JSON.stringify({ ...manifest, pageSize: 0 })));
    await waitFor(() => {
      expect(runtime.snapshot(assets[0]!).status).toBe("error");
      expect(reads).toHaveLength(9);
    });
    // Seven earlier requests are still held; the ninth source must progress.
    reads[8]!.resolve(new Response(JSON.stringify(manifest)));
    await waitFor(() => expect(runtime.snapshot(assets[8]!).status).toBe("ready"));
    for (let frame = 0; frame < 100; frame++) { runtime.setScene(prepared); runtime.update([]); }
    expect(reads).toHaveLength(9);
    expect(runtime.snapshot(assets[0]!).status).toBe("error");
    assets[0] = virtualTexture({ manifestUri: "https://example.test/0/vt.json", version: 1 });
    runtime.setScene(prepare());
    await waitFor(() => expect(reads).toHaveLength(10));
    reads[9]!.resolve(new Response(JSON.stringify(manifest)));
    await waitFor(() => expect(runtime.snapshot(assets[0]!).status).toBe("ready"));
    expect(runtime.snapshot(assets[8]!).status).toBe("ready");
  } finally { runtime.dispose(); }
});

it("disposes a full manifest queue and ignores late responses from transports that ignore abort", async () => {
  const signals: AbortSignal[] = [], responses: ((response: Response) => void)[] = [];
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn((_input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>(resolve => {
    signals.push(init!.signal!); responses.push(resolve);
  })));
  const gl = fakeGl(), changed = vi.fn();
  const runtime = createBrowserVirtualTextureRuntime(gl, changed);
  try {
    const geometry = planeGeometry(2);
    runtime.setScene(prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
      nodes: Array.from({ length: 12 }, (_, index) => mesh({ geometry,
        material: unlitMaterial({ texture: virtualTexture(`https://example.test/${index}/vt.json`) }) })),
    })));
    await waitFor(() => expect(responses).toHaveLength(8));
    runtime.dispose();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    const notifications = changed.mock.calls.length;
    const reads = vi.mocked(fetch).mock.calls.length;
    const allocations = vi.mocked(gl.createTexture).mock.calls.length;
    const bodies = responses.map(() => {
      const response = new Response();
      vi.spyOn(response, "json").mockResolvedValue({ contractVersion: 2, pageSize: 128, borderTexels: 8,
        virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } });
      return response;
    });
    responses.forEach((resolve, index) => resolve(bodies[index]!));
    // Drain transport, JSON, scheduler and source-publication continuations.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(fetch).toHaveBeenCalledTimes(reads);
    expect(changed).toHaveBeenCalledTimes(notifications);
    expect(gl.createTexture).toHaveBeenCalledTimes(allocations);
    expect(runtime.runtimeSnapshot()).toMatchObject({ pendingPages: 0, residentPages: 0, atlasPools: 0 });
  } finally { runtime.dispose(); }
});

it("bounds manifest reads independently of preparation and cancels queued and active claims", async () => {
  const preparation = new AsyncPreparationOwner(8);
  let active = 0, peak = 0, aborted = 0;
  const reads: { url: string; resolve(): void }[] = [];
  vi.stubGlobal("document", { baseURI: "https://example.test/" });
  vi.stubGlobal("fetch", vi.fn((input: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    active++; peak = Math.max(peak, active);
    const abort = () => { active--; aborted++; reject(new DOMException("Aborted", "AbortError")); };
    init?.signal?.addEventListener("abort", abort, { once: true });
    reads.push({ url: String(input), resolve: () => {
      init?.signal?.removeEventListener("abort", abort); active--;
      resolve(new Response(JSON.stringify({ contractVersion: 2, pageSize: 128, borderTexels: 8,
        virtualSize: [128, 128], pages: { uriTemplate: "{page}.png" } })));
    } });
  })));
  const assets = Array.from({ length: 10 }, (_, index) => virtualTexture(`https://example.test/${index}/vt.json`));
  const geometry = planeGeometry(2);
  const preparedScene = (indices: number[]) => prepareCanonicalSurfaceScene(scene({ camera: perspectiveCamera({}),
    nodes: indices.map(index => mesh({ geometry, material: unlitMaterial({ texture: assets[index]! }) })),
  }));
  const runtime = createBrowserVirtualTextureRuntime(fakeGl(), vi.fn(), undefined, preparation.runForeground);
  try {
    runtime.setScene(preparedScene(assets.map((_, index) => index)));
    await waitFor(() => expect(reads).toHaveLength(8));
    const prepared = vi.fn();
    void preparation.runForeground(new AbortController().signal, async () => prepared()).catch(() => {});
    await waitFor(() => expect(prepared).toHaveBeenCalledOnce());
    expect(active).toBe(8);
    // Remove a queued claim before freeing an active slot.
    runtime.setScene(preparedScene([0, 1, 2, 3, 4, 5, 6, 7, 8]));
    runtime.setScene(preparedScene([1, 2, 3, 4, 5, 6, 7, 8]));
    await waitFor(() => expect(reads).toHaveLength(9));
    expect(reads[8]!.url).toContain("/8/");
    reads[1]!.resolve();
    await waitFor(() => expect(runtime.snapshot(assets[1]!).status).toBe("ready"));
    runtime.dispose();
    await waitFor(() => expect(active).toBe(0));
    expect(peak).toBe(8);
    expect(aborted).toBe(8);
    expect(reads).toHaveLength(9);
    expect(reads.some(read => read.url.includes("/9/"))).toBe(false);
  } finally { runtime.dispose(); preparation.dispose(); }
});

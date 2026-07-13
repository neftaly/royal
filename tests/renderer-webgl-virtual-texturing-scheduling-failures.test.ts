import { describe, expect, it, vi } from "vitest";
import {
  mesh,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import {
  type SurfaceMaterial,
} from "../packages/renderer-webgl/src/webgl/materials";
import {
  createWebGlRoot,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installFetchQueue,
  responseJson,
  camera,
  renderScene,
  renderVirtualTextureMaterials,
  vtManifest,
  vtSinglePageManifest,
  vtPersistentGpuHardLimitPolicy,
  vtStereoManifest,
  stereoVirtualTextureMaterial,
  stereoVirtualTextureScene,
  leftStereoView,
  rightStereoView,
  vtDenseMipManifest,
  flushMicrotasks,
  flushVirtualTextureManifest,
  pageUploads,
  imageBySrc,
} from "./renderer-webgl-virtual-texturing-fixtures";

describe("WebGL renderer virtual texturing scheduling and failures", () => {
  it("rotates global request grants so fixed draw order cannot starve later virtual textures", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_unused, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    expect(fetchRequests).toHaveLength(5);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(4);
    for (const page of ControlledImage.instances) page.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 4 && ControlledImage.instances.length < 5; frame += 1) {
      scheduledFrames.shift()?.(frame);
      await flushMicrotasks();
    }
    expect(ControlledImage.instances).toHaveLength(5);
    ControlledImage.instances[4]!.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 3; frame += 1) root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 5, uploadedPages: 5 });
    root.dispose();
  });

  it("backs off rejected VT pages with an explicit wake and a bounded retry cap", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(1);
    const wakesBeforeFailure = requestAnimationFrame.mock.calls.length;

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesBeforeFailure + 1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });

    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(50);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleError();
    await flushMicrotasks();
    root.render(graph);
    expect(ControlledImage.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(100);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    ControlledImage.instances[2]!.settleError();
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(10_000);
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(3);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 3, manifestFailures: 0 });
    root.dispose();
    vi.useRealTimers();
  });

  it("replaces a retry-exhausted page with later healthy demand and then stays quiescent", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/terminal-convergence.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushVirtualTextureManifest(root);
    const failedSrc = ControlledImage.instances[0]!.src;

    for (const retryDelay of [50, 100, undefined]) {
      const failedAttempt = ControlledImage.instances.filter((image) => image.src === failedSrc).at(-1)!;
      failedAttempt.settleError();
      await flushMicrotasks();
      if (retryDelay !== undefined) {
        await vi.advanceTimersByTimeAsync(retryDelay);
        await flushMicrotasks();
        root.flushInvalidated();
        await flushMicrotasks();
      }
    }
    expect(ControlledImage.instances.filter((image) => image.src === failedSrc)).toHaveLength(3);

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const image of ControlledImage.instances) {
        if (!image.complete && image.src !== failedSrc) image.settleLoad();
      }
      await flushMicrotasks();
      root.render(graph);
      await flushMicrotasks();
    }

    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      pageLoadFailures: 3,
      pendingPages: 0,
      residentPages: 3,
    });
    expect(new Set(
      ControlledImage.instances.filter((image) => image.src !== failedSrc).map((image) => image.src),
    ).size).toBeGreaterThanOrEqual(3);

    const settledAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    const settledRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(graph);
    await vi.advanceTimersByTimeAsync(10_000);
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(settledAdmissions);
    expect(ControlledImage.instances).toHaveLength(settledRequests);
    root.dispose();
    vi.useRealTimers();
  });

  it("keeps the per-frame VT request-start budget monotonic after a rejection", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const materials = Array.from({ length: 5 }, (_value, index) =>
      unlitMaterial({ texture: virtualTexture(`/vt/${index}.json`) }));

    const graph = renderVirtualTextureMaterials(materials);
    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(4);

    ControlledImage.instances[0]!.settleError();
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(4);
    root.render(renderVirtualTextureMaterials(materials));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(5);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, manifestFailures: 0 });
    root.dispose();
  });

  it("wakes root demand draining when budget release admits a dormant VT", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    const graph = renderVirtualTextureMaterials([first, second]);
    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(1);
    root.render(renderScene(second));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    root.dispose();
  });

  it("preserves governed retry identity through denied deletion and insertion churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const materials = ["a", "b", "c"].map((name) => unlitMaterial({
      texture: virtualTexture(`/${name}/manifest.json`),
    }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances[0]?.src).toContain("/a/pages/0-0.png");
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances.at(-1)?.src).toContain("/c/pages/0-0.png");
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    canvas.dispatchContextEvent("webglcontextlost");
    const inserted = unlitMaterial({ texture: virtualTexture("/d/manifest.json") });
    const churnGraph = renderVirtualTextureMaterials([materials[1]!, materials[2]!, inserted]);
    // Remove A before the anchored B and insert D after the surviving denied
    // candidates while capacity is unavailable. Neither change may transfer
    // B's first chance to C.
    root.render(churnGraph);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(churnGraph);
    await flushMicrotasks();
    expect(ControlledImage.instances.at(-1)?.src).toContain("/b/pages/0-0.png");
    root.dispose();
  });

  it("contains and reports a dormant allocation fault triggered by another VT's release", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(80),
    });
    const first = unlitMaterial({ texture: virtualTexture("/vt/first.json") });
    const second = unlitMaterial({ texture: virtualTexture("/vt/second.json") });

    root.render(renderVirtualTextureMaterials([first, second]));
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    vi.mocked(gl.texImage2D).mockImplementation(() => {
      throw new Error("dormant allocation rejected");
    });

    expect(() => root.render(renderScene(second))).not.toThrow();
    await flushMicrotasks();
    const wakesAfterFailure = requestAnimationFrame.mock.calls.length;
    expect(root.snapshot().virtualTexturing).toMatchObject({ gpuAdmissionFailures: 1 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(
      /GPU resource admission failed: dormant allocation rejected/,
    );
    root.render(renderScene(second));
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesAfterFailure);
  });

  it("withholds VT visibility and image close until dirty page-table retry succeeds", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const pageTableUploadFailure: { enabled: boolean; error?: unknown } = { enabled: false };
    const { calls, gl } = fakeGl({ pageTableUploadFailure });
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    // Replace the context-free bootstrap with the page selected by the real
    // draw before exercising upload failure. The bootstrap image is stale once
    // frame demand commits and should not be the page under retry.
    root.render(graph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    const closesBeforeDemandedUpload = ControlledImage.closeCalls;
    pageTableUploadFailure.enabled = true;
    pageTableUploadFailure.error = undefined;
    ControlledImage.closeError = new Error("close failure");
    demandedPage.settleLoad();
    await flushMicrotasks();

    let threw = false;
    let caught: unknown = "not-thrown";
    try {
      root.render(graph);
    } catch (error) {
      threw = true;
      caught = error;
    }
    expect(threw).toBe(true);
    expect(caught).toBeUndefined();
    expect(ControlledImage.closeCalls).toBe(closesBeforeDemandedUpload);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 0,
      cachedPages: 1,
      residentPages: 1,
      uploadedPages: 0,
    });

    pageTableUploadFailure.enabled = false;
    expect(() => root.render(graph)).toThrow(ControlledImage.closeError);
    expect(ControlledImage.closeCalls).toBe(closesBeforeDemandedUpload + 1);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 1, uploadedPages: 1 });
  });

  it("does not let an eviction outcome clear a newer request for the evicted page", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const pageTableUploadFailure: { enabled: boolean } = { enabled: false };
    const { gl } = fakeGl({ pageTableUploadFailure });
    const root = createWebGlRoot(fakeCanvas(gl));
    const texture = virtualTexture("/vt/manifest.json");
    const centreMaterial: SurfaceMaterial = {
      ...unlitMaterial({ texture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [2 / 3, 0, 1 / 3, 0],
          row1: [0, 1, 0, 0],
          set: 0,
        },
      },
    };
    const replacementMaterial: SurfaceMaterial = {
      ...unlitMaterial({ texture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [1 / 3, 0, 0, 0],
          row1: [0, 1, 0, 0],
          set: 0,
        },
      },
    };
    const graph = renderScene(centreMaterial);
    const replacementGraph = renderScene(replacementMaterial);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(2)));
    await flushVirtualTextureManifest(root);

    const residentPages = ControlledImage.instances;
    expect(residentPages.map((image) => image.src).sort()).toEqual([
      "/vt/pages/1-0.png",
      "/vt/pages/2-0.png",
    ]);
    for (const image of residentPages) image.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 2, uploadedPages: 2 });

    // Shift the UV window onto the left-hand page and queue it as the replacement
    // for the one physical slot.
    root.render(replacementGraph);
    await flushMicrotasks();
    const replacementPage = ControlledImage.instances.at(-1)!;
    expect(replacementPage.src).toContain("/vt/pages/0-0.png");
    replacementPage.settleLoad();
    await flushMicrotasks();

    // Start the replacement transaction and fail after it has withdrawn the
    // old visible mapping. A following centre-demand frame retries the same
    // in-flight upload, and its final drain can start a newer request for the
    // evicted key while the replacement still owns its pending outcome.
    pageTableUploadFailure.enabled = true;
    expect(() => root.render(replacementGraph)).toThrow();
    expect(() => root.render(graph)).toThrow();
    await flushMicrotasks();
    const newerEvictedPage = ControlledImage.instances.at(-1)!;
    expect(newerEvictedPage).not.toBe(replacementPage);
    expect(residentPages.map((image) => image.src)).toContain(newerEvictedPage.src);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);

    pageTableUploadFailure.enabled = false;
    root.render(graph);

    // Settling the replacement upload must clear only its own claim. Its
    // evicted key now belongs to the newer network request above.
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(1);
    newerEvictedPage.settleLoad();
    await flushMicrotasks();
    root.dispose();
  });

  it("retains the last committed VT demand when a frame fails before drawing", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    // Commit draw-derived demand, then retire the now-stale context-free
    // bootstrap so the selected page becomes the active request.
    root.render(graph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");

    const renderFailure = new Error("frame setup failure");
    vi.mocked(gl.clear).mockImplementationOnce(() => {
      throw renderFailure;
    });
    expect(() => root.render(graph)).toThrow(renderFailure);

    demandedPage.settleLoad();
    await flushMicrotasks();
    root.render(graph);

    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      residentPages: 1,
      uploadedPages: 1,
    });
  });

  it("unions disjoint stereo VT demand and preserves view-order request priority", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const renderOrder = async (
      views: readonly [ReturnType<typeof leftStereoView>, ReturnType<typeof rightStereoView>],
    ): Promise<readonly string[]> => {
      const firstImage = ControlledImage.instances.length;
      const { gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));
      const texture = virtualTexture("/vt/stereo.json");
      const graph = stereoVirtualTextureScene(texture);

      root.render(renderScene(unlitMaterial({ texture })));
      fetchRequests.at(-1)!.resolve(responseJson(vtStereoManifest()));
      await flushMicrotasks();
      root.renderViews(graph, { views });

      const urls = ControlledImage.instances.slice(firstImage).map((image) => image.src);
      root.dispose();
      return urls;
    };

    const leftFirst = await renderOrder([leftStereoView(), rightStereoView()]);
    const rightFirst = await renderOrder([rightStereoView(), leftStereoView()]);

    expect(leftFirst).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-0-0.png",
      "/vt/pages/m0-3-0.png",
    ]);
    expect(rightFirst).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-3-0.png",
      "/vt/pages/m0-0-0.png",
    ]);
    expect(new Set(leftFirst)).toEqual(new Set(rightFirst));
  });

  it("rolls back VT demand collected by an earlier view when a later view fails", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const texture = virtualTexture("/vt/stereo.json");
    const graph = stereoVirtualTextureScene(texture);

    root.render(renderScene(unlitMaterial({ texture })));
    fetchRequests[0]!.resolve(responseJson(vtStereoManifest()));
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView()] });
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/m2-0-0.png",
      "/vt/pages/m0-0-0.png",
    ]);

    const frameFailure = new Error("second stereo view failed");
    vi.mocked(gl.clear)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw frameFailure;
      });
    expect(() => root.renderViews(graph, {
      views: [rightStereoView(), leftStereoView()],
    })).toThrow(frameFailure);
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).not.toContain(
      "/vt/pages/m0-3-0.png",
    );
    imageBySrc("m0-0-0")!.settleLoad();
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView()] });

    expect(pageUploads(calls)).toHaveLength(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ residentPages: 1, uploadedPages: 1 });
  });

  it("clears outstanding ownership when demand discards a queued page even if image close throws", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const visibleGraph = renderScene(material);

    root.render(visibleGraph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    root.render(visibleGraph);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    const demandedPage = ControlledImage.instances.at(-1)!;
    demandedPage.settleLoad();
    await flushMicrotasks();
    const imagesBeforeDiscard = ControlledImage.instances.length;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(1);

    ControlledImage.closeError = new Error("discard close failure");
    expect(() => root.renderViews(visibleGraph, {
      views: [{
        projectionMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          0, 0, 0, 1,
        ],
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          10, 0, 0, 1,
        ],
        viewport: { height: 256, width: 256, x: 0, y: 0 },
      }],
    })).not.toThrow();
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(0);

    ControlledImage.closeError = undefined;
    root.render(visibleGraph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(imagesBeforeDiscard + 1);
    expect(ControlledImage.instances.at(-1)?.src).toBe(demandedPage.src);
  });

  it("commits every resource demand and fairness cursor when discarded image closes throw", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const textures = [
      virtualTexture("/vt/first/stereo.json"),
      virtualTexture("/vt/second/stereo.json"),
    ] as const;
    const graph = scene({
      camera: camera(),
      clearColor: [0, 0, 0, 0],
      nodes: textures.flatMap((texture) => [
        mesh({
          geometry: planeGeometry([1, 2]),
          material: stereoVirtualTextureMaterial(texture, 0),
          transform: { position: [-2, 0, 0], rotation: [0, 0, 0] },
        }),
        mesh({
          geometry: planeGeometry([1, 2]),
          material: stereoVirtualTextureMaterial(texture, 0.75),
          transform: { position: [2, 0, 0], rotation: [0, 0, 0] },
        }),
      ]),
    });
    const manifest = {
      contractVersion: 1,
      pageSize: 4,
      pages: {
        entries: [
          { mip: 0, uri: "pages/0-0.png", x: 0, y: 0 },
          { mip: 0, uri: "pages/3-0.png", x: 3, y: 0 },
        ],
      },
      physicalSlots: 1,
      virtualSize: [16, 4],
    };

    root.render(renderVirtualTextureMaterials(textures.map((texture) => unlitMaterial({ texture }))));
    expect(fetchRequests).toHaveLength(2);
    for (const request of fetchRequests) request.resolve(responseJson(manifest));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
    ]);

    // Establish submission zero (the left eye) as the committed selection for
    // both resources. The next identical stereo frame must rotate both to the
    // right eye and discard both queued left-eye images.
    root.renderViews(graph, { views: [leftStereoView(), rightStereoView()] });
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    ControlledImage.closeError = new Error("discard close failure");
    expect(() => root.renderViews(graph, {
      views: [leftStereoView(), rightStereoView()],
    })).toThrow(ControlledImage.closeError);

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
      "/vt/first/pages/3-0.png",
      "/vt/second/pages/3-0.png",
    ]);
    expect(ControlledImage.closeCalls).toBe(2);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);

    // Cursor state is intentionally private. Alternating request URLs are its
    // black-box contract: both cursors advanced despite the first close error,
    // so neither resource may replay the half-committed right-eye demand.
    ControlledImage.closeError = undefined;
    for (const image of ControlledImage.instances.slice(2)) image.settleLoad();
    await flushMicrotasks();
    root.renderViews(graph, { views: [leftStereoView(), rightStereoView()] });
    expect(ControlledImage.instances.slice(4).map((image) => image.src)).toEqual([
      "/vt/first/pages/0-0.png",
      "/vt/second/pages/0-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(2);
    root.dispose();
  });

});

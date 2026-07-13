import { describe, expect, it, vi } from "vitest";
import {
  standardMaterial,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import {
  createWebGlRoot,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installFetchQueue,
  responseJson,
  renderScene,
  vtManifest,
  vtSinglePageManifest,
  vtPersistentGpuHardLimitPolicy,
  vtParentFallbackManifest,
  vtDenseMipManifest,
  vtZoomCycleManifest,
  vtTerrainManifest,
  flushMicrotasks,
  flushVirtualTextureManifest,
  pageUploads,
  pageTableUploads,
  pageTableUploadSummary,
  imageBySrc,
  settleIncompleteImages,
  uniformNames,
  namedUniform1iValues,
  namedUniform4fvValues,
} from "./renderer-webgl-virtual-texturing-fixtures";

describe("WebGL renderer virtual texturing demand, shaders, and capabilities", () => {
  it("requests coarsest resident parent pages before mip-0 children", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/m1-0-0.png",
      "/vt/pages/m0-1-0.png",
      "/vt/pages/m0-0-0.png",
    ]);

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      cachedPages: 1,
      shaderBinds: expect.any(Number),
      uploadedPages: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("keeps tiny screen-footprint VT demand on coarse visible mips", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }), {
      planeSize: [0.25, 0.25],
    });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toContain("/vt/pages/m4-0-0.png");
    for (let cycle = 0; cycle < 4; cycle += 1) {
      await settleIncompleteImages();
      root.render(graph);
    }

    const pageRequests = ControlledImage.instances.map((image) => image.src);
    expect(pageRequests.some((src) => src.includes("/vt/pages/m3-"))).toBe(true);
    expect(pageRequests.some((src) => (
      src.includes("/vt/pages/m2-") || src.includes("/vt/pages/m1-") || src.includes("/vt/pages/m0-")
    ))).toBe(false);
  });

  it("converges an oversubscribed visible working set without stable-camera eviction churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const fullView = renderScene(material);

    root.render(fullView);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages();
      root.render(fullView);
    }
    expect(root.snapshot().virtualTexturing.cachedPages).toBe(3);
    const stableRequests = ControlledImage.instances.length;
    const stableUpdates = root.snapshot().virtualTexturing.pageTableUpdates;
    for (let frame = 0; frame < 8; frame += 1) root.render(fullView);
    expect(ControlledImage.instances).toHaveLength(stableRequests);
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBe(stableUpdates);
    expect(root.snapshot().virtualTexturing.cachedPages).toBe(3);

    root.render(renderScene(material, { planeSize: [0.25, 0.25] }));
    expect(root.snapshot().virtualTexturing.cachedPages).toBeLessThanOrEqual(3);
  });

  it("keeps camera jitter sticky and bounds refinement admissions during a slow pan", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/manifest.json") });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 6; cycle += 1) {
      await settleIncompleteImages();
      root.render(renderScene(material));
    }
    const stableRequests = ControlledImage.instances.length;
    const stableAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    for (const cameraX of [0.002, -0.002, 0.001, 0]) {
      root.render(renderScene(material, { cameraX }));
    }
    expect(ControlledImage.instances).toHaveLength(stableRequests);
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(stableAdmissions);

    for (const cameraX of [0.8, 1, 1.2, 1.4]) {
      await settleIncompleteImages();
      const requestsBeforePanStep = ControlledImage.instances.length;
      root.render(renderScene(material, { cameraX }));
      expect(ControlledImage.instances.length - requestsBeforePanStep).toBeLessThanOrEqual(2);
    }
    expect(root.snapshot().virtualTexturing.demandAdmissions - stableAdmissions).toBeLessThanOrEqual(8);
    await settleIncompleteImages();
    const requestsBeforeDirectionChange = ControlledImage.instances.length;
    root.render(renderScene(material, { cameraX: -1.4 }));
    expect(ControlledImage.instances.length - requestsBeforeDirectionChange).toBeLessThanOrEqual(2);
    expect(root.snapshot().virtualTexturing.demandRetentions).toBeGreaterThan(0);
  });

  it("fills free 24-slot terrain capacity beyond the replacement churn allowance", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/terrain.json") });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtTerrainManifest()));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 16; cycle += 1) {
      await settleIncompleteImages(512);
      root.render(renderScene(material));
    }
    await settleIncompleteImages(512);

    const pageRequests = ControlledImage.instances.map((image) => image.src);
    expect(pageRequests.some((src) => src.includes("/pages/m3-"))).toBe(true);
    expect(new Set(pageRequests).size).toBeGreaterThan(3);
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBeGreaterThan(2);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(0);
    const convergedAdmissions = root.snapshot().virtualTexturing.demandAdmissions;
    const convergedRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(renderScene(material));
    expect(root.snapshot().virtualTexturing.demandAdmissions).toBe(convergedAdmissions);
    expect(ControlledImage.instances).toHaveLength(convergedRequests);
  });

  it("retains a bounded coherent hierarchy across a coarse zoom cycle", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/zoom.json") });
    const fineView = renderScene(material);
    const coarseView = renderScene(material, { planeSize: [1, 1] });

    root.render(fineView);
    fetchRequests[0]!.resolve(responseJson(vtZoomCycleManifest()));
    await flushMicrotasks();
    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    const refinedRequestsBeforeZoomOut = ControlledImage.instances
      .filter((image) => image.src.includes("/pages/m2-"))
      .length;
    expect(refinedRequestsBeforeZoomOut).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.cachedPages).toBe(3);

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(coarseView);
    }
    const requestsAfterCoarseSettle = ControlledImage.instances.length;
    const updatesAfterCoarseSettle = root.snapshot().virtualTexturing.pageTableUpdates;

    for (let cycle = 0; cycle < 8; cycle += 1) {
      await settleIncompleteImages(256);
      root.render(fineView);
    }

    expect(ControlledImage.instances).toHaveLength(requestsAfterCoarseSettle);
    expect(ControlledImage.instances.filter((image) => image.src.includes("/pages/m2-")).length)
      .toBe(refinedRequestsBeforeZoomOut);
    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/zoom.json"]);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      cachedPages: 3,
    }));
    expect(root.snapshot().virtualTexturing.cachedPagesByMip.reduce((sum, count) => sum + count, 0))
      .toBe(root.snapshot().virtualTexturing.cachedPages);
    expect(root.snapshot().virtualTexturing.activePagesByMip.reduce((sum, count) => sum + count, 0))
      .toBe(root.snapshot().virtualTexturing.activePages);
    expect(root.snapshot().virtualTexturing.pageTableUpdates).toBe(updatesAfterCoarseSettle);

    root.render(renderScene(material, { cameraX: 100 }));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      activePages: 0,
      activePagesByMip: [],
      cachedPages: 3,
    }));
  });

  it("expands resident parent page-table updates over covered mip-0 cells with encoded fallback offsets", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
    ]);
    expect(pageUploads(calls)).toHaveLength(1);
    expect(pageUploads(calls)[0]?.args[0]).toBe(gl.TEXTURE_2D);
  });

  it("replaces parent mappings with exact child page-table entries as children upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(3)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    await flushMicrotasks();
    imageBySrc("m0-0-0")?.settleLoad();
    await flushMicrotasks();

    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [0, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("does not oversubscribe a stable parent-and-child working set", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtParentFallbackManifest(2)));
    await flushMicrotasks();

    imageBySrc("m1-0-0")?.settleLoad();
    imageBySrc("m0-1-0")?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    expect(imageBySrc("m0-0-0")).toBeUndefined();
    const writes = pageTableUploads(calls).map(pageTableUploadSummary);
    expect(writes).toEqual([
      [0, 0, 2, 1, [1, 0, 1, 255, 1, 0, 1, 255]],
      [1, 0, 1, 1, [2, 0, 0, 255]],
    ]);
  });

  it("binds VT shader resources instead of the ordinary u_texture sampler after page upload", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniformNames(calls)).not.toContain("u_texture");
    expect(calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [gl.TEXTURE0], name: "activeTexture" }),
      expect.objectContaining({ args: [gl.TEXTURE0 + 1], name: "activeTexture" }),
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("honors logical virtual texture UV wrap modes in the VT shader uniforms", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        src: "/vt/manifest.json",
      }),
    })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtWrapS: expect.arrayContaining([1]),
      u_vtWrapT: expect.arrayContaining([2]),
    }));
  });

  it("defaults logical virtual texture UV wrapping to clamp-to-edge", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_vtFlipY: expect.arrayContaining([1]),
      u_vtWrapS: expect.arrayContaining([0]),
      u_vtWrapT: expect.arrayContaining([0]),
    }));
  });

  it("preserves explicit flipY false in virtual-texture shader orientation", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({
      texture: virtualTexture({ flipY: false, src: "/vt/manifest.json" }),
    });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(renderScene(material));
    await flushMicrotasks();
    ControlledImage.instances.at(-1)!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(material));
    expect(namedUniform1iValues(calls).u_vtFlipY).toContain(0);
  });

  it("ignores async VT page completions after dispose", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();
    const beforeDisposeUploads = pageUploads(calls).length;

    root.dispose();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(beforeDisposeUploads);
    expect(calls.filter((call) => call.name === "deleteTexture")).toHaveLength(2);
    expect(root.snapshot().disposed).toBe(true);
  });

  it("retries retained VT image close ownership on repeated dispose", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushVirtualTextureManifest(root);
    const demandedPage = ControlledImage.instances[0]!;
    expect(demandedPage.src).toContain("/vt/pages/1-0.png");
    demandedPage.settleLoad();
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 1,
      pendingPages: 1,
    });

    const closesBeforeDispose = ControlledImage.closeCalls;
    ControlledImage.closeError = new Error("dispose close failure");
    expect(() => root.dispose()).toThrow(ControlledImage.closeError);
    expect(ControlledImage.closeCalls).toBeGreaterThan(closesBeforeDispose);
    const closesAfterFailedDispose = ControlledImage.closeCalls;
    expect(root.snapshot().disposed).toBe(true);

    ControlledImage.closeError = undefined;
    expect(() => root.dispose()).not.toThrow();
    expect(ControlledImage.closeCalls).toBeGreaterThan(closesAfterFailedDispose);
    const closesAfterSuccessfulRetry = ControlledImage.closeCalls;

    root.dispose();
    expect(ControlledImage.closeCalls).toBe(closesAfterSuccessfulRetry);
  });

  it("falls back to diagnostic material color when explicit VT lacks sampler budget", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({ texture: virtualTexture("/vt/manifest.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    root.render(graph);

    expect(ControlledImage.instances).toHaveLength(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([0]),
    }));
    expect(namedUniform4fvValues(calls)).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 0, 1, 1]]),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBe(0);
    expect(consoleWarn).toHaveBeenCalled();
  });

  it("records unsupported capability diagnostics and rejects WebGL1 contexts explicitly", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      atlasTextures: 0,
      manifestRequests: 1,
      unsupportedDraws: expect.any(Number),
    }));
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/requires at least two fragment texture units/i);
    expect(consoleWarn).toHaveBeenCalled();

    expect(() => createWebGlRoot(fakeCanvas(null))).toThrow(/webgl2/i);
  });

  it("accepts explicit standardMaterial virtualTexture as a surface base color while it loads", () => {
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(standardMaterial({ texture: virtualTexture("/vt/manifest.json") })));

    expect(fetchRequests.map((request) => request.url)).toEqual(["/vt/manifest.json"]);
    expect(root.snapshot().virtualTexturing.unsupportedDraws).toBe(0);
    expect(root.snapshot().virtualTexturing.preparedResidencyResolutions).toBe(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toMatch(/only unlit base-color virtual textures/i);
  });

  it("freezes normalized root options", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 8,
      resourceGovernorPolicy: vtPersistentGpuHardLimitPolicy(123_456),
    });

    expect(Object.isFrozen(root.options)).toBe(true);
    expect(root.options).toMatchObject({
      alpha: true,
      antialias: true,
      generatedImageVirtualTextures: true,
      generatedSvgVirtualTextureRasterDensity: 8,
      resourceGovernorPolicy: expect.objectContaining({
        classes: expect.objectContaining({
          "virtual-texture": expect.objectContaining({
            persistentGpuBytes: {
              hardLimit: 123_456,
              mandatoryFloor: 0,
              softLimit: 123_456,
            },
          }),
        }),
      }),
    });
    expect(root.snapshot()).toMatchObject({
      resourceGovernor: {
        maximumDurableBytesByClass: {
          "virtual-texture": { persistentGpuBytes: 123_456 },
        },
      },
      virtualTexturing: { physicalBudgetBytes: 123_456 },
    });
    root.dispose();
  });

  it("reports invalid VT root options with their units, range, and received value", () => {
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);

    expect(() => createWebGlRoot(canvas, { generatedSvgVirtualTextureRasterDensity: 17 }))
      .toThrow(new RangeError(
        "generatedSvgVirtualTextureRasterDensity must be finite and in (0, 16] logical texels per authored SVG CSS pixel, received 17",
      ));
  });
});

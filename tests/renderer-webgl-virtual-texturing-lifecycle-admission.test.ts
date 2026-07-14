import { describe, expect, it, vi } from "vitest";
import {
  imageTexture,
  standardMaterial,
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
  renderScene,
  renderVirtualTextureMaterials,
  renderGeometryPressure,
  renderOrdinaryTexturePressure,
  vtSinglePageManifest,
  constrainedPolicy,
  vtDenseMipManifest,
  flushMicrotasks,
  flushVirtualTextureManifest,
  pageUploads,
  imageBySrc,
  namedUniform1iValues,
} from "./renderer-webgl-virtual-texturing-fixtures";

describe("WebGL renderer virtual texturing lifecycle and admission", () => {
  it("admits a pending high-priority map without loading an omitted lower-priority map", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const root = createWebGlRoot(fakeCanvas(gl));
    const material: SurfaceMaterial = {
      ...standardMaterial({ color: [1, 1, 1, 1] }),
      emissiveTexture: imageTexture("/textures/pending-emissive.png"),
      metallicRoughnessTexture: imageTexture("/textures/ready-metallic-roughness.png"),
    };
    const graph = renderScene(material);

    root.render(graph);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/textures/pending-emissive.png",
    ]);
    imageBySrc("pending-emissive")!.settleLoad();
    await flushMicrotasks();

    for (let frame = 0; frame < 3; frame += 1) root.render(graph);
    const uniforms = namedUniform1iValues(calls);

    expect(uniforms.u_useEmissiveTexture).toContain(1);
    expect(uniforms.u_emissiveTexture).toContain(0);
    expect(uniforms.u_useMetallicRoughnessTexture).not.toContain(1);
    expect(imageBySrc("ready-metallic-roughness")).toBeUndefined();
    expect(root.snapshot().textureResidency.resources).toBe(1);
  });

  it("keeps ordinary base color ahead of material maps under one sampler", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    const baseColor = imageTexture("/textures/admitted-base.png");
    const material: SurfaceMaterial = {
      ...standardMaterial({ texture: baseColor }),
      emissiveTexture: imageTexture("/textures/omitted-emissive.png"),
    };
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(material);

    root.render(graph);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/textures/admitted-base.png",
    ]);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    root.render(graph);

    expect(namedUniform1iValues(calls).u_useTexture).toContain(1);
    expect(namedUniform1iValues(calls).u_useEmissiveTexture).not.toContain(1);
    expect(imageBySrc("omitted-emissive")).toBeUndefined();
    expect(root.snapshot().textureResidency.resources).toBe(1);
  });

  it("keeps admitted acquisition retryable after a failed draw", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const marker = new Error("draw failed after texture admission");
    const { calls, gl } = fakeGl({ maxTextureImageUnits: 1 });
    vi.spyOn(gl, "drawElements").mockImplementationOnce(() => { throw marker; });
    const material: SurfaceMaterial = {
      ...standardMaterial({ color: [1, 1, 1, 1] }),
      emissiveTexture: imageTexture("/textures/retry-emissive.png"),
      metallicRoughnessTexture: imageTexture("/textures/still-omitted.png"),
    };
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(material);

    expect(() => root.render(graph)).toThrow(marker);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/textures/retry-emissive.png",
    ]);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    root.render(graph);

    expect(namedUniform1iValues(calls).u_useEmissiveTexture).toContain(1);
    expect(imageBySrc("still-omitted")).toBeUndefined();
  });

  it("keeps atomic VT ahead of ordinary maps without acquisition churn", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl({ maxTextureImageUnits: 2 });
    const material: SurfaceMaterial = {
      ...standardMaterial({ texture: virtualTexture("/vt/admitted-base.json") }),
      emissiveTexture: imageTexture("/textures/omitted-behind-vt.png"),
    };
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(material);

    root.render(graph);
    expect(fetchRequests).toHaveLength(1);
    expect(imageBySrc("omitted-behind-vt")).toBeUndefined();
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 4; frame += 1) root.render(graph);

    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(imageBySrc("omitted-behind-vt")).toBeUndefined();
    expect(root.snapshot().textureResidency.resources).toBe(0);
  });

  it("keeps an intrinsically oversized decoded page terminal without fetching it", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ cpuDecodedBytes: 143 }),
    });
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/cpu-impossible.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(0);
    const denied = root.snapshot().resourcePressure.denials;

    root.render(graph);
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().resourcePressure.denials).toBe(denied);
    expect(root.snapshot().diagnostics.join("\n")).toContain("requires 144 retained CPU bytes");
    root.dispose();
  });

  it("wakes a CPU-capacity-blocked page without fetching it before capacity releases", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ cpuDecodedBytes: 144 }),
    });
    const materials = ["first", "second"].map((name) =>
      unlitMaterial({ texture: virtualTexture(`/vt/cpu-${name}.json`) }));
    const graph = renderVirtualTextureMaterials(materials);

    root.render(graph);
    for (const request of fetchRequests) request.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(1);

    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(2);
    expect(root.snapshot().resourcePressure.denialsByReason["cpu-decoded-capacity"])
      .toBeGreaterThan(0);
    root.dispose();
  });

  it("purges obsolete capacity-blocked pages without retrying or waking after capacity releases", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }), {
      resourceGovernorPolicy: constrainedPolicy({ cpuDecodedBytes: 144 }),
    });
    const material = unlitMaterial({ texture: virtualTexture("/vt/obsolete-capacity.json") });

    root.render(renderScene(material));
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(4)));
    await flushMicrotasks();
    root.render(renderScene(material));
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().resourcePressure.denialsByReason["cpu-decoded-capacity"])
      .toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBeGreaterThan(1);

    root.render(renderScene(material, { cameraX: 100 }));
    await flushMicrotasks();
    const settledImageCount = ControlledImage.instances.length;
    const settledWakeCount = requestAnimationFrame.mock.calls.length;

    expect(root.snapshot().resourcePressure.total.jobs).toBe(0);
    expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBe(0);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(settledImageCount);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(settledWakeCount);
    root.dispose();
  });

  it("retries governed VT admission after cross-class geometry capacity is released", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const probe = createWebGlRoot(fakeCanvas(fakeGl().gl));
    probe.render(renderGeometryPressure(unlitMaterial({ color: [1, 1, 1, 1] }), 12));
    const geometryBytes = probe.snapshot().resourcePressure.byClass.geometry.persistentGpuBytes;
    probe.dispose();

    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({ persistentGpuBytes: geometryBytes + 147 }),
    });
    const vtMaterial = unlitMaterial({ texture: virtualTexture("/vt/geometry-release.json") });
    root.render(renderGeometryPressure(vtMaterial, 12));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, gpuAdmissionFailures: 1 });

    root.render(renderGeometryPressure(vtMaterial, 0));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1 });
    root.dispose();
  });

  it("retries governed VT admission after an ordinary texture releases GPU capacity", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const ordinaryMaterial = unlitMaterial({ texture: imageTexture("/ordinary-pressure.png") });
    const plainMaterial = unlitMaterial({ color: [1, 1, 1, 1] });
    const probe = createWebGlRoot(fakeCanvas(fakeGl().gl));
    probe.render(renderOrdinaryTexturePressure(plainMaterial, ordinaryMaterial));
    await flushMicrotasks();
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    probe.render(renderOrdinaryTexturePressure(plainMaterial, ordinaryMaterial));
    const probeGovernor = probe.snapshot().resourcePressure;
    const geometryBytes = probeGovernor.byClass.geometry.persistentGpuBytes;
    const ordinaryBytes = probeGovernor.byClass["ordinary-texture"].persistentGpuBytes;
    expect(ordinaryBytes).toBeGreaterThan(0);
    probe.dispose();

    const fetchRequests = installFetchQueue();
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl), {
      resourceGovernorPolicy: constrainedPolicy({
        persistentGpuBytes: geometryBytes + ordinaryBytes + 147,
      }),
    });
    const vtMaterial = unlitMaterial({ texture: virtualTexture("/vt/ordinary-release.json") });
    root.render(renderOrdinaryTexturePressure(vtMaterial, ordinaryMaterial));
    await flushMicrotasks();
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(renderOrdinaryTexturePressure(vtMaterial, ordinaryMaterial));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, gpuAdmissionFailures: 1 });

    root.render(renderOrdinaryTexturePressure(vtMaterial, plainMaterial));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1 });
    root.dispose();
  });

  it("admits a sparse explicit VT using its exact reachable page-table update bound", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), {
      resourceGovernorPolicy: constrainedPolicy({
        persistentGpuBytes: 8 * 1024 * 1024,
        uploadBytes: 1_024,
      }),
    });

    const sparseTexture = virtualTexture({ manifestUri: "/vt/sparse.json" });
    const sparseMaterial: SurfaceMaterial = {
      ...unlitMaterial({ texture: sparseTexture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [1 / 1_024, 0, 0, 0],
          row1: [0, 1 / 1_024, 0, 0],
          set: 0,
        },
      },
    };
    root.render(renderScene(sparseMaterial));
    const textureCreatesBeforeManifest = calls.filter(({ name }) => name === "createTexture").length;
    fetchRequests[0]!.resolve(responseJson({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 4,
      pages: { entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }] },
      physicalSlots: 1,
      virtualSize: [4_096, 4_096],
    }));
    await flushVirtualTextureManifest(root);

    expect(calls.filter(({ name }) => name === "createTexture")).toHaveLength(
      textureCreatesBeforeManifest + 2,
    );
    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().diagnostics.join("\n")).not.toMatch(/configured per-frame upload limit/);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 1, gpuAdmissionFailures: 0 });
    root.dispose();
  });

  it.each([
    {
      expected: /page or page-table upload requires up to 266256 bytes.*upload limit 1024/,
      label: "upload",
      policy: constrainedPolicy({ uploadBytes: 1_024 }),
    },
    {
      expected: /resource allocation requires 266260 persistent GPU bytes.*limit 65536/,
      label: "persistent GPU",
      policy: constrainedPolicy({ persistentGpuBytes: 64 * 1024 }),
    },
    {
      expected: /resource allocation requires 266260 persistent GPU bytes.*limit 65536/,
      label: "mandatory-floor",
      policy: (() => {
        const policy = constrainedPolicy({});
        const maximum = 64 * 1024;
        const floor = policy.limits.persistentGpuBytes - maximum;
        return {
          ...policy,
          classes: {
            ...policy.classes,
            geometry: {
              ...policy.classes.geometry,
              persistentGpuBytes: { mandatoryFloor: floor },
            },
          },
        };
      })(),
    },
  ])("terminally rejects a VT exceeding a small mobile $label limit without a wake loop", async ({
    expected,
    policy,
  }) => {
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy: policy });
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/mobile-limit.json") }));

    root.render(graph);
    const textureCreatesBeforeManifest = calls.filter(({ name }) => name === "createTexture").length;
    fetchRequests[0]!.resolve(responseJson({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 256,
      pages: { entries: [{ mip: 0, uri: "pages/0-0.png", x: 0, y: 0 }] },
      physicalSlots: 1,
      virtualSize: [256, 256],
    }));
    await flushVirtualTextureManifest(root);

    expect(calls.filter(({ name }) => name === "createTexture")).toHaveLength(textureCreatesBeforeManifest);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(root.snapshot().diagnostics.join("\n")).toMatch(expected);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      atlasTextures: 0,
      gpuAdmissionFailures: 1,
      pendingPages: 0,
    });
    let frames = 0;
    while (scheduledFrames.length > 0 && frames < 4) {
      scheduledFrames.shift()!(frames);
      frames += 1;
      await flushMicrotasks();
    }
    expect(scheduledFrames).toHaveLength(0);
    root.dispose();
  });

  it("settles decoded ownership when page validation throws", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    const page = ControlledImage.instances[0]!;
    Object.defineProperty(page, "naturalWidth", {
      configurable: true,
      get: () => {
        throw new Error("broken decoded dimensions");
      },
    });
    page.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(0);
    expect(ControlledImage.closeCalls).toBe(1);
    expect(root.snapshot().resourcePressure).toMatchObject({
      byClass: { "virtual-texture": { cpuDecodedBytes: 0 } },
      total: { cpuDecodedBytes: 0 },
    });
    expect(root.snapshot().virtualTexturing).toMatchObject({
      cachedPages: 0,
      outstandingPageRequests: 0,
      pageLoadFailures: 1,
    });
    expect(root.snapshot().diagnostics.join("\n")).toContain("broken decoded dimensions");
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
  });

  it("does not recreate a loading claim when page construction loses the context", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    let contextLost = false;
    class ContextLosingImage extends ControlledImage {
      override get src(): string {
        return super.src;
      }

      override set src(value: string) {
        super.src = value;
        if (value.length === 0 || contextLost) return;
        contextLost = true;
        canvas.dispatchContextEvent("webglcontextlost");
      }
    }
    vi.stubGlobal("Image", ContextLosingImage);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/reentrant-loss.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(root.snapshot().virtualTexturing.outstandingPageRequests).toBe(0);
    expect(root.snapshot().resourcePressure.byClass["virtual-texture"].cpuDecodedBytes).toBe(0);

    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(graph);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      cachedPages: 1,
      outstandingPageRequests: 0,
      uploadedPages: 1,
    });
  });

  it("keeps manifest transport, JSON, parse, and GPU failures distinct", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();

    const transportRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    transportRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/transport.json") })));
    fetchRequests[0]!.reject(new Error("offline"));
    await flushMicrotasks();

    const jsonRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    jsonRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/json.json") })));
    fetchRequests[1]!.resolve({
      json: vi.fn(() => Promise.reject(new SyntaxError("bad JSON"))),
      ok: true,
    } as unknown as Response);
    await flushMicrotasks();

    const parseRoot = createWebGlRoot(fakeCanvas(fakeGl().gl));
    parseRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/parse.json") })));
    fetchRequests[2]!.resolve(responseJson({ contractVersion: 2 }));
    await flushMicrotasks();

    const { gl: gpuGl } = fakeGl();
    const gpuRoot = createWebGlRoot(fakeCanvas(gpuGl));
    gpuRoot.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/gpu.json") })));
    vi.mocked(gpuGl.texImage2D).mockImplementation(() => {
      throw new Error("allocation rejected");
    });
    vi.mocked(gpuGl.deleteTexture).mockImplementationOnce(() => {
      throw new Error("rollback deletion rejected");
    });
    fetchRequests[3]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();

    expect(transportRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest transport failed: offline/);
    expect(jsonRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest JSON decode failed: bad JSON/);
    expect(parseRoot.snapshot().diagnostics.join("\n")).toMatch(/manifest parse failed/);
    expect(gpuRoot.snapshot().diagnostics.join("\n")).toMatch(/GPU resource admission failed: allocation rejected/);
    expect(gpuRoot.snapshot().resourcePressure.outstandingReservations).toBe(0);
    expect(
      gpuRoot.snapshot().resourcePressure.byClass["virtual-texture"].persistentGpuBytes,
    ).toBe(148);
    expect(transportRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(jsonRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(parseRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 1, gpuAdmissionFailures: 0 });
    expect(gpuRoot.snapshot().virtualTexturing).toMatchObject({ manifestFailures: 0, gpuAdmissionFailures: 1 });
  });

  it("aborts an abandoned authored manifest request on root disposal", () => {
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/pending.json") })));
    expect(fetchRequests[0]?.signal?.aborted).toBe(false);

    root.dispose();
    expect(fetchRequests[0]?.signal?.aborted).toBe(true);
  });

  it("uses the shared ceil-derived mip grid for NPOT root demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/npot.json") })));
    fetchRequests[0]!.resolve(responseJson({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 4,
      pages: { uriTemplate: "pages/m{mip}-{x}-{y}.png" },
      physicalSlots: 1,
      virtualSize: [12, 4],
    }));
    await flushVirtualTextureManifest(root);

    expect(ControlledImage.instances.map((image) => image.src)).toEqual(["/vt/pages/m2-0-0.png"]);
    root.dispose();
  });

  it.each([
    ["undersized", 5, 6],
    ["oversized", 7, 6],
  ])("rejects and closes an %s authored page before WebGL upload", async (_label, width, height) => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    const page = ControlledImage.instances[0]!;
    page.naturalWidth = width;
    page.width = width;
    page.naturalHeight = height;
    page.height = height;
    page.settleLoad();
    await flushMicrotasks();

    expect(pageUploads(calls)).toHaveLength(0);
    expect(ControlledImage.closeCalls).toBe(1);
    expect(root.snapshot().virtualTexturing).toMatchObject({ pageLoadFailures: 1, cachedPages: 0 });
    expect(root.snapshot().diagnostics.join("\n")).toMatch(/has \dx\d pixels; expected 6x6/);
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") })));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.closeCalls).toBe(1);
    root.dispose();
  });

  it("requests a terminal failed page again only after it leaves and re-enters draw demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = unlitMaterial({ texture: virtualTexture("/vt/terminal-reentry.json") });
    const visible = renderScene(material);

    root.render(visible);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    const failed = ControlledImage.instances[0]!;
    failed.naturalWidth = 5;
    failed.width = 5;
    failed.settleLoad();
    await flushMicrotasks();

    root.render(visible);
    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBe(1);

    root.render(renderScene(material, { cameraX: 100 }));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBe(0);

    root.render(visible);
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    expect(ControlledImage.instances[1]!.src).toBe(failed.src);
    root.dispose();
  });

  it("bounds lifecycle retention across many failed pages that become obsolete", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const pageCount = 12;
    const texture = virtualTexture("/vt/lifecycle-churn.json");
    const materialAt = (index: number): SurfaceMaterial => ({
      ...unlitMaterial({ texture }),
      textureCoordinates: {
        baseColorTexture: {
          row0: [1 / pageCount, 0, index / pageCount, 0],
          row1: [0, 1, 0, 0],
          set: 0,
        },
      },
    });

    root.render(renderScene(materialAt(0)));
    fetchRequests[0]!.resolve(responseJson({
      borderTexels: 1,
      contractVersion: 2,
      pageSize: 4,
      pages: {
        entries: Array.from({ length: pageCount }, (_value, x) => ({
          mip: 0,
          uri: `pages/${x}-0.png`,
          x,
          y: 0,
        })),
      },
      physicalSlots: 1,
      virtualSize: [pageCount * 4, 4],
    }));
    await flushVirtualTextureManifest(root);

    for (let index = 0; index < pageCount; index += 1) {
      if (index > 0) {
        root.render(renderScene(materialAt(index)));
        await flushMicrotasks();
      }
      const failed = ControlledImage.instances.at(-1)!;
      expect(failed.complete).toBe(false);
      failed.naturalWidth = 5;
      failed.width = 5;
      failed.settleLoad();
      await flushMicrotasks();
      expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBeLessThanOrEqual(1);
    }

    expect(new Set(ControlledImage.instances.map((image) => image.src)).size).toBe(pageCount);
    root.render(renderScene(materialAt(pageCount - 1), { cameraX: 100 }));
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.pageLifecycleEntries).toBe(0);
    root.dispose();
  });

  it("fills a working set after an invalid authored page becomes terminal", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/invalid-convergence.json") });
    const graph = renderScene(material);

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushVirtualTextureManifest(root);
    const invalid = ControlledImage.instances[0]!;
    const invalidSrc = invalid.src;
    invalid.naturalWidth = 5;
    invalid.width = 5;
    invalid.settleLoad();
    await flushMicrotasks();

    for (let cycle = 0; cycle < 10; cycle += 1) {
      for (const image of ControlledImage.instances) {
        if (!image.complete && image.src !== invalidSrc) image.settleLoad();
      }
      await flushMicrotasks();
      root.render(graph);
      await flushMicrotasks();
    }

    expect(ControlledImage.instances.filter((image) => image.src === invalidSrc)).toHaveLength(1);
    expect(new Set(
      ControlledImage.instances.filter((image) => image.src !== invalidSrc).map((image) => image.src),
    ).size).toBeGreaterThanOrEqual(3);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      outstandingPageRequests: 0,
      pageLoadFailures: 1,
      pendingPages: 0,
      cachedPages: 3,
    });
    const settledRequests = ControlledImage.instances.length;
    for (let frame = 0; frame < 4; frame += 1) root.render(graph);
    expect(ControlledImage.instances).toHaveLength(settledRequests);
    root.dispose();
  });

  it("keeps an invalid-size authored page terminal across context restoration", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("ImageBitmap", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    const invalidPage = ControlledImage.instances[0]!;
    invalidPage.naturalWidth = 5;
    invalidPage.width = 5;
    invalidPage.settleLoad();
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(1);

    canvas.dispatchContextEvent("webglcontextlost");
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(graph);
    root.render(graph);
    await flushMicrotasks();

    expect(ControlledImage.instances).toHaveLength(1);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(1);
    root.dispose();
  });

  it("keeps retained pending pages dormant without physical resources and uploads once after explicit restore", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/manifest.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    expect(pageUploads(calls)).toHaveLength(0);
    const admittedSnapshot = root.snapshot();
    expect(admittedSnapshot.resourcePressure).toMatchObject({
      byClass: {
        "virtual-texture": {
          cpuDecodedBytes: 6 * 6 * 4,
          persistentGpuBytes: admittedSnapshot.virtualTexturing.physicalAllocatedBytes,
        },
      },
    });

    canvas.dispatchContextEvent("webglcontextlost");
    const wakesWhileBlocked = requestAnimationFrame.mock.calls.length;
    root.render(graph);
    root.render(graph);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesWhileBlocked);
    expect(pageUploads(calls)).toHaveLength(0);
    expect(root.snapshot().virtualTexturing).toMatchObject({ atlasTextures: 0, cachedPages: 0 });
    expect(root.snapshot().resourcePressure).toMatchObject({
      byClass: { "virtual-texture": { cpuDecodedBytes: 6 * 6 * 4 } },
      total: { persistentGpuBytes: 0 },
    });

    canvas.dispatchContextEvent("webglcontextrestored");
    expect(requestAnimationFrame.mock.calls.length).toBeGreaterThan(wakesWhileBlocked);
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
    const restoredSnapshot = root.snapshot();
    expect(restoredSnapshot.virtualTexturing).toMatchObject({ atlasTextures: 1, cachedPages: 1 });
    expect(restoredSnapshot.resourcePressure.byClass["virtual-texture"].persistentGpuBytes)
      .toBe(restoredSnapshot.virtualTexturing.physicalAllocatedBytes);
    expect(restoredSnapshot.resourcePressure.byClass["virtual-texture"].cpuDecodedBytes).toBe(0);
    root.render(graph);
    expect(pageUploads(calls)).toHaveLength(1);
  });

  it("aborts an in-flight VT page and releases its global job slot on context loss", async () => {
    vi.stubGlobal("Image", ControlledImage);
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);

    expect(ControlledImage.instances).toHaveLength(1);
    expect(root.snapshot().resourcePressure.total.jobs).toBe(1);
    canvas.dispatchContextEvent("webglcontextlost");
    await flushMicrotasks();

    expect(root.snapshot().resourcePressure.total.jobs).toBe(0);
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(0);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    await flushMicrotasks();
    expect(ControlledImage.instances).toHaveLength(2);
    ControlledImage.instances[1]!.settleLoad();
    await flushMicrotasks();
    root.render(renderScene(unlitMaterial({ texture: virtualTexture("/vt/abort-page.json") })));
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(0);
    expect(root.snapshot().virtualTexturing.cachedPages).toBe(1);
    root.dispose();
  });

  it.each(["resolved", "abort-rejected"] as const)(
    "does not let an obsolete %s page settlement corrupt a rapid same-page rebound",
    async (oldSettlement) => {
      vi.stubGlobal("Image", ControlledImage);
      vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
      const fetchRequests = installFetchQueue();
      const { gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));
      const material = unlitMaterial({ texture: virtualTexture("/vt/rebound-page.json") });
      const visible = renderScene(material);

      root.render(visible);
      fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
      await flushVirtualTextureManifest(root);
      expect(ControlledImage.instances).toHaveLength(1);
      const obsolete = ControlledImage.instances[0]!;

      if (oldSettlement === "resolved") {
        // Resolve the inner decode, but resume this test before the pageImage
        // continuation consumes it. Removal below can then replace ownership
        // while the old successful continuation is already queued.
        obsolete.settleLoad();
        await Promise.resolve();
      }
      root.render(renderScene(material, { cameraX: 100 }));
      root.render(visible);
      await flushMicrotasks();

      expect(ControlledImage.instances).toHaveLength(2);
      expect(root.snapshot().resourcePressure.total.jobs).toBe(1);
      expect(root.snapshot().virtualTexturing).toMatchObject({
        outstandingPageRequests: 1,
        pageLoadFailures: 0,
      });

      // The stale continuation must not release the rebound's loading
      // lifecycle and thereby grant a duplicate third request.
      root.render(visible);
      root.render(visible);
      expect(ControlledImage.instances).toHaveLength(2);

      ControlledImage.instances[1]!.settleLoad();
      await flushMicrotasks();
      root.render(visible);
      expect(root.snapshot().resourcePressure.total.jobs).toBe(0);
      expect(root.snapshot().virtualTexturing).toMatchObject({
        outstandingPageRequests: 0,
        pageLoadFailures: 0,
        cachedPages: 1,
      });
      root.dispose();
    },
  );

  it("does not spin while transition pages load and aborts work removed by exact demand", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl, { height: 1024, width: 1024 }));
    const material = unlitMaterial({ texture: virtualTexture("/vt/obsolete-page.json") });
    const visible = renderScene(material);

    root.render(visible);
    fetchRequests[0]!.resolve(responseJson(vtDenseMipManifest(3)));
    await flushVirtualTextureManifest(root);

    expect(ControlledImage.instances.length).toBeGreaterThan(0);
    expect(root.snapshot().resourcePressure.total.jobs).toBeGreaterThan(0);
    const wakesWhileLoading = requestAnimationFrame.mock.calls.length;
    root.render(visible);
    root.render(visible);
    root.render(visible);
    expect(requestAnimationFrame).toHaveBeenCalledTimes(wakesWhileLoading);

    const obsoleteImages = [...ControlledImage.instances];
    root.render(renderScene(material, { cameraX: 100 }));
    await flushMicrotasks();

    expect(obsoleteImages.every((image) => image.src === "")).toBe(true);
    expect(root.snapshot().resourcePressure.total.jobs).toBe(0);
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 0,
      outstandingPageRequests: 0,
      pageLoadFailures: 0,
      pendingPages: 0,
    });
    root.dispose();
  });

  it("wakes render-on-demand exactly once after final VT settlement", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const scheduledFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    }));
    const fetchRequests = installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const graph = renderScene(unlitMaterial({ texture: virtualTexture("/vt/settlement-wake.json") }));

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushVirtualTextureManifest(root);
    expect(ControlledImage.instances).toHaveLength(1);

    // Merely waiting on decode must not create a self-invalidating frame loop.
    scheduledFrames.shift()?.(0);
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(0);

    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(1);

    // This frame performs the final atlas/page-table settlement. Even though
    // no GPU action remains, settlement schedules one demand-convergence pass.
    scheduledFrames.shift()!(1);
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing).toMatchObject({
      activePages: 1,
      outstandingPageRequests: 0,
      pendingPages: 0,
      cachedPages: 1,
    });
    expect(scheduledFrames).toHaveLength(1);

    // The convergence pass observes physical residency, publishes the exact
    // working set, and quiesces instead of scheduling another frame.
    scheduledFrames.shift()!(2);
    await flushMicrotasks();
    expect(scheduledFrames).toHaveLength(0);
    root.dispose();
  });

});

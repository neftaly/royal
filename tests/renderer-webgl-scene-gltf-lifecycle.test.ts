import {
  triangleGltfSrc,
  matchingTriangleGltfSrc,
  triangleBinUri,
  triangleBinByteLength,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installViewportInvalidationStubs,
  flushMicrotasks,
  fakeImageBitmap,
  flushAnimationFrames,
  flushPreparedAssetBoundary,
  waitForAnimationFrameWork,
  camera,
  renderScene,
  drawCalls,
  instancedDrawCalls,
  shaderSources,
  drawCount,
  instancedDrawInstanceCount,
  callCount,
  bufferSubDataUploadRanges,
  bufferSubDataPayloads,
  gltfInstancingDelta,
  roundVector,
  uniform1iPayloads,
  waitForUniform1iPayload,
  uniform4fvPayloads,
  trackGltfSceneTestRoot,
  resetGltfSceneTestState,
} from "./renderer-webgl-scene-gltf-test-runtime";
import {
  triangleBin,
  triangleWithImageBytes,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  triangleDocument,
  solidTriangleDocument,
  doubleSidedTriangleDocument,
  alphaMaskTriangleDocument,
  alphaBlendTriangleDocument,
  mirroredTriangleNodesDocument,
} from "./renderer-webgl-scene-gltf-material-documents";
import {
  responseWithJson,
  responseWithBuffer,
  installStagedGltfLoader,
  installCanvas2d,
  settleDocumentAndBuffer,
} from "./renderer-webgl-scene-gltf-loader-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { boxGeometry, createCameraViewResource, directionalLight, gltf, mesh, planeGeometry, scene, standardMaterial, unlitMaterial } from "@royal/renderer-core";
import type { RenderObjectHandle } from "@royal/renderer-core";
import { createWebGlRootWithResourcePolicy as createWebGlRootBase } from "../packages/renderer-webgl/src/root";
import { DEFAULT_RESOURCE_GOVERNOR_POLICY } from "../packages/renderer-webgl/src/resource-governor";
import type { ResourceGovernorPolicy } from "../packages/renderer-webgl/src/resource-governor";

const createWebGlRoot = (...args: Parameters<typeof createWebGlRootBase>) =>
  trackGltfSceneTestRoot(createWebGlRootBase(...args));

describe("WebGL renderer scene and glTF lifecycle regressions", () => {
  afterEach(resetGltfSceneTestState);

  it("observes one glTF asset without frame or full-snapshot polling", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const node = gltf({ src: triangleGltfSrc, version: "focused-observer" });
    const statuses: Array<string | undefined> = [];
    const stop = root.observeGltfAsset(node.asset, (snapshot) => statuses.push(snapshot?.status));

    expect(root.gltfAssetSnapshot(node.asset)).toBeUndefined();
    root.render(renderScene([node]));
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => root.gltfAssetSnapshot(node.asset)?.status === "sceneReady",
    );
    root.render(renderScene([]));

    expect(statuses).toEqual([undefined, "loading", "sceneReady", undefined]);
    stop();
    root.dispose();
  });

  it("denies oversized declared geometry before requesting external buffers", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const cpuBudget = 1_024;
    const resourceGovernorPolicy: ResourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      classes: Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
        ([key, value]) => [key, {
          ...value,
          cpuDecodedBytes: { mandatoryFloor: 0 },
        }],
      )) as unknown as ResourceGovernorPolicy["classes"],
      limits: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits,
        cpuDecodedBytes: cpuBudget,
        transientPeakBytes: cpuBudget,
      },
    };
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy });
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "predecode-geometry-admission" }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [{ bufferView: 0, componentType: 5126, count: 100_000, type: "VEC3" }],
        asset: { version: "2.0" },
        buffers: [{ byteLength: 36, uri: triangleBinUri }],
        bufferViews: [{ buffer: 0, byteLength: 36 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushPreparedAssetBoundary();

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n"))
      .toMatch(/declares up to .*prepared CPU bytes, exceeding its combined maximum/i);
    expect(root.snapshot().resourcePressure.total.cpuDecodedBytes).toBe(0);
    root.dispose();
  });

  it("releases pre-decode CPU admission when a pending glTF request is cancelled", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({ src: triangleGltfSrc, version: "predecode-cancellation" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(root.snapshot().resourcePressure.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);
    expect(root.snapshot().resourcePressure.byClass["asset-decode"].cpuDecodedBytes).toBeGreaterThan(0);

    root.render(renderScene([]));
    // The staged fetch double does not implement AbortSignal; settling it lets
    // the loader observe the abort at its next explicit boundary.
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushPreparedAssetBoundary();

    expect(root.snapshot().resourcePressure.total.cpuDecodedBytes).toBe(0);
    expect(root.snapshot().resourcePressure.total.transientPeakBytes).toBe(0);
    root.dispose();
  });

  it("retries a CPU-blocked glTF preparation when a retained estimate shrinks", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const cpuBudget = 320;
    const resourceGovernorPolicy: ResourceGovernorPolicy = {
      ...DEFAULT_RESOURCE_GOVERNOR_POLICY,
      classes: Object.fromEntries(Object.entries(DEFAULT_RESOURCE_GOVERNOR_POLICY.classes).map(
        ([key, value]) => [key, {
          ...value,
          cpuDecodedBytes: { mandatoryFloor: 0 },
        }],
      )) as unknown as ResourceGovernorPolicy["classes"],
      limits: {
        ...DEFAULT_RESOURCE_GOVERNOR_POLICY.limits,
        cpuDecodedBytes: cpuBudget,
        transientPeakBytes: cpuBudget,
      },
    };
    const root = createWebGlRoot(fakeCanvas(gl), { resourceGovernorPolicy });
    const firstDocument = {
      ...solidTriangleDocument(),
      buffers: [{ byteLength: triangleBinByteLength, uri: "first-capacity.bin" }],
    };
    const secondDocument = {
      ...solidTriangleDocument(),
      buffers: [{ byteLength: triangleBinByteLength, uri: "second-capacity.bin" }],
    };

    root.render(renderScene([
      gltf({ src: triangleGltfSrc, version: "cpu-shrink-first" }),
      gltf({ src: matchingTriangleGltfSrc, version: "cpu-shrink-second" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, firstDocument))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, secondDocument))).toBe(true);
    await flushMicrotasks();

    expect(
      loader.fetchRequests.filter((request) => /first-capacity\.bin(?:$|[?#])/.test(request.url)),
    ).toHaveLength(1);
    expect(
      loader.fetchRequests.filter((request) => /second-capacity\.bin(?:$|[?#])/.test(request.url)),
      "the second asset must remain blocked before requesting its external buffer",
    ).toHaveLength(0);
    const blockedUsage = root.snapshot().resourcePressure;
    expect(blockedUsage.byClass["asset-decode"].cpuDecodedBytes).toBeGreaterThan(0);
    expect(blockedUsage.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);
    expect(blockedUsage.total.cpuDecodedBytes).toBeLessThanOrEqual(cpuBudget);

    expect(loader.resolvePendingFetch(/first-capacity\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushPreparedAssetBoundary();

    const shrunkenUsage = root.snapshot().resourcePressure;
    expect(shrunkenUsage.byClass["asset-decode"].cpuDecodedBytes)
      .toBeLessThan(blockedUsage.byClass["asset-decode"].cpuDecodedBytes);
    expect(shrunkenUsage.total.cpuDecodedBytes).toBeLessThan(blockedUsage.total.cpuDecodedBytes);
    expect(
      loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
        responseWithJson(url, secondDocument)),
      "shrinking the first asset estimate must automatically retry the blocked preparation",
    ).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/second-capacity\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushPreparedAssetBoundary();

    const completedUsage = root.snapshot().resourcePressure;
    expect(completedUsage.byClass.geometry.cpuDecodedBytes)
      .toBeGreaterThan(shrunkenUsage.byClass.geometry.cpuDecodedBytes);
    expect(completedUsage.total.cpuDecodedBytes).toBeGreaterThan(shrunkenUsage.total.cpuDecodedBytes);
    expect(completedUsage.total.cpuDecodedBytes).toBeLessThanOrEqual(cpuBudget);
    root.dispose();
  });

  it("publishes mixed-scene packet topology before retrying a throwing ref attachment", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    let failAttachment = true;
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "packet-ref-retry" }),
      mesh({
        geometry: planeGeometry(0.25),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
        ref: (handle) => {
          if (handle !== null && failAttachment) {
            failAttachment = false;
            throw new Error("ref attachment failed");
          }
        },
      }),
    ]);

    expect(() => root.render(renderGraph)).toThrow("ref attachment failed");
    expect(() => root.render(renderGraph)).not.toThrow();
    expect(drawCalls(calls), "the retry must render the direct portion of the committed generation")
      .toHaveLength(1);

    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 3);
    expect(
      drawCalls(calls).slice(-2),
      "the ready glTF occurrence must remain reverse-mapped after the ref failure",
    ).toHaveLength(2);
    expect(root.snapshot().planning).toMatchObject({ planCompiles: 1, planRevision: 1, sceneCommits: 1 });
    root.dispose();
  });

  it("fills a retained loading occurrence without rebuilding on camera frames", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const cameraView = createCameraViewResource(camera());
    const renderGraph = scene({
      camera: cameraView,
      clearColor: [0, 0, 0, 0],
      nodes: [
        gltf({ src: triangleGltfSrc, version: "packet-shared-readiness" }),
      ],
    });

    root.render(renderGraph);
    expect(drawCalls(calls), "loading packet occurrence ranges must remain empty").toHaveLength(0);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => drawCalls(calls).length === 1,
    );
    expect(drawCalls(calls), "the ready event must fill its reverse-mapped occurrence").toHaveLength(1);

    const planning = root.snapshot().planning;
    const callsBeforeCameraFrame = calls.length;
    cameraView.position[0] = 0.1;
    cameraView.commit();
    await flushAnimationFrames(viewport.animationFrames);
    expect(drawCalls(calls.slice(callsBeforeCameraFrame))).toHaveLength(1);
    expect(root.snapshot().planning, "camera-only frames must retain the compiled packet topology").toEqual(planning);
  });

  it("appends every occurrence of one ready request across direct-mesh ordering segments", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: triangleGltfSrc, version: "packet-shared-segments" }),
      mesh({ geometry: planeGeometry(0.25), material: unlitMaterial({ color: [1, 1, 1, 1] }) }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.25, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        version: "packet-shared-segments",
      }),
    ]);

    root.render(renderGraph);
    expect(drawCalls(calls), "only the direct mesh draws while both packet ranges are loading").toHaveLength(1);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 4);
    expect(drawCalls(calls).slice(-3).map((call) => call.args[0])).toEqual([
      gl.TRIANGLES,
      gl.TRIANGLES,
      gl.TRIANGLES,
    ]);
  });

  it("ignores a stale loading asset completion after replacing its frame plan", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const oldGraph = renderScene([gltf({ src: triangleGltfSrc, version: "packet-stale-old" })]);
    const nextGraph = renderScene([gltf({ src: triangleGltfSrc, version: "packet-stale-next" })]);

    root.render(oldGraph);
    root.render(nextGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(drawCalls(calls), "the released plan's completion must not populate the replacement slot")
      .toHaveLength(0);

    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, triangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 1);
    expect(drawCalls(calls)).toHaveLength(1);
  });

  it("matches retained local sidedness with a negative ordinary glTF root scale", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([gltf({
      src: triangleGltfSrc,
      transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [-1, 1, 1] },
      version: "packet-negative-root",
    })]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await waitForAnimationFrameWork(viewport.animationFrames, () => drawCalls(calls).length === 1);
    expect(calls.filter((call) => call.name === "frontFace").map((call) => call.args[0])).toContain(gl.CW);
  });

  it("schedules a follow-up render when only DPR changes", async () => {
    const viewport = installViewportInvalidationStubs();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas);

    root.render(renderScene([
      mesh({
        geometry: planeGeometry(1),
        material: unlitMaterial({ color: [0.2, 0.4, 0.8, 1] }),
      }),
    ]));

    const drawCountBeforeChange = drawCalls(calls).length;
    const scheduledBeforeChange = viewport.animationFrames.length;
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual(["(resolution: 1dppx)"]);

    viewport.triggerViewportChange(canvas);
    await flushMicrotasks();
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual([
      "(resolution: 1dppx)",
      "(resolution: 2dppx)",
    ]);

    viewport.triggerViewportChange(canvas, 3);
    await flushMicrotasks();
    expect(viewport.mediaQueries.map((query) => query.media)).toEqual([
      "(resolution: 1dppx)",
      "(resolution: 2dppx)",
      "(resolution: 3dppx)",
    ]);

    expect(
      viewport.animationFrames.length > scheduledBeforeChange || drawCalls(calls).length > drawCountBeforeChange,
      "DPR-only viewport invalidation should schedule or perform a follow-up render",
    ).toBe(true);
  });

  it("culls clearly offscreen meshes against an orthographic camera", () => {
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      mesh({
        geometry: boxGeometry(0.5),
        material: unlitMaterial({ color: [0.9, 0.2, 0.1, 1] }),
      }),
      mesh({
        geometry: boxGeometry(0.5),
        material: unlitMaterial({ color: [0.1, 0.2, 0.9, 1] }),
        transform: {
          position: [100, 0, 0],
          rotation: [0, 0, 0],
        },
      }),
    ]));

    expect(drawCalls(calls), "only the visible mesh should draw").toHaveLength(1);
  });

  it("draws default glTF materials front-sided with back-face culling", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "default-front-sided-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls).toContainEqual({ args: [gl.CULL_FACE], name: "enable" });
    expect(readyFrameCalls).toContainEqual({ args: [gl.BACK], name: "cullFace" });
    expect(readyFrameCalls).toContainEqual({ args: [gl.CCW], name: "frontFace" });
  });

  it("multiplies textured glTF base color by baseColorFactor", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const base = triangleDocument();
    const renderGraph = renderScene([gltf({ src: triangleGltfSrc, version: "textured-base-color-factor" })]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...base,
        materials: [{
          pbrMetallicRoughness: {
            baseColorFactor: [0.2, 0.4, 0.6, 0.8],
            baseColorTexture: { index: 0 },
          },
        }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    root.render(renderGraph);

    expect(ControlledImage.instances).toHaveLength(1);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.2, 0.4, 0.6, 0.8]);
  });

  it("draws double-sided glTF materials without face culling", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "double-sided-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, doubleSidedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls).toContainEqual({ args: [gl.CULL_FACE], name: "disable" });
    expect(readyFrameCalls).not.toContainEqual({ args: [gl.CULL_FACE], name: "enable" });
    expect(readyFrameCalls.some((call) => call.name === "cullFace")).toBe(false);
  });

  it("threads glTF MASK alpha cutoff into the surface shader", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "alpha-mask-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, alphaMaskTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(sources).toContain("u_alphaSettings");
    expect(sources).toContain("discard");
    expect(uniform4fvPayloads(readyFrameCalls, "u_alphaSettings").map(roundVector))
      .toContainEqual([1, 0.37, 0, 0]);
  });

  it("draws glTF BLEND alpha after opaque batches and resets depth writes", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "alpha-blend-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, alphaBlendTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);
    const depthMaskIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "depthMask")
      .map(({ call, index }) => ({ index, value: call.args[0] }));
    const firstBlendDepthMask = depthMaskIndexes.find(({ value }) => value === false);
    const finalDepthMask = depthMaskIndexes.at(-1);
    const blendStateIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => (call.name === "enable" || call.name === "disable") && call.args[0] === gl.BLEND);
    const firstBlendEnable = blendStateIndexes.find(({ call }) => call.name === "enable");
    const finalBlendState = blendStateIndexes.at(-1);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(instancedDrawCalls(readyFrameCalls)).toHaveLength(0);
    expect(readyFrameCalls).toContainEqual({ args: [gl.BLEND], name: "enable" });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA],
      name: "blendFuncSeparate",
    });
    expect(uniform4fvPayloads(readyFrameCalls, "u_alphaSettings").map(roundVector))
      .toEqual([[0, 0, 0, 0], [2, 0, 0, 0]]);
    expect(firstBlendEnable?.index).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(firstBlendEnable?.index).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(firstBlendDepthMask?.index).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(firstBlendDepthMask?.index).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(finalBlendState?.call).toEqual({ args: [gl.BLEND], name: "disable" });
    expect(finalBlendState?.index).toBeGreaterThan(drawIndexes[1] ?? -1);
    expect(finalDepthMask?.value).toBe(true);
  });

  it("splits one-sided mirrored glTF draws so frontFace tracks model orientation", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "mirrored-front-face-material",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, mirroredTriangleNodesDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const frontFaceValues = readyFrameCalls
      .filter((call) => call.name === "frontFace")
      .map((call) => call.args[0]);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(instancedDrawCalls(readyFrameCalls)).toHaveLength(0);
    expect(frontFaceValues).toContain(gl.CCW);
    expect(frontFaceValues).toContain(gl.CW);
    expect(readyFrameCalls.filter((call) =>
      call.name === "cullFace" && call.args[0] === gl.BACK)).toHaveLength(2);
  });

  it("allows explicitly unlit standardMaterial meshes to render black", () => {
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    expect(() => {
      root.render(renderScene([
        mesh({
          geometry: planeGeometry(1),
          material: standardMaterial({ color: [1, 1, 1, 1] }),
        }),
      ]));
    }).not.toThrow();
  });

  it("draws glTF fallback geometry after buffers settle while base-color image is pending or failed", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "staged-fallback",
      }),
    ]);

    root.render(renderGraph);
    expect(drawCalls(calls)).toHaveLength(0);

    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "glTF should draw fallback geometry before its base-color image settles",
    ).toBe(true);
    expect(root.snapshot().resourcePressure.byClass).toMatchObject({
      "asset-decode": { cpuDecodedBytes: expect.any(Number) },
      geometry: { cpuDecodedBytes: expect.any(Number) },
    });
    // External image recipes retain a URL, not decoded binary bytes. The
    // pre-decode reservation is therefore shrunk to exact retained bytes while
    // the image request is pending.
    expect(root.snapshot().resourcePressure.byClass["asset-decode"].cpuDecodedBytes).toBe(0);
    expect(root.snapshot().resourcePressure.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);

    const drawsBeforeFailure = drawCalls(calls).length;
    const failedImage = new Error("staged base-color decode failed");
    for (const image of ControlledImage.instances) image.rejectLoad(failedImage);
    for (const bitmapRequest of loader.bitmapRequests.splice(0)) bitmapRequest.reject(failedImage);
    loader.rejectPendingFetch(/staged-triangle\.png(?:$|[?#])/, failedImage);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    root.render(renderGraph);

    expect(drawCalls(calls).length, "failed base-color image should not make the glTF disappear")
      .toBeGreaterThan(drawsBeforeFailure);
    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message).some((message) =>
      /base-?color|image|texture/i.test(message))).toBe(true);
    expect(root.snapshot().resourcePressure.byClass["asset-decode"].cpuDecodedBytes).toBe(0);
    expect(root.snapshot().resourcePressure.byClass.geometry.cpuDecodedBytes).toBeGreaterThan(0);

    root.render(renderScene([]));
    expect(root.snapshot().resourcePressure.byClass.geometry.cpuDecodedBytes).toBe(0);
  });

  it("switches a prepared glTF draw from fallback color to settled base-color texture", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "staged-texture-settle",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform1iPayloads(calls, "u_useTexture").at(-1)).toBe(0);
    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.5, 0.5, 0.5, 1]);
    expect(ControlledImage.instances).toHaveLength(1);

    const callsBeforeImageSettle = calls.length;
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);
    const imageReadyCalls = calls.slice(callsBeforeImageSettle);

    expect(drawCalls(imageReadyCalls).length).toBeGreaterThanOrEqual(1);
    expect(uniform1iPayloads(imageReadyCalls, "u_useTexture")).toContain(1);
  });

  it("uses opted-in generated VT for glTF raster baseColorTexture without manifest probing", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { contexts } = installCanvas2d();
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "gltf-base-color-generated-vt",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    const baseColorImage = ControlledImage.instances.find((image) => /staged-triangle\.png(?:$|[?#])/.test(image.src));
    expect(baseColorImage?.src).toBe("https://example.test/fixtures/staged-triangle.png");
    baseColorImage!.height = 512;
    baseColorImage!.naturalHeight = 512;
    baseColorImage!.naturalWidth = 512;
    baseColorImage!.width = 512;
    baseColorImage?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(renderGraph);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);

    for (
      let frame = 0;
      frame < 8
      && (contexts.length === 0 || root.snapshot().virtualTexturing.shaderBinds === 0);
      frame += 1
    ) {
      await flushMicrotasks();
      root.render(renderGraph);
      await flushAnimationFrames(viewport.animationFrames);
    }

    expect(contexts[0]?.createPattern).toHaveBeenCalledWith(
      baseColorImage,
      "repeat",
    );
    expect(contexts[0]?.createPattern.mock.results[0]?.value.setTransform).toHaveBeenCalledWith({
      a: 0.5,
      b: 0,
      c: 0,
      d: 0.5,
      e: 1,
      f: 1,
    });
    expect(contexts[0]?.fillRect).toHaveBeenCalledWith(0, 0, 258, 258);
    expect(shaderSources(calls).join("\n")).toContain("sampleVirtualBaseColor");
    expect(uniform1iPayloads(calls, "u_useVirtualTexture")).toContain(1);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      automaticManifestUses: 1,
      pageLoadFailures: 0,
      automaticPagesTarget: 5,
      manifestRequests: 0,
      manifestsReady: 1,
      cachedPages: expect.any(Number),
      uploadedPages: expect.any(Number),
    }));
    expect(root.snapshot().virtualTexturing.pageLoadRequests).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.cachedPages).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.uploadedPages).toBeGreaterThan(0);
  });

  it("shares glTF texture uploads for simultaneously leased matching computed bufferView content", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    class CloseTrackedImageBitmap {
      readonly close = vi.fn();
      readonly height: number;
      readonly width: number;

      constructor(size: number) {
        this.height = size;
        this.width = size;
      }
    }
    vi.stubGlobal("ImageBitmap", CloseTrackedImageBitmap);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const matchingTriangleBinUri = "matching-triangle.bin";
    const bufferViewImageDocument = (bufferUri: string): unknown => ({
      ...triangleDocument(),
      bufferViews: [
        ...(triangleDocument().bufferViews),
        { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
      ],
      buffers: [{ byteLength: triangleBinByteLength + 4, uri: bufferUri }],
      images: [{ bufferView: 4, mimeType: "image/png" }],
    });
    const firstGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "computed-content-key-a",
      }),
    ]);
    const secondGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "computed-content-key-a",
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        version: "computed-content-key-b",
      }),
    ]);

    root.render(firstGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(triangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(1);
    expect(root.snapshot().resourcePressure.byClass["asset-decode"].cpuDecodedBytes).toBe(4);
    const firstBitmap = new CloseTrackedImageBitmap(4);
    loader.bitmapRequests[0]?.resolve(firstBitmap as unknown as ImageBitmap);
    await flushMicrotasks();
    expect(root.snapshot().resourcePressure.byClass["asset-decode"].cpuDecodedBytes).toBe(0);
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(viewport.animationFrames, () => callCount(calls, "texImage2D") >= 1);

    expect(callCount(calls, "texImage2D")).toBe(1);
    const uploadsBeforeSecondGltf = callCount(calls, "texImage2D");
    const bitmapRequestsBeforeSecondGltf = loader.bitmapRequests.length;

    root.render(secondGraph);
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(matchingTriangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(bitmapRequestsBeforeSecondGltf + 1);
    const secondBitmap = new CloseTrackedImageBitmap(4);
    loader.bitmapRequests[bitmapRequestsBeforeSecondGltf]?.resolve(secondBitmap as unknown as ImageBitmap);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(secondGraph);

    expect(
      callCount(calls, "texImage2D"),
      "different glTF bufferView images with identical encoded bytes should reuse the content-addressed upload",
    ).toBe(uploadsBeforeSecondGltf);
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);

    root.render(renderScene([]));
    expect(firstBitmap.close).toHaveBeenCalledTimes(1);
    expect(secondBitmap.close).toHaveBeenCalledTimes(1);
    expect(root.snapshot().textureResidency).toMatchObject({
      activeLeases: 0,
      preparedBytes: 0,
      preparedSources: 0,
      resources: 0,
    });
  });

  it("keeps explicit glTF extras.contentKey ahead of computed image content keys", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const explicitContentKey = "royal-test:explicit-content-key-wins";
    const matchingTriangleBinUri = "matching-triangle-explicit.bin";
    const bufferViewImageDocument = (
      bufferUri: string,
      extras?: { readonly contentKey: string },
    ): unknown => ({
      ...triangleDocument(),
      bufferViews: [
        ...(triangleDocument().bufferViews),
        { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
      ],
      buffers: [{ byteLength: triangleBinByteLength + 4, uri: bufferUri }],
      images: [{
        ...(extras === undefined ? {} : { extras }),
        bufferView: 4,
        mimeType: "image/png",
      }],
    });
    const firstGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "explicit-content-key-a",
      }),
    ]);
    const secondGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        version: "explicit-content-key-b",
      }),
    ]);

    root.render(firstGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(triangleBinUri, { contentKey: explicitContentKey })))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(1);
    loader.bitmapRequests[0]?.resolve(fakeImageBitmap(4));
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(viewport.animationFrames, () => callCount(calls, "texImage2D") >= 1);

    expect(callCount(calls, "texImage2D")).toBe(1);
    const uploadsBeforeSecondGltf = callCount(calls, "texImage2D");
    const bitmapRequestsBeforeSecondGltf = loader.bitmapRequests.length;

    root.render(secondGraph);
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, bufferViewImageDocument(matchingTriangleBinUri)))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle-explicit\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    expect(loader.bitmapRequests).toHaveLength(bitmapRequestsBeforeSecondGltf + 1);
    loader.bitmapRequests[bitmapRequestsBeforeSecondGltf]?.resolve(fakeImageBitmap(4));
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => callCount(calls, "texImage2D") >= uploadsBeforeSecondGltf + 1,
    );
    root.render(secondGraph);

    expect(
      callCount(calls, "texImage2D"),
      "explicit extras.contentKey should not be replaced by the computed key for identical bytes",
    ).toBe(uploadsBeforeSecondGltf + 1);
  });

  it("automatically instances matching glTF geometry across different asset URLs", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const leftRef: { current: RenderObjectHandle | null } = { current: null };
    const rightRef: { current: RenderObjectHandle | null } = { current: null };
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [-0.25, 0, 0],
          rotation: [0, 0, 0],
        },
        ref: leftRef,
        version: "instanced-a",
      }),
      gltf({
        src: matchingTriangleGltfSrc,
        transform: {
          position: [0.25, 0, 0],
          rotation: [0, 0, 0],
        },
        ref: rightRef,
        version: "instanced-b",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/matching-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    const instancingBeforeReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);
    const readyInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeReadyRender);

    expect(instancedDraws).toHaveLength(1);
    expect(instancedDraws[0]?.name).toBe("drawElementsInstanced");
    expect(instancedDraws[0]?.args[0]).toBe(gl.TRIANGLES);
    expect(instancedDraws[0]?.args[1]).toBe(3);
    expect(instancedDrawInstanceCount(instancedDraws[0]!)).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(readyFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 32, floatOffset: 0 },
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 7
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT
      && call.args[4] === 24
      && call.args[5] === 0)).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 8
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT
      && call.args[4] === 24
      && call.args[5] === 12)).toBe(true);
    expect(readyInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 1,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 32 * Float32Array.BYTES_PER_ELEMENT,
      localModelUploadCalls: 1,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootScaleUploadCalls: 1,
    });

    const callsBeforeImperativeChange = calls.length;
    const instancingBeforeImperativeChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.5, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const changedFrameCalls = calls.slice(callsBeforeImperativeChange);
    const changedInstancedDraws = instancedDrawCalls(changedFrameCalls);
    const changedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeImperativeChange);

    expect(changedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(changedInstancedDraws[0]!)).toBe(2);
    expect(drawCalls(changedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(changedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(changedFrameCalls).map(roundVector)).toEqual([
      [-0.5, 0, 0, 0, 0, 0],
    ]);
    expect(changedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeSecondImperativeChange = calls.length;
    const instancingBeforeSecondImperativeChange = root.snapshot().gltfInstancing;
    rightRef.current?.position.set([0.5, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const secondChangedFrameCalls = calls.slice(callsBeforeSecondImperativeChange);
    const secondChangedInstancedDraws = instancedDrawCalls(secondChangedFrameCalls);
    const secondChangedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeSecondImperativeChange,
    );

    expect(secondChangedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(secondChangedInstancedDraws[0]!)).toBe(2);
    expect(drawCalls(secondChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(secondChangedFrameCalls)).toEqual([
      { byteOffset: 24, floatLength: 6, floatOffset: 6 },
    ]);
    expect(bufferSubDataPayloads(secondChangedFrameCalls).map(roundVector)).toEqual([
      [0.5, 0, 0, 0, 0, 0],
    ]);
    expect(secondChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 6 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeAdjacentPoseSlotChange = calls.length;
    const instancingBeforeAdjacentPoseSlotChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.6, 0, 0]);
    rightRef.current?.position.set([0.6, 0, 0]);
    await flushAnimationFrames(viewport.animationFrames);
    const adjacentPoseSlotFrameCalls = calls.slice(callsBeforeAdjacentPoseSlotChange);
    const adjacentPoseSlotInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeAdjacentPoseSlotChange,
    );

    expect(instancedDrawCalls(adjacentPoseSlotFrameCalls)).toHaveLength(1);
    expect(drawCalls(adjacentPoseSlotFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(adjacentPoseSlotFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(adjacentPoseSlotFrameCalls).map(roundVector)).toEqual([
      [-0.6, 0, 0, 0, 0, 0, 0.6, 0, 0, 0, 0, 0],
    ]);
    expect(adjacentPoseSlotInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforePoseChange = calls.length;
    const instancingBeforePoseChange = root.snapshot().gltfInstancing;
    leftRef.current?.position.set([-0.75, 0, 0]);
    leftRef.current?.rotation.set(0, 0, 0.25);
    rightRef.current?.position.set([0.75, 0, 0]);
    rightRef.current?.rotation.set(0, 0, -0.25);
    await flushAnimationFrames(viewport.animationFrames);
    const poseChangedFrameCalls = calls.slice(callsBeforePoseChange);
    const poseChangedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforePoseChange);

    expect(instancedDrawCalls(poseChangedFrameCalls)).toHaveLength(1);
    expect(drawCalls(poseChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(poseChangedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(poseChangedFrameCalls).map(roundVector)).toEqual([
      [-0.75, 0, 0, 0, 0, 0.25, 0.75, 0, 0, 0, 0, -0.25],
    ]);
    expect(poseChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 12 * Float32Array.BYTES_PER_ELEMENT,
      rootPoseUploadCalls: 1,
      rootScaleUploadBytes: 0,
      rootScaleUploadCalls: 0,
    });

    const callsBeforeScaleChange = calls.length;
    const instancingBeforeScaleChange = root.snapshot().gltfInstancing;
    leftRef.current?.scale.set(2, 2, 2);
    await flushAnimationFrames(viewport.animationFrames);
    const scaleChangedFrameCalls = calls.slice(callsBeforeScaleChange);
    const scaleChangedInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeScaleChange);

    expect(instancedDrawCalls(scaleChangedFrameCalls)).toHaveLength(1);
    expect(drawCalls(scaleChangedFrameCalls)).toHaveLength(0);
    expect(bufferSubDataUploadRanges(scaleChangedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 3, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(scaleChangedFrameCalls).map(roundVector)).toEqual([
      [2, 2, 2],
    ]);
    expect(scaleChangedInstancing).toEqual({
      batchInstancesTotal: 2,
      batchPlansBuilt: 0,
      drawCalls: 1,
      instancesDrawn: 2,
      localModelUploadBytes: 0,
      localModelUploadCalls: 0,
      rootPoseUploadBytes: 0,
      rootPoseUploadCalls: 0,
      rootScaleUploadBytes: 3 * Float32Array.BYTES_PER_ELEMENT,
      rootScaleUploadCalls: 1,
    });

    const deletedVertexArraysBeforeSingle = callCount(calls, "deleteVertexArray");
    const callsBeforeSingle = calls.length;
    rightRef.current?.position.set(100, 0, 0);
    await flushAnimationFrames(viewport.animationFrames);
    const singleCalls = calls.slice(callsBeforeSingle);
    expect(instancedDrawCalls(singleCalls)).toHaveLength(0);
    expect(drawCalls(singleCalls)).toHaveLength(1);
    expect(callCount(calls, "deleteVertexArray")).toBeGreaterThan(deletedVertexArraysBeforeSingle);

    const createdVertexArraysBeforeRebatch = callCount(calls, "createVertexArray");
    const callsBeforeRebatch = calls.length;
    rightRef.current?.position.set(0.75, 0, 0);
    await flushAnimationFrames(viewport.animationFrames);
    const rebatchCalls = calls.slice(callsBeforeRebatch);
    expect(instancedDrawCalls(rebatchCalls)).toHaveLength(1);
    expect(callCount(calls, "createVertexArray")).toBeGreaterThan(createdVertexArraysBeforeRebatch);
  });

});

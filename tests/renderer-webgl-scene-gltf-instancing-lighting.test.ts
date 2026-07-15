import {
  triangleGltfSrc,
  khronosEnvironmentTestGltfSrc,
  khronosEnvironmentTestTransform,
  khronosEnvironmentTestDocument,
  khronosEnvironmentTestBuffer,
  khronosEnvironmentTestLdrSpecularDocument,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installViewportInvalidationStubs,
  flushMicrotasks,
  settleControlledImageWave,
  flushAnimationFrames,
  flushPreparedAssetBoundary,
  waitForAnimationFrameWork,
  renderScene,
  drawCalls,
  instancedDrawCalls,
  shaderSources,
  instancedDrawInstanceCount,
  callCount,
  numericArray,
  bufferDataPayloads,
  bufferUploadPayloads,
  bufferSubDataUploadRanges,
  bufferSubDataPayloads,
  gltfInstancingDelta,
  roundNumber,
  roundVector,
  uniform1iPayloads,
  waitForUniform1iPayload,
  uniform4fvPayloads,
  matrixUniformPayloads,
  trackGltfSceneTestRoot,
  resetGltfSceneTestState,
} from "./renderer-webgl-scene-gltf-test-runtime";
import {
  triangleBin,
  tangentTriangleBin,
  multiUvTriangleBin,
  instancedTriangleBin,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  solidTriangleDocument,
  normalTextureTriangleDocument,
  tangentTriangleDocument,
  multiUvEmissiveTriangleDocument,
  metallicRoughnessTriangleDocument,
  metallicRoughnessTextureTriangleDocument,
  instancedTriangleDocument,
  punctualLightTriangleDocument,
  sceneSelectedImageBasedLightTriangleDocument,
  invalidImageBasedLightReferenceTriangleDocument,
  emissiveStrengthTriangleDocument,
  emissiveTextureTriangleDocument,
  occlusionTextureTriangleDocument,
  materialPbrExtensionFactorsTriangleDocument,
  materialPbrExtensionDefaultsTriangleDocument,
  materialPbrExtensionTextureDiagnosticTriangleDocument,
  materialSheenIridescenceFactorsTriangleDocument,
  materialSheenIridescenceDefaultsTriangleDocument,
  materialSheenIridescenceTextureDiagnosticTriangleDocument,
  materialSheenIridescenceBatchKeyTriangleDocument,
} from "./renderer-webgl-scene-gltf-material-documents";
import {
  responseWithJson,
  responseWithBuffer,
  installStagedGltfLoader,
  settleKhronosEnvironmentTestIblBitmaps,
} from "./renderer-webgl-scene-gltf-loader-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGltfInstanceTransforms, directionalLight, gltf, gltfInstances } from "@royal/renderer-core";
import { createWebGlRoot as createWebGlRootBase } from "@royal/renderer-webgl";

const createWebGlRoot = (...args: Parameters<typeof createWebGlRootBase>) =>
  trackGltfSceneTestRoot(createWebGlRootBase(...args));

describe("WebGL renderer glTF instancing and lighting regressions", () => {
  afterEach(resetGltfSceneTestState);

  it("uploads only a committed bulk pose range in a 10k source", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({ count: 10_000 });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-partial-pose-10k",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    const callsBeforeCommit = fake.calls.length;
    const countersBeforeCommit = renderRoot.snapshot().gltfInstancing;
    for (let index = 477; index < 480; index += 1) {
      instances.positions[index * 3] = index * 0.000_01;
    }
    instances.commitPose(477, 3);
    await flushAnimationFrames(viewport.animationFrames);
    const frameCalls = fake.calls.slice(callsBeforeCommit);
    const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforeCommit);

    expect(bufferSubDataUploadRanges(frameCalls)).toEqual([
      { byteOffset: 477 * 6 * Float32Array.BYTES_PER_ELEMENT, floatLength: 18, floatOffset: 477 * 6 },
    ]);
    expect(counters.rootPoseUploadBytes).toBe(72);
    expect(counters.rootPoseUploadCalls).toBe(1);
    expect(counters.rootScaleUploadBytes).toBe(0);
    expect(counters.rootScaleUploadCalls).toBe(0);
    renderRoot.dispose();
  });

  it("retains a committed bulk pose through an interrupted GPU upload", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({ count: 4 });
    const renderGraph = renderScene([
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-interrupted-pose-upload",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    instances.positions[3] = 0.75;
    instances.commitPose(1, 1);
    const uploadFailure = new Error("interrupted instance upload");
    vi.mocked(fake.gl.bufferSubData).mockImplementationOnce(() => {
      throw uploadFailure;
    });
    expect(() => renderRoot.render(renderGraph)).toThrow(uploadFailure);

    const callsBeforeRetry = fake.calls.length;
    renderRoot.render(renderGraph);
    const retryPose = bufferSubDataPayloads(fake.calls.slice(callsBeforeRetry))
      .find((payload) => payload.length === 24);
    expect(retryPose).toBeDefined();
    expect(roundVector(retryPose!.slice(6, 12))).toEqual([0.75, 0, 0, 0, 0, 0]);
    renderRoot.dispose();
  });

  it("keeps bulk instance scale stable across pose-only animation frames", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({
      count: 2,
      positions: [-0.25, 0, 0, 0.25, 0, 0],
      scales: [0.5, 0.5, 0.5, 0.75, 0.75, 0.75],
    });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-pose-scale-stability",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    for (let frame = 0; frame < 3; frame += 1) {
      const callsBeforePose = fake.calls.length;
      const countersBeforePose = renderRoot.snapshot().gltfInstancing;
      instances.positions[0] = -0.3 - frame * 0.1;
      instances.positions[3] = 0.3 + frame * 0.1;
      instances.rotations[2] = frame * 0.1;
      instances.rotations[5] = -frame * 0.1;
      instances.commitPose();
      await flushAnimationFrames(viewport.animationFrames);
      const frameCalls = fake.calls.slice(callsBeforePose);
      const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforePose);

      expect(instancedDrawCalls(frameCalls)).toHaveLength(1);
      expect(bufferSubDataUploadRanges(frameCalls)).toEqual([
        { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      ]);
      expect(counters.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
      expect(counters.rootPoseUploadCalls).toBe(1);
      expect(counters.rootScaleUploadBytes).toBe(0);
      expect(counters.rootScaleUploadCalls).toBe(0);
      expect(Array.from(instances.scales)).toEqual([0.5, 0.5, 0.5, 0.75, 0.75, 0.75]);
    }

    renderRoot.dispose();
  });

  it("refreshes bulk instance scales when culling swaps equal-count visible slots", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const fake = fakeGl();
    const renderRoot = createWebGlRoot(fakeCanvas(fake.gl));
    const instances = createGltfInstanceTransforms({
      count: 3,
      positions: [-0.4, 0, 0, 100, 0, 0, 0.4, 0, 0],
      scales: [0.5, 0.5, 0.5, 1, 1, 1, 0.75, 0.75, 0.75],
    });
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-equal-count-visibility-swap",
      }),
    ]);

    renderRoot.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    renderRoot.render(renderGraph);

    const callsBeforeSwap = fake.calls.length;
    const countersBeforeSwap = renderRoot.snapshot().gltfInstancing;
    instances.positions[0] = 100;
    instances.positions[3] = -0.4;
    instances.commitPose();
    await flushAnimationFrames(viewport.animationFrames);
    const swapCalls = fake.calls.slice(callsBeforeSwap);
    const counters = gltfInstancingDelta(renderRoot.snapshot().gltfInstancing, countersBeforeSwap);

    expect(instancedDrawCalls(swapCalls)).toHaveLength(1);
    expect(bufferSubDataUploadRanges(swapCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 3, floatOffset: 0 },
    ]);
    expect(bufferSubDataPayloads(swapCalls).map(roundVector)).toEqual([
      [-0.4, 0, 0, 0, 0, 0, 0.4, 0, 0, 0, 0, 0],
      [1, 1, 1],
    ]);
    expect(counters.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
    expect(counters.rootPoseUploadCalls).toBe(1);
    expect(counters.rootScaleUploadBytes).toBe(3 * Float32Array.BYTES_PER_ELEMENT);
    expect(counters.rootScaleUploadCalls).toBe(1);

    renderRoot.dispose();
  });

  it("renders required EXT_mesh_gpu_instancing node transforms through the instanced draw path", async () => {
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
        version: "ext-mesh-gpu-instancing",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, instancedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, instancedTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    const instancingBeforeReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const readyInstancing = gltfInstancingDelta(root.snapshot().gltfInstancing, instancingBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);
    const instanceModelPayload = bufferUploadPayloads(readyFrameCalls)
      .find((payload) => payload.length === 32);

    expect(instancedDraws).toHaveLength(1);
    expect(instancedDraws[0]?.name).toBe("drawElementsInstanced");
    expect(instancedDraws[0]?.args[0]).toBe(gl.TRIANGLES);
    expect(instancedDraws[0]?.args[1]).toBe(3);
    expect(instancedDrawInstanceCount(instancedDraws[0]!)).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(0);
    expect(instanceModelPayload).toBeDefined();
    expect(roundVector([
      instanceModelPayload?.[0] ?? 0,
      instanceModelPayload?.[12] ?? 0,
      instanceModelPayload?.[16] ?? 0,
      instanceModelPayload?.[28] ?? 0,
    ])).toEqual([1, -0.25, 1.25, 0.25]);
    expect(readyInstancing.batchPlansBuilt).toBe(1);
    expect(readyInstancing.batchInstancesTotal).toBe(2);

    const callsBeforeSecondReadyRender = calls.length;
    const instancingBeforeSecondReadyRender = root.snapshot().gltfInstancing;
    root.render(renderGraph);
    const secondReadyFrameCalls = calls.slice(callsBeforeSecondReadyRender);
    const secondReadyInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeSecondReadyRender,
    );

    expect(instancedDrawCalls(secondReadyFrameCalls)).toHaveLength(1);
    expect(secondReadyFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);
    expect(secondReadyFrameCalls.filter((call) =>
      call.name === "bindBuffer" && call.args[1] !== null)).toHaveLength(0);
    expect(secondReadyInstancing.batchPlansBuilt).toBe(0);
    expect(secondReadyInstancing.batchInstancesTotal).toBe(2);

    const translatedRenderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.1, 0, 0], rotation: [0, 0, 0] },
        version: "ext-mesh-gpu-instancing",
      }),
    ]);
    const callsBeforeTranslatedRender = calls.length;
    const instancingBeforeTranslatedRender = root.snapshot().gltfInstancing;
    root.render(translatedRenderGraph);
    const translatedFrameCalls = calls.slice(callsBeforeTranslatedRender);
    const translatedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeTranslatedRender,
    );

    expect(instancedDrawCalls(translatedFrameCalls)).toHaveLength(1);
    expect(bufferSubDataUploadRanges(translatedFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
    ]);
    expect(translatedInstancing.batchPlansBuilt).toBe(0);
    expect(translatedInstancing.batchInstancesTotal).toBe(2);
    expect(translatedInstancing.rootPoseUploadBytes).toBe(12 * Float32Array.BYTES_PER_ELEMENT);
    expect(translatedInstancing.rootPoseUploadCalls).toBe(1);

    const expandedRenderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "ext-mesh-gpu-instancing",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.4, 0, 0], rotation: [0, 0, 0] },
        version: "ext-mesh-gpu-instancing",
      }),
    ]);
    const callsBeforeExpandedRender = calls.length;
    const instancingBeforeExpandedRender = root.snapshot().gltfInstancing;
    root.render(expandedRenderGraph);
    const expandedInstancedDraws = instancedDrawCalls(calls.slice(callsBeforeExpandedRender));
    const expandedInstancing = gltfInstancingDelta(
      root.snapshot().gltfInstancing,
      instancingBeforeExpandedRender,
    );

    expect(expandedInstancedDraws).toHaveLength(1);
    expect(instancedDrawInstanceCount(expandedInstancedDraws[0]!)).toBe(4);
    expect(expandedInstancing.batchPlansBuilt).toBe(0);
    expect(expandedInstancing.batchInstancesTotal).toBe(4);
  });

  it("reuses instanced glTF model buffers across supplied XR views", async () => {
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
        version: "ext-mesh-gpu-instancing-xr-views",
      }),
    ]);
    const projectionMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const leftViewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      -0.03, 0, 0, 1,
    ];
    const rightViewMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.03, 0, 0, 1,
    ];
    const xrViews = [
      {
        projectionMatrix,
        viewMatrix: leftViewMatrix,
        viewport: { height: 80, width: 100, x: 0, y: 0 },
      },
      {
        projectionMatrix,
        viewMatrix: rightViewMatrix,
        viewport: { height: 80, width: 100, x: 100, y: 0 },
      },
    ];

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, instancedTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, instancedTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const instancedDraws = instancedDrawCalls(readyFrameCalls);

    expect(instancedDraws).toHaveLength(2);
    expect(instancedDraws.map(instancedDrawInstanceCount)).toEqual([2, 2]);
    expect(bufferSubDataUploadRanges(readyFrameCalls)).toEqual([
      { byteOffset: 0, floatLength: 32, floatOffset: 0 },
      { byteOffset: 0, floatLength: 12, floatOffset: 0 },
      { byteOffset: 0, floatLength: 6, floatOffset: 0 },
    ]);

    const callsBeforeSecondReadyRender = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const secondReadyFrameCalls = calls.slice(callsBeforeSecondReadyRender);

    expect(instancedDrawCalls(secondReadyFrameCalls)).toHaveLength(2);
    expect(secondReadyFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);

    const callsBeforeLightChange = calls.length;
    const plansBeforeLightChange = root.snapshot().gltfInstancing.batchPlansBuilt;
    root.render(renderScene([
      directionalLight({
        color: [0.5, 0.75, 1, 1],
        direction: [1, 0, 0],
      }),
      gltf({
        src: triangleGltfSrc,
        version: "ext-mesh-gpu-instancing-xr-views",
      }),
    ]));
    const lightChangedFrameCalls = calls.slice(callsBeforeLightChange);

    expect(instancedDrawCalls(lightChangedFrameCalls)).toHaveLength(1);
    expect(lightChangedFrameCalls.filter((call) => call.name === "bufferData")).toHaveLength(0);
    expect(lightChangedFrameCalls.filter((call) => call.name === "bufferSubData")).toHaveLength(0);
    expect(root.snapshot().gltfInstancing.batchPlansBuilt).toBe(plansBeforeLightChange);
  });

  it("refreshes equal-count bulk membership independently for asymmetric XR views", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const instances = createGltfInstanceTransforms({
      count: 3,
      positions: [-1.5, 0, 0, 0, 0, 0, 1.5, 0, 0],
    });
    const renderGraph = renderScene([
      gltfInstances({
        instances,
        src: triangleGltfSrc,
        version: "bulk-asymmetric-xr-membership",
      }),
    ]);
    const projectionMatrix = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const xrViews = [
      {
        projectionMatrix,
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          1, 0, 0, 1,
        ],
        viewport: { height: 80, width: 100, x: 0, y: 0 },
      },
      {
        projectionMatrix,
        viewMatrix: [
          1, 0, 0, 0,
          0, 1, 0, 0,
          0, 0, 1, 0,
          -1, 0, 0, 1,
        ],
        viewport: { height: 80, width: 100, x: 100, y: 0 },
      },
    ];

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, solidTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeViews = calls.length;
    root.renderViews(renderGraph, { views: xrViews });
    const viewCalls = calls.slice(callsBeforeViews);
    const instancedDraws = instancedDrawCalls(viewCalls);
    const posePayloads = bufferSubDataPayloads(viewCalls)
      .filter((payload) => payload.length === 12)
      .map(roundVector);

    expect(instancedDraws).toHaveLength(2);
    expect(instancedDraws.map(instancedDrawInstanceCount)).toEqual([2, 2]);
    expect(posePayloads).toEqual([
      [-1.5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 1.5, 0, 0, 0, 0, 0],
    ]);
    root.dispose();
  });

  it("renders required KHR_lights_punctual directional, point, and spot lights without a pass light", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "khr-lights-punctual",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, punctualLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_useClusteredLights")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightKind[0]")).toContain(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_surfaceLightColor[0]").map(roundVector)).toContainEqual([1, 1, 2, 1]);
    const clusteredData = readyFrameCalls.find((call) =>
      call.name === "texImage2D" && call.args[3] === 4 && call.args[4] === 2);
    expect(numericArray(clusteredData?.args[8]).slice(0, 8).map(roundNumber)).toEqual([
      3, 1.5, 0.75, 1, 1, 2, 3, 5,
    ]);
  });

  it("uses optional EXT_lights_image_based diffuse and specular cubemap irradiance", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = khronosEnvironmentTestDocument();
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-optional",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    const callsBeforeSpecularImagesSettle = calls.length;
    await settleKhronosEnvironmentTestIblBitmaps(loader);

    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeSpecularImagesSettle);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(drawCalls(readyFrameCalls).length).toBeGreaterThan(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblIrradiance")).toContain(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceSettings").map(roundVector))
      .toContainEqual([1, 1, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .toContainEqual([1.883914, 1.233669, 1.681576, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[8]").map(roundVector))
      .toContainEqual([0.432833, 0.126378, -0.004153, 0]);
    expect(sources).toContain("iblDiffuseIrradiance");
    expect(sources).toContain("iblSpecularSample");
    expect(sources).toContain("iblDecodeSpecularRadiance");
    expect(sources).toContain("u_iblSpecularSettings.w > 0.5");
    expect(sources).toContain("iblEnvironmentBrdf");
    expect(sources).toContain("iblGgxScattering");
    expect(sources).toContain("iblSpecularOcclusion");
    expect(sources).toContain("textureLod(u_iblSpecularCube");
    expect(sources).toContain("return radiance * u_iblSpecularSettings.y;");
    expect(sources).toContain("+ cosineWeightedIrradiance * scattering.multi;");
    expect(sources).toContain("iblClearcoatRadiance");
    expect(sources).toContain("materialDiffuseColor(baseColor.rgb) * cosineWeightedIrradiance");
    expect(diagnostics).not.toMatch(/EXT_lights_image_based light 0 specularImages are ignored/i);
    const cubeFaceTargets = readyFrameCalls
      .filter((call) => call.name === "texImage2D")
      .map((call) => Number(call.args[0]))
      .filter((target) => target >= gl.TEXTURE_CUBE_MAP_POSITIVE_X && target < gl.TEXTURE_CUBE_MAP_POSITIVE_X + 6);
    const expectedCubeFaceTargets = Array.from({ length: 5 }, () => [
      gl.TEXTURE_CUBE_MAP_POSITIVE_X,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 1,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 2,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 3,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 4,
      gl.TEXTURE_CUBE_MAP_POSITIVE_X + 5,
    ]).flat();

    expect(cubeFaceTargets).toEqual(expectedCubeFaceTargets);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblSpecular")).toContain(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_iblSpecularCube")).toContain(2);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblSpecularSettings").map(roundVector))
      .toContainEqual([1, 1, 5, 1]);
    expect(readyFrameCalls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_CUBE_MAP))
      .toBe(false);
  });

  it("treats non-PNG EXT_lights_image_based specular images as LDR", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = khronosEnvironmentTestLdrSpecularDocument();
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-ldr-specular",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    const callsBeforeSpecularImagesSettle = calls.length;
    await settleKhronosEnvironmentTestIblBitmaps(loader);

    root.render(renderGraph);
    const specularReadyCalls = calls.slice(callsBeforeSpecularImagesSettle);

    expect(uniform1iPayloads(specularReadyCalls, "u_useIblSpecular")).toContain(1);
    expect(uniform4fvPayloads(specularReadyCalls, "u_iblSpecularSettings").map(roundVector))
      .toContainEqual([1, 1, 5, 0]);
  });

  it("selects EXT_lights_image_based from the active glTF scene and applies defaults", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "ext-lights-image-based-scene-selection",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, sceneSelectedImageBasedLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceSettings").map(roundVector))
      .toContainEqual([1, 1, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .toContainEqual([0.7, 0.6, 0.5, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iblIrradianceCoefficients[0]").map(roundVector))
      .not.toContainEqual([9, 9, 9, 0]);
    expect(matrixUniformPayloads(readyFrameCalls, "u_iblWorldToIbl").map(roundVector))
      .toContainEqual([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]);
  });

  it("diagnoses invalid optional EXT_lights_image_based scene references and falls back to default lighting", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "ext-lights-image-based-invalid-reference",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, invalidImageBasedLightReferenceTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(readyFrameCalls, "u_useIblIrradiance")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_surfaceLightCount")).toContain(0);
    expect(diagnostics).toMatch(/EXT_lights_image_based skipped: missing light 5/i);
  });

  it("accepts required EXT_lights_image_based with specular cubemap support", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const document = {
      ...khronosEnvironmentTestDocument(),
      extensionsRequired: ["EXT_lights_image_based"],
    };
    const renderGraph = renderScene([
      gltf({
        src: khronosEnvironmentTestGltfSrc,
        transform: khronosEnvironmentTestTransform,
        version: "ext-lights-image-based-required",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/EnvironmentTest\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, document))).toBe(true);
    await flushMicrotasks();

    expect(loader.resolvePendingFetch(/EnvironmentTest_binary\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, khronosEnvironmentTestBuffer(document)))).toBe(true);
    await flushMicrotasks();

    expect(loader.fetchRequests.some((request) => /EnvironmentTest_binary\.bin(?:$|[?#])/.test(request.url)))
      .toBe(true);
    await settleKhronosEnvironmentTestIblBitmaps(loader);
    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message).some((message) =>
      /unsupported required glTF extension.*EXT_lights_image_based/i.test(message))).toBe(false);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    expect(drawCalls(calls.slice(callsBeforeReadyRender)).length).toBeGreaterThan(0);
  });

  it("renders required KHR_materials_emissive_strength as an emissive material multiplier", async () => {
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
        version: "khr-materials-emissive-strength",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, emissiveStrengthTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_color").map(roundVector)).toContainEqual([0.25, 0.25, 0.25, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_emissiveColor").map(roundVector)).toContainEqual([2, 0.5, 1, 1]);
  });

  it("uploads and binds glTF emissive textures", async () => {
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
        version: "emissive-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, emissiveTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-emissive.png",
    ]);
    const callsBeforePendingTextureRender = calls.length;
    root.render(renderGraph);
    const pendingTextureFrameCalls = calls.slice(callsBeforePendingTextureRender);
    const programsAfterPendingTextureRender = callCount(calls, "createProgram");

    expect(drawCalls(pendingTextureFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_emissiveTexture")).toHaveLength(0);

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_emissiveTexture", 4);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(callCount(calls, "createProgram")).toBe(programsAfterPendingTextureRender + 1);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(calls, "u_emissiveColor").map(roundVector))
      .toContainEqual([0.4, 0.5, 0.6, 1]);
    expect(uniform1iPayloads(calls, "u_emissiveTexture")).toContain(4);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 4)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_emissiveTexture;");
    expect(sources).toContain("texture(u_emissiveTexture, materialTextureUv(u_emissiveUvSet");
  });

  it("uses glTF emissiveTexture texCoord 1 when present", async () => {
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
        version: "multi-uv-emissive",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, multiUvEmissiveTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, multiUvTriangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_emissiveTexture", 4);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0.125, 0.25,
      0.375, 0.5,
      0.625, 0.75,
    ]);
    expect(sources).toContain("layout(location = 11) in vec2 a_uv1;");
    expect(uniform1iPayloads(calls, "u_emissiveUvSet")).toContain(1);
    expect(sources).toContain("in vec2 a_uv1;");
    expect(sources).toContain("texture(u_emissiveTexture, materialTextureUv(u_emissiveUvSet");
  });

  it("renders glTF metallic and roughness factors as surface uniforms", async () => {
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
        version: "metallic-roughness-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, metallicRoughnessTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const pbrFactors = uniform4fvPayloads(readyFrameCalls, "u_materialPbrFactors").map(roundVector);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(pbrFactors).toContainEqual([0.75, 0.2, 0, 0]);
    expect(pbrFactors).toContainEqual([0, 1, 0, 0]);
  });

  it("uploads and binds glTF metallic-roughness textures", async () => {
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
        version: "metallic-roughness-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, metallicRoughnessTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await settleControlledImageWave(2);
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
      "https://example.test/fixtures/staged-triangle-metallic-roughness.png",
    ]);
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_metallicRoughnessTexture", 3);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(2);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_metallicRoughnessTexture")).toContain(3);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 3)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_metallicRoughnessTexture;");
    expect(sources).toContain("texture(u_metallicRoughnessTexture, materialTextureUv(u_metallicRoughnessUvSet");
  });

  it("uploads and binds glTF occlusion textures", async () => {
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
        version: "occlusion-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, occlusionTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-occlusion.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_occlusionTexture", 5);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(calls, "u_occlusionSettings").map(roundVector))
      .toContainEqual([0.35, 0, 0, 0]);
    expect(uniform1iPayloads(calls, "u_occlusionTexture")).toContain(5);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 5)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_occlusionTexture;");
    expect(sources).toContain("texture(u_occlusionTexture, materialTextureUv(u_occlusionUvSet");
  });

  it("uploads and binds core glTF normal textures without colliding with transmission texture units", async () => {
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
        version: "normal-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, normalTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle-normal.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_normalTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_normalTexture")).toContain(1);
    expect(uniform4fvPayloads(calls, "u_normalTextureSettings").map(roundVector))
      .toContainEqual([0.42, 1, 0, 0]);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 1)).toBe(true);
    expect(sources).toContain("uniform sampler2D u_normalTexture;");
    expect(sources).toContain("dFdx(v_worldPosition)");
    expect(sources).toContain("cross(dFdx(v_worldPosition), dFdy(v_worldPosition))");
    expect(sources).toContain("vec2 normalUv = materialTextureUv(u_normalUvSet");
    expect(sources).toContain("texture(u_normalTexture, normalUv)");
  });

  it("uploads and binds glTF TANGENT attributes for normal mapping", async () => {
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
        version: "normal-tangent",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, tangentTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, tangentTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_normalTexture", 1);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      1, 0, 0, 1,
      1, 0, 0, 1,
      1, 0, 0, 1,
    ]);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 2
      && call.args[1] === 4
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(sources).toContain("in vec4 a_tangent;");
    expect(sources).toContain("v_tangent.w < 0.0");
  });

  it("renders required KHR material specular, IOR, and clearcoat factors as surface uniforms", async () => {
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
        version: "khr-materials-pbr-extension-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionFactorsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_specularColorFactor").map(roundVector))
      .toContainEqual([1.4, 0.5, 0.25, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors").map(roundVector))
      .toContainEqual([0.35, 1.33, 0.75, 0.2]);
  });

  it("renders required KHR material specular, IOR, and clearcoat defaults deterministically", async () => {
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
        version: "khr-materials-pbr-extension-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_specularColorFactor")).toHaveLength(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors")).toHaveLength(0);
    expect(shaderSources(calls).join("\n")).toContain("#define MATERIAL_EXTENDED 0");
  });

  it("uploads and binds KHR material specular and clearcoat textures", async () => {
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
        version: "khr-materials-pbr-extension-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialPbrExtensionTextureDiagnosticTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_specularColorTexture").includes(7)
        && uniform1iPayloads(calls, "u_clearcoatRoughnessTexture").includes(9),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_specularTexture")).toContain(6);
    expect(uniform1iPayloads(calls, "u_specularColorTexture")).toContain(7);
    expect(uniform1iPayloads(calls, "u_clearcoatTexture")).toContain(8);
    expect(uniform1iPayloads(calls, "u_clearcoatRoughnessTexture")).toContain(9);
    expect(uniform1iPayloads(calls, "u_clearcoatNormalTexture")).toContain(10);
    expect(uniform4fvPayloads(calls, "u_normalTextureSettings").map(roundVector))
      .toContainEqual([1, 0.35, 0, 0]);
    for (const unit of [6, 7, 8, 9, 10]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_specularTexture;");
    expect(sources).toContain("texture(u_specularTexture, materialTextureUv(u_specularUvSet");
    expect(sources).toContain("texture(u_specularColorTexture, materialTextureUv(u_specularColorUvSet");
    expect(sources).toContain("texture(u_clearcoatTexture, materialTextureUv(u_clearcoatUvSet");
    expect(sources).toContain("texture(u_clearcoatRoughnessTexture, materialTextureUv(u_clearcoatRoughnessUvSet");
    expect(sources).toContain("texture(u_clearcoatNormalTexture, normalUv)");
    expect(sources).toContain("vec3 clearcoatNormal = materialClearcoatNormal(geometricNormal);");
    expect(sources).toContain("iblClearcoatRadiance(clearcoatNormal, viewDirection)");
    expect(diagnostics).not.toMatch(/KHR_materials_specular\.specularTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_specular\.specularColorTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_clearcoat\.clearcoatTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_clearcoat\.clearcoatRoughnessTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_clearcoat\.clearcoatNormalTexture.*ignored/i);
  });

  it("renders required KHR_materials_clearcoat normal maps", async () => {
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
        version: "khr-materials-clearcoat-required-normal-map",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...materialPbrExtensionTextureDiagnosticTriangleDocument(),
        extensionsRequired: ["KHR_materials_clearcoat", "KHR_materials_specular"],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushPreparedAssetBoundary();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    root.render(renderGraph);
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_clearcoatNormalTexture", 10);
    expect(drawCalls(calls).length).toBeGreaterThan(0);
    expect(uniform1iPayloads(calls, "u_clearcoatNormalTexture")).toContain(10);
    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n"))
      .not.toMatch(/KHR_materials_clearcoat\.clearcoatNormalTexture.*ignored/i);
  });

  it("renders required KHR material sheen and iridescence factors as visible shader uniforms", async () => {
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
        version: "khr-materials-sheen-iridescence-factors",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceFactorsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([1, 0.2, 0.1, 0.55]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.65, 1.8, 120, 620]);
    expect(sources).toContain("materialSheenContribution");
    expect(sources).toContain("materialSheenAlbedoScale");
    expect(sources).toContain("materialIridescenceTint");
    expect(sources).toContain("vec3 fresnel = mix(f0, f90, fresnelPow(VdotH)) * materialIridescenceTint(VdotH);");
  });

  it("renders required KHR material sheen and iridescence defaults exactly", async () => {
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
        version: "khr-materials-sheen-iridescence-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor")).toHaveLength(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors")).toHaveLength(0);
    expect(shaderSources(calls).join("\n")).toContain("#define MATERIAL_EXTENDED 0");
  });

  it("uploads and binds KHR material sheen and iridescence textures", async () => {
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
        version: "khr-materials-sheen-iridescence-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceTextureDiagnosticTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await flushPreparedAssetBoundary();
    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "https://example.test/fixtures/staged-triangle.png",
    ]);
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_sheenColorTexture").includes(10)
        && uniform1iPayloads(calls, "u_iridescenceThicknessTexture").includes(13),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_sheenColorTexture")).toContain(10);
    expect(uniform1iPayloads(calls, "u_sheenRoughnessTexture")).toContain(11);
    expect(uniform1iPayloads(calls, "u_iridescenceTexture")).toContain(12);
    expect(uniform1iPayloads(calls, "u_iridescenceThicknessTexture")).toContain(13);
    for (const unit of [10, 11, 12, 13]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_sheenColorTexture;");
    expect(sources).toContain("texture(u_sheenColorTexture, materialTextureUv(u_sheenColorUvSet");
    expect(sources).toContain("texture(u_sheenRoughnessTexture, materialTextureUv(u_sheenRoughnessUvSet");
    expect(sources).toContain("texture(u_iridescenceTexture, materialTextureUv(u_iridescenceUvSet");
    expect(sources).toContain("texture(u_iridescenceThicknessTexture, materialTextureUv(u_iridescenceThicknessUvSet");
    expect(diagnostics).not.toMatch(/KHR_materials_sheen\.sheenColorTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_sheen\.sheenRoughnessTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_iridescence\.iridescenceTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_iridescence\.iridescenceThicknessTexture.*ignored/i);
  });

  it("renders distinct sheen and iridescence uniforms for split glTF materials", async () => {
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
        version: "khr-materials-sheen-iridescence-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialSheenIridescenceBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([0.1, 0.2, 0.3, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_sheenColorFactor").map(roundVector))
      .toContainEqual([0.3, 0.2, 0.1, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.15, 1.3, 100, 300]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_iridescenceFactors").map(roundVector))
      .toContainEqual([0.85, 1.3, 100, 700]);
  });

});

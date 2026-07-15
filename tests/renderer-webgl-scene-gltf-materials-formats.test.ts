import {
  defaultCanvasSize,
  triangleGltfSrc,
  triangleBinUri,
  triangleImageUri,
  triangleVariantImageUri,
  triangleBinByteLength,
  meshoptCompressedPositionByteLength,
  meshoptCompressedIndexByteLength,
  meshoptCompressedTriangleBinByteLength,
  dracoCompressedTriangleBinByteLength,
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
  shaderSources,
  drawCount,
  callCount,
  bufferDataPayloads,
  roundVector,
  uniform1iPayloads,
  uniform4fvPayloads,
  uniform2fvPayloads,
  trackGltfSceneTestRoot,
  resetGltfSceneTestState,
} from "./renderer-webgl-scene-gltf-test-runtime";
import {
  triangleBin,
  meshoptCompressedTriangleBin,
  dracoCompressedTriangleBin,
  glbContainer,
  dataUriForBuffer,
  interleavedTriangleBin,
  quantizedTriangleBin,
  sparseTriangleBin,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  triangleDocument,
  materialTransmissionVolumeTriangleDocument,
  materialTransmissionVolumeDefaultsTriangleDocument,
  materialDispersionTriangleDocument,
  materialDispersionDefaultsClampingTriangleDocument,
  materialTransmissionVolumeTextureDiagnosticTriangleDocument,
  materialOverfullTextureUnitTriangleDocument,
  materialOverfullSolidBaseImageBasedLightTriangleDocument,
  materialTransmissionBatchKeyTriangleDocument,
  materialDispersionBatchKeyTriangleDocument,
  materialVariantsTriangleDocument,
  materialVariantTextureTriangleDocument,
} from "./renderer-webgl-scene-gltf-material-documents";
import {
  responseWithJson,
  responseWithBuffer,
  installStagedGltfLoader,
} from "./renderer-webgl-scene-gltf-loader-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { directionalLight, gltf, mesh, planeGeometry, unlitMaterial } from "@royal/renderer-core";
import { createWebGlRoot as createWebGlRootBase } from "@royal/renderer-webgl";

const createWebGlRoot = (...args: Parameters<typeof createWebGlRootBase>) =>
  trackGltfSceneTestRoot(createWebGlRootBase(...args));

describe("WebGL renderer glTF advanced material and format regressions", () => {
  afterEach(resetGltfSceneTestState);

  it("renders required KHR materials transmission and volume through current-frame screen sampling", async () => {
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
        version: "khr-materials-transmission-volume",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    // The first ready frame initiates the opaque variant and retains the
    // transmission variant for the next demand frame.
    const callsBeforeShaderWarmup = calls.length;
    root.render(renderGraph);
    const callsBeforeReadyRender = calls.length;
    root.flushInvalidated();
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const shaderWarmupAndReadyCalls = calls.slice(callsBeforeShaderWarmup);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const readyDrawCalls = drawCalls(readyFrameCalls);
    const copyIndex = readyFrameCalls.findIndex((call) => call.name === "copyTexSubImage2D");
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);

    expect(readyDrawCalls).toHaveLength(2);
    expect(copyIndex).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(copyIndex).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(shaderWarmupAndReadyCalls).toContainEqual({
      args: [
        gl.TEXTURE_2D,
        0,
        gl.RGBA16F,
        defaultCanvasSize.width,
        defaultCanvasSize.height,
        0,
        gl.RGBA,
        gl.HALF_FLOAT,
        null,
      ],
      name: "texImage2D",
    });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, 0, 0, 0, 0, defaultCanvasSize.width, defaultCanvasSize.height],
      name: "copyTexSubImage2D",
    });
    expect(readyFrameCalls).toContainEqual({
      args: [gl.TEXTURE0 + 1],
      name: "activeTexture",
    });
    expect(uniform1iPayloads(readyFrameCalls, "u_transmissionScreenTexture")).toContain(1);
    expect(uniform2fvPayloads(readyFrameCalls, "u_viewportOrigin").map(roundVector))
      .toContainEqual([0, 0]);
    expect(uniform2fvPayloads(readyFrameCalls, "u_viewportSize").map(roundVector))
      .toContainEqual([defaultCanvasSize.width, defaultCanvasSize.height]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor").map(roundVector))
      .toContainEqual([0.8, 0.6, 0.4, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.65, 0.4, 2, 1]);
    expect(sources).toContain("materialVolumeAttenuation");
    expect(sources).toContain("materialTransmissionScreenColor");
    expect(sources).toContain("gl_FragCoord.xy - u_viewportOrigin");
    expect(sources).toContain("texture(u_transmissionScreenTexture");
    expect(sources).toContain("lit = mix(lit, transmitted + lit * fresnel, transmission);");
    expect(sources).toContain("mix(environmentFallback, screenSample.rgb, screenSample.a)");
    expect(sources).not.toContain("u_refractionColor");

    const callsBeforeStableRender = calls.length;
    root.render(renderGraph);
    const stableFrameCalls = calls.slice(callsBeforeStableRender);

    expect(stableFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(stableFrameCalls.some((call) =>
      call.name === "texImage2D"
      && call.args[0] === gl.TEXTURE_2D
      && call.args[1] === 0
      && call.args[2] === gl.RGBA
      && call.args[3] === defaultCanvasSize.width
      && call.args[4] === defaultCanvasSize.height)).toBe(false);

    const identity = [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ];
    const callsBeforeViews = calls.length;
    root.renderViews(renderGraph, {
      views: [
        {
          projectionMatrix: identity,
          viewMatrix: identity,
          viewport: { height: 80, width: 100, x: 11, y: 13 },
        },
        {
          projectionMatrix: identity,
          viewMatrix: identity,
          viewport: { height: 80, width: 100, x: 127, y: 17 },
        },
      ],
    });
    const viewCalls = calls.slice(callsBeforeViews);
    expect(viewCalls
      .filter((call) => call.name === "copyTexSubImage2D")
      .map((call) => call.args.slice(4, 8)))
      .toEqual([
        [0, 0, 100, 80],
        [0, 0, 100, 80],
      ]);
  });

  it("takes an independent transmission screen copy on each side of a direct-mesh barrier", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "transmission-segment-barrier",
      }),
      mesh({
        geometry: planeGeometry(0.1),
        material: unlitMaterial({ color: [1, 1, 1, 1] }),
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.25, 0, 0], rotation: [0, 0, 0] },
        version: "transmission-segment-barrier",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    root.render(renderGraph);
    root.flushInvalidated();
    const callsBeforeReadyFrame = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyFrame);
    const orderedSubmissionCalls = readyFrameCalls.filter((call) =>
      call.name === "drawArrays"
      || call.name === "drawElements"
      || call.name === "copyTexSubImage2D");

    expect(drawCalls(readyFrameCalls)).toHaveLength(5);
    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(2);
    expect(orderedSubmissionCalls.map((call) => call.name)).toEqual([
      "drawElements",
      "copyTexSubImage2D",
      "drawElements",
      "drawElements",
      "drawElements",
      "copyTexSubImage2D",
      "drawElements",
      "drawArrays",
    ]);
    root.dispose();
  });

  it("renders required KHR materials transmission and volume defaults exactly", async () => {
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
        version: "khr-materials-transmission-volume-defaults",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeDefaultsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(readyFrameCalls.some((call) => call.name === "copyTexSubImage2D")).toBe(false);
    expect(uniform1iPayloads(readyFrameCalls, "u_transmissionScreenTexture")).toHaveLength(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor")).toHaveLength(0);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors")).toHaveLength(0);
    expect(shaderSources(calls).join("\n")).toContain("#define MATERIAL_EXTENDED 0");
  });

  it("renders required KHR materials dispersion through per-channel transmission sampling", async () => {
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
        version: "khr-materials-dispersion",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    // The retained demand frame is the first one where both the opaque source
    // and dispersive surface shaders are ready.
    root.render(renderGraph);
    const callsBeforeReadyRender = calls.length;
    root.flushInvalidated();
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");
    const readyDrawCalls = drawCalls(readyFrameCalls);
    const copyIndex = readyFrameCalls.findIndex((call) => call.name === "copyTexSubImage2D");
    const drawIndexes = readyFrameCalls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.name === "drawArrays" || call.name === "drawElements")
      .map(({ index }) => index);
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(readyDrawCalls).toHaveLength(2);
    expect(copyIndex).toBeGreaterThan(drawIndexes[0] ?? -1);
    expect(copyIndex).toBeLessThan(drawIndexes[1] ?? Number.POSITIVE_INFINITY);
    expect(diagnostics).not.toMatch(/unsupported required glTF extension/i);
    expect(uniform4fvPayloads(readyFrameCalls, "u_materialExtensionFactors").map(roundVector))
      .toContainEqual([1, 1.6, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_attenuationColorFactor").map(roundVector))
      .toContainEqual([0.9, 0.8, 0.7, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.7, 0.5, 3, 1]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
    expect(sources).toContain("uniform vec4 u_dispersionFactors;");
    expect(sources).toContain("materialDispersionIors");
    expect(sources).toContain("float halfSpread = (safeIor - 1.0) * 0.025 * max(dispersion, 0.0);");
    expect(sources).toContain("vec3(safeIor - halfSpread, safeIor, safeIor + halfSpread)");
    expect(sources).toContain("texture(u_transmissionScreenTexture, redUv).r");
    expect(sources).toContain("texture(u_transmissionScreenTexture, blueUv).b");
  });

  it("defaults and clamps KHR materials dispersion to non-negative scalar uniforms", async () => {
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
        version: "khr-materials-dispersion-defaults-clamping",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionDefaultsClampingTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const dispersionPayloads = uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector);
    const transmissionVolumePayloads = uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors")
      .map(roundVector);

    expect(drawCalls(readyFrameCalls)).toHaveLength(2);
    expect(readyFrameCalls.some((call) => call.name === "copyTexSubImage2D")).toBe(false);
    expect(dispersionPayloads).toHaveLength(0);
    expect(transmissionVolumePayloads).toHaveLength(0);
  });

  it("uploads and binds KHR materials transmission and volume texture multipliers", async () => {
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
        version: "khr-materials-transmission-volume-texture-diagnostics",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionVolumeTextureDiagnosticTriangleDocument()))).toBe(true);
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
    await flushAnimationFrames(viewport.animationFrames);

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(calls).join("\n");
    const diagnostics = root.snapshot().diagnosticLog.entries.map((entry) => entry.message).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    for (const unit of [14, 15]) {
      expect(calls.some((call) =>
        call.name === "activeTexture"
        && call.args[0] === gl.TEXTURE0 + unit)).toBe(true);
    }
    expect(sources).toContain("uniform sampler2D u_materialTransmissionTexture;");
    expect(sources).toContain("texture(u_materialTransmissionTexture, materialTextureUv(u_materialTransmissionUvSet");
    expect(sources).toContain("texture(u_thicknessTexture, materialTextureUv(u_thicknessUvSet");
    expect(diagnostics).not.toMatch(/KHR_materials_transmission\.transmissionTexture.*ignored/i);
    expect(diagnostics).not.toMatch(/KHR_materials_volume\.thicknessTexture.*ignored/i);
  });

  it("does not alias optional material textures when fragment texture units are exhausted", async () => {
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
        version: "overfull-texture-units",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialOverfullTextureUnitTriangleDocument()))).toBe(true);
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
      () => uniform1iPayloads(calls, "u_sheenColorTexture").length > 0
        && uniform1iPayloads(calls, "u_thicknessTexture").length > 0,
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const overfullSurfaceSource =
      shaderSources(calls).filter((source) => source.includes("u_materialTransmissionTexture")).at(-1) ?? "";
    const enabledSamplerUniforms = [
      "u_texture",
      "u_transmissionScreenTexture",
      "u_emissiveTexture",
      "u_metallicRoughnessTexture",
      "u_normalTexture",
      "u_occlusionTexture",
      "u_specularTexture",
      "u_specularColorTexture",
      "u_clearcoatTexture",
      "u_clearcoatRoughnessTexture",
      "u_sheenColorTexture",
      "u_sheenRoughnessTexture",
      "u_iridescenceTexture",
      "u_iridescenceThicknessTexture",
      "u_materialTransmissionTexture",
      "u_thicknessTexture",
    ].map((name) => uniform1iPayloads(calls, name).at(-1));

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(enabledSamplerUniforms).toHaveLength(new Set(enabledSamplerUniforms).size);
    expect(enabledSamplerUniforms).toEqual(expect.arrayContaining(Array.from({ length: 16 }, (_value, index) => index)));
    expect((overfullSurfaceSource.match(/uniform sampler/g) ?? [])).toHaveLength(16);
    expect(overfullSurfaceSource).not.toContain("u_iblSpecularCube");
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    expect(calls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 16)).toBe(false);
  });

  it("uses material samplers before optional BRDF LUT when IBL exhausts texture units", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({
        src: triangleGltfSrc,
        version: "overfull-texture-units-ibl",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialOverfullSolidBaseImageBasedLightTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    await settleControlledImageWave(7);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_thicknessTexture").includes(15),
    );

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const surfaceSource =
      shaderSources(calls).filter((source) => source.includes("u_materialTransmissionTexture")).at(-1) ?? "";

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect((surfaceSource.match(/uniform sampler/g) ?? [])).toHaveLength(16);
    expect(surfaceSource).toContain("uniform samplerCube u_iblSpecularCube;");
    expect(surfaceSource).not.toContain("uniform sampler2D u_iblBrdfLut;");
    expect(uniform1iPayloads(calls, "u_iblSpecularCube")).toContain(2);
    expect(uniform1iPayloads(calls, "u_useIblBrdfLut")).toContain(0);
    expect(uniform1iPayloads(readyFrameCalls, "u_iblBrdfLut")).toEqual([]);
    expect(uniform1iPayloads(calls, "u_normalTexture")).toContain(0);
    expect(uniform1iPayloads(calls, "u_materialTransmissionTexture")).toContain(14);
    expect(uniform1iPayloads(calls, "u_thicknessTexture")).toContain(15);
    expect(readyFrameCalls.some((call) =>
      call.name === "activeTexture"
      && call.args[0] === gl.TEXTURE0 + 16)).toBe(false);
  });

  it("renders distinct transmission uniforms while sampling the current frame once", async () => {
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
        version: "khr-materials-transmission-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialTransmissionBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.2, 0, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_transmissionVolumeFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
  });

  it("renders distinct dispersion uniforms while sampling the current frame once", async () => {
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
        version: "khr-materials-dispersion-batch-key",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialDispersionBatchKeyTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);

    expect(readyFrameCalls.filter((call) => call.name === "copyTexSubImage2D")).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.2, 0, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_dispersionFactors").map(roundVector))
      .toContainEqual([0.8, 0, 0, 0]);
  });

  it("selects KHR_materials_variants materials by name and falls back to the base material", async () => {
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
        transform: { position: [-0.45, 0, 0], rotation: [0, 0, 0] },
        materialVariant: "ruby",
        version: "khr-materials-variants",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        materialVariant: "mint",
        version: "khr-materials-variants",
      }),
      gltf({
        src: triangleGltfSrc,
        transform: { position: [0.45, 0, 0], rotation: [0, 0, 0] },
        materialVariant: "missing",
        version: "khr-materials-variants",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialVariantsTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const colors = uniform4fvPayloads(readyFrameCalls, "u_color").map(roundVector);

    expect(drawCalls(readyFrameCalls).filter((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3))
      .toHaveLength(3);
    expect(colors).toContainEqual([0.9, 0.1, 0.08, 1]);
    expect(colors).toContainEqual([0.1, 0.72, 0.46, 1]);
    expect(colors).toContainEqual([0.22, 0.24, 0.28, 1]);
    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message)).toContain(
      `glTF materialVariant "missing" is not declared by ${triangleGltfSrc}; rendering its base material`,
    );
  });

  it("settles and uploads images referenced only by KHR_materials_variants materials", async () => {
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
        materialVariant: "textured",
        version: "khr-materials-variants-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, materialVariantTextureTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleVariantImageUri}`))).toBe(true);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(0);
    const programsBeforeTextureReady = callCount(calls, "createProgram");
    const vertexArraysBeforeTextureReady = callCount(calls, "createVertexArray");

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(callCount(calls, "createProgram")).toBeGreaterThan(programsBeforeTextureReady);
    expect(callCount(calls, "createVertexArray")).toBe(vertexArraysBeforeTextureReady);
  });

  it("loads glTF buffers from data URIs without fetching external buffer resources", async () => {
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
        version: "data-uri-buffer",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        buffers: [
          {
            byteLength: triangleBinByteLength,
            uri: dataUriForBuffer(triangleBin()),
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "glTF should draw from an embedded data URI buffer",
    ).toBe(true);
  });

  it("loads GLB JSON and BIN chunks without fetching external buffer resources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const triangleGlbSrc = "https://example.test/fixtures/staged-triangle.glb";
    const renderGraph = renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: triangleGlbSrc,
        version: "glb-bin-chunk",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.glb(?:$|[?#])/, (url) =>
      responseWithBuffer(url, glbContainer({
        ...triangleDocument(),
        buffers: [
          {
            byteLength: triangleBinByteLength,
          },
        ],
      }, triangleBin())))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => /staged-triangle\.bin(?:$|[?#])/.test(request.url)))
      .toBe(false);
    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "GLB should draw from its embedded BIN chunk",
    ).toBe(true);
  });

  it("decodes required EXT_meshopt_compression bufferViews before reading accessors", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "ext-meshopt-compression" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          {
            buffer: 1,
            byteLength: 36,
            byteOffset: 0,
            extensions: {
              EXT_meshopt_compression: {
                buffer: 0,
                byteLength: meshoptCompressedPositionByteLength,
                byteOffset: 0,
                byteStride: 12,
                count: 3,
                mode: "ATTRIBUTES",
              },
            },
            target: 34962,
          },
          {
            buffer: 1,
            byteLength: 6,
            byteOffset: 36,
            extensions: {
              EXT_meshopt_compression: {
                buffer: 0,
                byteLength: meshoptCompressedIndexByteLength,
                byteOffset: meshoptCompressedPositionByteLength,
                byteStride: 2,
                count: 3,
                mode: "TRIANGLES",
              },
            },
            target: 34963,
          },
        ],
        buffers: [
          { byteLength: meshoptCompressedTriangleBinByteLength, uri: triangleBinUri },
          { byteLength: 42 },
        ],
        extensionsRequired: ["EXT_meshopt_compression"],
        extensionsUsed: ["EXT_meshopt_compression"],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, meshoptCompressedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await waitForAnimationFrameWork(viewport.animationFrames, () =>
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3));

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("decodes required KHR_draco_mesh_compression primitive geometry and texture coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "khr-draco-mesh-compression" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { componentType: 5126, count: 3, max: [0.5, 0.5, 0], min: [-0.5, -0.5, 0], type: "VEC3" },
          { componentType: 5126, count: 3, type: "VEC3" },
          { componentType: 5126, count: 3, type: "VEC2" },
          { componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [{ buffer: 0, byteLength: dracoCompressedTriangleBinByteLength, byteOffset: 0 }],
        buffers: [{ byteLength: dracoCompressedTriangleBinByteLength, uri: triangleBinUri }],
        extensionsRequired: ["KHR_draco_mesh_compression"],
        extensionsUsed: ["KHR_draco_mesh_compression"],
        images: [{ mimeType: "image/png", uri: triangleImageUri }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        meshes: [{
          primitives: [{
            attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
            extensions: {
              KHR_draco_mesh_compression: {
                attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 },
                bufferView: 0,
              },
            },
            indices: 3,
            material: 0,
            mode: 4,
          }],
        }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
        textures: [{ sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, dracoCompressedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
    );

    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message)).toEqual([]);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    const payloads = bufferDataPayloads(calls).map(roundVector);
    expect(payloads).toContainEqual([
      0.000031, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
    expect(payloads).toContainEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
    expect(payloads).toContainEqual([
      0.500122, 1,
      0, 0,
      1, 0,
    ]);
    expect(payloads).toContainEqual([0, 1, 2]);
  });

  it("decodes interleaved glTF accessors with byteStride", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "interleaved-accessors" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 0, byteOffset: 12, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 0, byteOffset: 24, componentType: 5126, count: 3, type: "VEC2" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 96, byteOffset: 0, byteStride: 32, target: 34962 },
          { buffer: 0, byteLength: 6, byteOffset: 96, target: 34963 },
        ],
        buffers: [{ byteLength: 102, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { NORMAL: 1, POSITION: 0, TEXCOORD_0: 2 }, indices: 3, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, interleavedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("decodes required KHR_mesh_quantization normalized integer attributes", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "quantized-accessors" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          { bufferView: 0, componentType: 5122, count: 3, normalized: true, type: "VEC3" },
          { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 18, byteOffset: 0, target: 34962 },
          { buffer: 0, byteLength: 6, byteOffset: 18, target: 34963 },
        ],
        buffers: [{ byteLength: 24, uri: triangleBinUri }],
        extensionsRequired: ["KHR_mesh_quantization"],
        extensionsUsed: ["KHR_mesh_quantization"],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, quantizedTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 1, 0,
      -1, -1, 0,
      1, -1, 0,
    ]);
  });

  it("applies sparse glTF accessor overrides", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "sparse-accessor" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [
          {
            componentType: 5126,
            count: 3,
            sparse: {
              count: 3,
              indices: { bufferView: 0, componentType: 5121 },
              values: { bufferView: 1 },
            },
            type: "VEC3",
          },
        ],
        asset: { version: "2.0" },
        bufferViews: [
          { buffer: 0, byteLength: 3, byteOffset: 0 },
          { buffer: 0, byteLength: 36, byteOffset: 4 },
        ],
        buffers: [{ byteLength: 40, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 4 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, sparseTriangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0.5, 0,
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
    ]);
  });

  it("applies required KHR_texture_transform to base-color texture coordinates", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "texture-transform" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_transform"],
        extensionsUsed: ["KHR_texture_transform"],
        materials: [
          {
            normalTexture: {
              extensions: {
                KHR_texture_transform: { offset: [0.4, 0.3], scale: [0.25, 0.5] },
              },
              index: 0,
            },
            occlusionTexture: {
              extensions: {
                KHR_texture_transform: { offset: [0.2, 0.1], scale: [0.5, 0.5] },
              },
              index: 0,
            },
            pbrMetallicRoughness: {
              baseColorTexture: {
                extensions: {
                  KHR_texture_transform: {
                    offset: [0.25, 0.5],
                    scale: [0.5, 0.25],
                  },
                },
                index: 0,
              },
              metallicRoughnessTexture: {
                extensions: {
                  KHR_texture_transform: { offset: [0.1, 0.2], scale: [0.25, 0.25] },
                },
                index: 0,
              },
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await settleControlledImageWave(1);
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_texture").length > 0
        && uniform1iPayloads(calls, "u_metallicRoughnessTexture").length > 0
        && uniform1iPayloads(calls, "u_normalTexture").length > 0
        && uniform1iPayloads(calls, "u_occlusionTexture").length > 0,
    );

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.25, 0]);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow1").map(roundVector))
      .toContainEqual([0, 0.25, 0.5, 0]);
    expect(uniform4fvPayloads(calls, "u_metallicRoughnessUvRow0").map(roundVector))
      .toContainEqual([0.25, 0, 0.1, 0]);
    expect(uniform4fvPayloads(calls, "u_normalUvRow0").map(roundVector))
      .toContainEqual([0.25, 0, 0.4, 0]);
    expect(uniform4fvPayloads(calls, "u_occlusionUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.2, 0]);
  });

});

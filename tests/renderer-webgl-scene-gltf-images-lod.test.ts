import {
  decodeBasisuMock,
  triangleGltfSrc,
  triangleBinUri,
  triangleImageUri,
  triangleBasisuImageUri,
  triangleJpegImageUri,
  triangleSvgImageUri,
  triangleSvgTexture,
  triangleWebpImageUri,
  triangleBinByteLength,
  lodGltfSrc,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installViewportInvalidationStubs,
  flushMicrotasks,
  flushAnimationFrames,
  waitForAnimationFrameWork,
  renderScene,
  drawCalls,
  shaderSources,
  drawCount,
  callCount,
  lodScaleForCoverage,
  lodStereoViews,
  bufferDataPayloads,
  roundVector,
  uniformLocationName,
  uniform1iPayloads,
  waitForUniform1iPayload,
  uniform4fvPayloads,
  matrixUniformPayloads,
  textureParameterCalls,
  texturePixelStoreCalls,
  trackGltfSceneTestRoot,
  resetGltfSceneTestState,
} from "./renderer-webgl-scene-gltf-test-runtime";
import {
  triangleBin,
  vertexColorTriangleBin,
  lineBin,
  triangleWithImageBytes,
  triangleWithBasisuBytes,
} from "./renderer-webgl-scene-gltf-binary-fixtures";
import {
  nodeLodDocument,
  nodeLodSeparatedBoundsDocument,
  materialLodDocument,
  materialTexturePendingLodDocument,
  materialSecondaryTexturePendingLodDocument,
  materialSharedTextureLodDocument,
} from "./renderer-webgl-scene-gltf-lod-documents";
import {
  triangleDocument,
  solidTriangleDocument,
  vertexColorTriangleDocument,
} from "./renderer-webgl-scene-gltf-material-documents";
import {
  responseWithJson,
  responseWithBuffer,
  responseWithText,
  installStagedGltfLoader,
  installCanvas2d,
  installCanvasImageMimeTypeSupport,
  settleDocumentAndBuffer,
  settleLodDocumentAndBuffer,
} from "./renderer-webgl-scene-gltf-loader-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { directionalLight, gltf, perspectiveCamera } from "@royal/renderer-core";
import type { RenderObjectHandle } from "@royal/renderer-core";
import { createWebGlRoot as createWebGlRootBase } from "@royal/renderer-webgl";
import {
  identityMat4,
  projectionMat4,
} from "../packages/renderer-webgl/src/math/mat4";

const createWebGlRoot = (...args: Parameters<typeof createWebGlRootBase>) =>
  trackGltfSceneTestRoot(createWebGlRootBase(...args));

describe("WebGL renderer glTF image, primitive, and LOD regressions", () => {
  afterEach(resetGltfSceneTestState);

  it("applies parent and child transforms when traversing glTF node hierarchies", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "node-hierarchy" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        nodes: [
          { children: [1], translation: [0.25, 0, 0] },
          { mesh: 0, translation: [0.25, 0, 0] },
        ],
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(matrixUniformPayloads(calls, "u_model").map(roundVector)).toContainEqual([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.5, 0, 0, 1,
    ]);
  });

  it("loads glTF bufferView base-color images on primitives without normals", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "buffer-view-image" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      {
        const document = triangleDocument();
        const primitive = document.meshes[0]?.primitives[0];
        return responseWithJson(url, {
          ...document,
          bufferViews: [
            ...document.bufferViews,
            { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
          ],
          buffers: [{ byteLength: triangleBinByteLength + 4, uri: triangleBinUri }],
          images: [{ bufferView: 4, mimeType: "image/png" }],
          meshes: [{
            primitives: [{
              ...primitive,
              attributes: {
                POSITION: 0,
                TEXCOORD_0: 2,
              },
            }],
          }],
        });
      })).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithImageBytes()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    expect(loader.bitmapRequests).toHaveLength(1);

    loader.bitmapRequests[0]?.resolve({ height: 1, width: 1 } as ImageBitmap);
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(uniform1iPayloads(calls, "u_useTexture")).toContain(1);
    expect(bufferDataPayloads(calls).map(roundVector)).toContainEqual([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]);
  });

  it("loads required EXT_texture_webp base-color texture sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/webp"]);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "webp-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["EXT_texture_webp"],
        extensionsUsed: ["EXT_texture_webp"],
        images: [{ uri: triangleWebpImageUri }],
        textures: [{ extensions: { EXT_texture_webp: { source: 0 } }, sampler: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("uses core JPEG sources when optional EXT_texture_webp is not canvas-supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/jpeg"]);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-webp-unsupported" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["EXT_texture_webp"],
        images: [
          { mimeType: "image/jpeg", uri: triangleJpegImageUri },
          { mimeType: "image/webp", uri: triangleWebpImageUri },
        ],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleJpegImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("uses optional EXT_texture_webp sources when canvas-supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installCanvasImageMimeTypeSupport(["image/jpeg", "image/webp"]);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-webp-supported" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["EXT_texture_webp"],
        images: [
          { mimeType: "image/jpeg", uri: triangleJpegImageUri },
          { mimeType: "image/webp", uri: triangleWebpImageUri },
        ],
        textures: [{ extensions: { EXT_texture_webp: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleWebpImageUri}`))).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleJpegImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("loads GS_texture_svg base-color texture sources through automatic image upload", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.instances[0]?.src.startsWith("blob:")).toBe(true);
    expect(await loader.objectUrlBlobs[0]?.text()).toContain("width=\"1024\"");
    expect(await loader.objectUrlBlobs[0]?.text()).toContain("height=\"1024\"");
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => calls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_2D),
    );

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
    expect(calls.some((call) => call.name === "generateMipmap" && call.args[0] === gl.TEXTURE_2D)).toBe(true);
  });

  it("uses opted-in generated VT for plain glTF .svg image sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const { contexts } = installCanvas2d();
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedImageVirtualTextures: true });
    const renderGraph = renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "plain-svg-texture-auto-vt" }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        images: [
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances[0]?.src).toBe("blob:royal-test-1");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    root.render(renderGraph);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);
    expect(loader.fetchRequests.some((request) => request.url.includes("svg-uri:"))).toBe(false);

    for (
      let frame = 0;
      frame < 8
      && root.snapshot().virtualTexturing.shaderBinds === 0;
      frame += 1
    ) {
      await flushMicrotasks();
      root.render(renderGraph);
      await flushAnimationFrames(viewport.animationFrames);
    }

    expect(loader.objectUrlBlobs).toHaveLength(1);
    expect(contexts.length).toBeGreaterThan(0);
    expect(contexts.every((context) => context.createPattern.mock.calls.some((call) => (
      call[0] === ControlledImage.instances[0] && call[1] === "repeat"
    )))).toBe(true);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      generatedManifestUses: 1,
      generatedPageFailures: 0,
      generatedPagesTarget: 341,
      manifestsReady: 1,
    }));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("sizes generated GS_texture_svg VT residency for the source mip pyramid", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { generatedImageVirtualTextures: true });
    const tigerSizedSvgTexture = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1024 1024\" width=\"1024\" height=\"1024\">",
      "<rect x=\"0\" y=\"0\" width=\"1024\" height=\"1024\" fill=\"#c7b084\"/>",
      "<path d=\"M128 128h768v768H128z\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-generated-vt-budget" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, tigerSizedSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.fetchRequests.some((request) => request.url.includes(".vt.json"))).toBe(false);

    expect(
      calls.some((call) =>
        call.name === "texImage2D"
        && call.args[0] === gl.TEXTURE_2D
        && call.args[3] === 2064
        && call.args[4] === 2064),
      "a 1024px SVG at default 4x density should use its bounded 64-slot 8x8 bordered atlas",
    ).toBe(true);
  });

  it("preserves URI SVG asset base while normalizing viewBox-only SVG textures", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const wrapperSvgTexture = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 210 287\" width=\"1024\" height=\"1024\">",
      "<script>globalThis.__royalUnsafeSvgScript = true</script>",
      "<rect x=\"0\" y=\"0\" width=\"210\" height=\"287\" fill=\"#c7b084\" onload=\"globalThis.__royalUnsafeSvgOnload = true\"/>",
      "<a href=\"javascript:globalThis.__royalUnsafeSvgHref = true\"><text x=\"0\" y=\"0\">unsafe</text></a>",
      "<image href=\"ghostscript-tiger.svg\" x=\"10\" y=\"10\" width=\"190\" height=\"267\" preserveAspectRatio=\"xMidYMid meet\"/>",
      "</svg>",
    ].join("");
    const nestedTigerSvg = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 10 10\">",
      "<path d=\"M1 1h8v8H1z\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "svg-texture-relative-image-reference" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, wrapperSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/ghostscript-tiger\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, nestedTigerSvg, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.objectUrlBlobs).toHaveLength(1);
    const normalizedSvg = await loader.objectUrlBlobs[0]?.text();
    expect(normalizedSvg).toContain("width=\"1024\"");
    expect(normalizedSvg).toContain("height=\"1024\"");
    expect(normalizedSvg).toContain("xml:base=\"https://example.test/fixtures/staged-triangle.svg\"");
    expect(normalizedSvg).toContain("x=\"10\"");
    expect(normalizedSvg).toContain("width=\"190\"");
    expect(normalizedSvg).toContain("preserveAspectRatio=\"xMidYMid meet\"");
    expect(normalizedSvg).toContain("href=\"data:image/svg+xml;base64,");
    expect(normalizedSvg).not.toContain("<script");
    expect(normalizedSvg).not.toContain("onload=");
    expect(normalizedSvg).not.toContain("javascript:");
    expect(normalizedSvg).not.toContain("d=\"M1 1h8v8H1z\"");
    expect(normalizedSvg).not.toContain("href=\"ghostscript-tiger.svg\"");
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(root.snapshot().diagnostics).toEqual([]);
  });

  it("prefers optional GS_texture_svg sources over core raster fallbacks when supported", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "optional-svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          { mimeType: "image/svg+xml", uri: triangleSvgImageUri },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(loader.resolvePendingFetch(/staged-triangle\.svg(?:$|[?#])/, (url) =>
      responseWithText(url, triangleSvgTexture, "image/svg+xml"))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances).toHaveLength(1);
    expect(ControlledImage.instances[0]?.src.startsWith("blob:")).toBe(true);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(callCount(calls, "texImage2D")).toBe(1);
  });

  it("rejects GS_texture_svg images without a finite viewBox or width and height", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "dimensionless-svg-texture" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["GS_texture_svg"],
        images: [
          { mimeType: "image/png", uri: triangleImageUri },
          {
            mimeType: "image/svg+xml",
            uri: "data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3C%2Fsvg%3E",
          },
        ],
        textures: [{ extensions: { GS_texture_svg: { source: 1 } }, sampler: 0, source: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(root.snapshot().diagnostics).toContainEqual(expect.stringMatching(
      /GS_texture_svg .*requires a finite viewBox or finite width and height/i,
    ));
    expect(ControlledImage.instances).toHaveLength(0);
  });

  it("loads required KHR_texture_basisu base-color texture URI sources through sRGB upload", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const basisuBytes = Uint8Array.from([0xAB, 0x4B, 0x54, 0x58]);
    const decodedPixels = Uint8Array.from([255, 0, 0, 255, 0, 255, 0, 255]);
    decodeBasisuMock.mockResolvedValue({
      data: decodedPixels,
      height: 1,
      kind: "rgba-texture",
      width: 2,
    });

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "basisu-texture-uri" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_basisu"],
        extensionsUsed: ["KHR_texture_basisu"],
        images: [{ mimeType: "image/ktx2", uri: triangleBasisuImageUri }],
        textures: [{ extensions: { KHR_texture_basisu: { source: 0 } }, sampler: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    expect(loader.resolvePendingFetch(/staged-triangle\.ktx2(?:$|[?#])/, (url) =>
      responseWithBuffer(url, basisuBytes.buffer.slice(0)))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(Array.from(new Uint8Array(decodeBasisuMock.mock.calls[0]?.[0] as ArrayBuffer))).toEqual(Array.from(basisuBytes));
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 2, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedPixels],
      name: "texImage2D",
    });
  });

  it("loads required KHR_texture_basisu base-color texture bufferView sources", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const decodedPixels = Uint8Array.from([0, 0, 255, 255]);
    decodeBasisuMock.mockResolvedValue({
      data: decodedPixels,
      height: 1,
      kind: "rgba-texture",
      width: 1,
    });

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "basisu-texture-buffer-view" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        bufferViews: [
          ...(triangleDocument().bufferViews),
          { buffer: 0, byteLength: 4, byteOffset: triangleBinByteLength },
        ],
        buffers: [{ byteLength: triangleBinByteLength + 4, uri: triangleBinUri }],
        extensionsRequired: ["KHR_texture_basisu"],
        extensionsUsed: ["KHR_texture_basisu"],
        images: [{ bufferView: 4, mimeType: "image/ktx2" }],
        textures: [{ extensions: { KHR_texture_basisu: { source: 0 } }, sampler: 0 }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleWithBasisuBytes()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);
    await flushAnimationFrames(viewport.animationFrames);

    expect(Array.from(new Uint8Array(decodeBasisuMock.mock.calls[0]?.[0] as ArrayBuffer)))
      .toEqual([0xAB, 0x4B, 0x54, 0x58]);
    expect(ControlledImage.instances.some((image) => image.src.endsWith(`/${triangleImageUri}`))).toBe(false);
    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls).toContainEqual({
      args: [gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, decodedPixels],
      name: "texImage2D",
    });
  });

  it("renders required KHR_materials_unlit glTF materials without lighting", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({ src: triangleGltfSrc, version: "unlit-material" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_materials_unlit"],
        extensionsUsed: ["KHR_materials_unlit"],
        images: [],
        materials: [
          {
            extensions: { KHR_materials_unlit: {} },
            pbrMetallicRoughness: { baseColorFactor: [0.25, 0.5, 0.75, 1] },
          },
        ],
        samplers: [],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([0.25, 0.5, 0.75, 1]);
    expect(calls.some((call) => call.name === "uniform1i" && uniformLocationName(call.args[0]) === "u_unlit" && call.args[1] === 1))
      .toBe(true);
  });

  it("hides required KHR_node_visibility node hierarchies", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "node-visibility" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_node_visibility"],
        extensionsUsed: ["KHR_node_visibility"],
        images: [],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        nodes: [
          {
            children: [1],
            extensions: { KHR_node_visibility: { visible: false } },
          },
          { mesh: 0 },
        ],
        samplers: [],
        scenes: [{ nodes: [0] }],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls)).toHaveLength(0);
  });

  it("renders glTF line primitives with line draw mode", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "line-primitive" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        accessors: [{ bufferView: 0, componentType: 5126, count: 2, type: "VEC3" }],
        asset: { version: "2.0" },
        bufferViews: [{ buffer: 0, byteLength: 24, byteOffset: 0 }],
        buffers: [{ byteLength: 24, uri: triangleBinUri }],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 1 }] }],
        nodes: [{ mesh: 0 }],
        scene: 0,
        scenes: [{ nodes: [0] }],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, lineBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.LINES && drawCount(call) === 2)).toBe(true);
  });

  it("renders all core glTF primitive modes", async () => {
    const primitiveModes = [
      { drawMode: (gl: WebGL2RenderingContext) => gl.POINTS, mode: 0, version: "points" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.LINE_LOOP, mode: 2, version: "line-loop" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.LINE_STRIP, mode: 3, version: "line-strip" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.TRIANGLE_STRIP, mode: 5, version: "triangle-strip" },
      { drawMode: (gl: WebGL2RenderingContext) => gl.TRIANGLE_FAN, mode: 6, version: "triangle-fan" },
    ] as const;

    for (const { drawMode, mode, version } of primitiveModes) {
      vi.stubGlobal("devicePixelRatio", 1);
      const viewport = installViewportInvalidationStubs();
      const loader = installStagedGltfLoader();
      const { calls, gl } = fakeGl();
      const root = createWebGlRoot(fakeCanvas(gl));

      root.render(renderScene([
        directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
        gltf({ src: triangleGltfSrc, version: `core-primitive-${version}` }),
      ]));
      expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
        responseWithJson(url, {
          ...triangleDocument(),
          images: [],
          materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 3, material: 0, mode }] }],
          samplers: [],
          textures: [],
        }))).toBe(true);
      await flushMicrotasks();
      expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
        responseWithBuffer(url, triangleBin()))).toBe(true);
      await flushMicrotasks();
      await flushAnimationFrames(viewport.animationFrames);

      expect(drawCalls(calls).some((call) => call.args[0] === drawMode(gl) && drawCount(call) === 3)).toBe(true);
      expect(root.snapshot().diagnostics.some((message) => /unsupported primitive mode/i.test(message))).toBe(false);
      root.dispose();
      vi.unstubAllGlobals();
    }
  });

  it("skips invalid glTF primitive modes with a diagnostic", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      directionalLight({ color: [1, 1, 1, 1], direction: [0, 0, -1] }),
      gltf({ src: triangleGltfSrc, version: "invalid-primitive-mode" }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        images: [],
        materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0, mode: 99 }] }],
        samplers: [],
        textures: [],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls)).toHaveLength(0);
    expect(root.snapshot().diagnostics.some((message) => /unsupported primitive mode 99/i.test(message))).toBe(true);
  });

  it("ignores unsupported optional glTF extensions when core fallback data is present", async () => {
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
        version: "optional-extension-fallback",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsUsed: ["VENDOR_future_material_extension"],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "optional unsupported extension should fall back to core glTF data",
    ).toBe(true);
  });

  it("renders required KHR material anisotropy and diffuse transmission factors", async () => {
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
        version: "required-anisotropy-extension",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...solidTriangleDocument(),
        extensionsRequired: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        extensionsUsed: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        materials: [
          {
            extensions: {
              KHR_materials_anisotropy: {
                anisotropyRotation: 1.125,
                anisotropyStrength: 0.65,
              },
              KHR_materials_diffuse_transmission: {
                diffuseTransmissionColorFactor: [0.25, 0.5, 0.75],
                diffuseTransmissionFactor: 0.4,
              },
            },
            pbrMetallicRoughness: {
              baseColorFactor: [0.8, 0.62, 0.36, 1],
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(uniform4fvPayloads(readyFrameCalls, "u_anisotropyFactors").map(roundVector))
      .toContainEqual([0.65, 1.125, 0, 0]);
    expect(uniform4fvPayloads(readyFrameCalls, "u_diffuseTransmissionFactors").map(roundVector))
      .toContainEqual([0.25, 0.5, 0.75, 0.4]);
    expect(sources).toContain("uniform vec4 u_anisotropyFactors;");
    expect(sources).toContain("uniform vec4 u_diffuseTransmissionFactors;");
    expect(sources).toContain("materialAnisotropicGgxDistribution");
    expect(sources).toContain("diffuseTransmissionFactor = clamp(u_diffuseTransmissionFactors.a");
    expect(root.snapshot().diagnostics.some((message) =>
      /unsupported required glTF extension.*KHR_materials_anisotropy/i.test(message))).toBe(false);
  });

  it("diagnoses optional KHR material extension textures while using scalar factors", async () => {
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
        version: "optional-anisotropy-texture",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...solidTriangleDocument(),
        extensionsUsed: ["KHR_materials_anisotropy", "KHR_materials_diffuse_transmission"],
        materials: [
          {
            extensions: {
              KHR_materials_anisotropy: {
                anisotropyRotation: 0.25,
                anisotropyStrength: 0.5,
                anisotropyTexture: { index: 0 },
              },
              KHR_materials_diffuse_transmission: {
                diffuseTransmissionColorFactor: [0.4, 0.5, 0.6],
                diffuseTransmissionColorTexture: { index: 2 },
                diffuseTransmissionFactor: 0.35,
                diffuseTransmissionTexture: { index: 1 },
              },
            },
            pbrMetallicRoughness: {
              baseColorFactor: [0.8, 0.62, 0.36, 1],
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(
      drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3),
      "optional anisotropy texture should leave the scalar-factor material drawable",
    ).toBe(true);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_anisotropy\.anisotropyTexture.*factor and rotation.*textures are not yet supported/i);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_diffuse_transmission\.diffuseTransmissionTexture.*factor and color factor.*textures are not yet supported/i);
    expect(root.snapshot().diagnostics.join("\n"))
      .toMatch(/KHR_materials_diffuse_transmission\.diffuseTransmissionColorTexture.*factor and color factor.*textures are not yet supported/i);
  });

  it("multiplies glTF COLOR_0 vertex colors into base color", async () => {
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
        version: "core-color-0",
      }),
    ]);

    root.render(renderGraph);
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, vertexColorTriangleDocument()))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, vertexColorTriangleBin()))).toBe(true);
    await flushMicrotasks();

    const callsBeforeReadyRender = calls.length;
    root.render(renderGraph);
    const readyFrameCalls = calls.slice(callsBeforeReadyRender);
    const sources = shaderSources(readyFrameCalls).join("\n");

    expect(drawCalls(readyFrameCalls)).toHaveLength(1);
    expect(bufferDataPayloads(readyFrameCalls).map(roundVector)).toContainEqual([
      1, 0, 0, 1,
      0, 0.501961, 0, 1,
      0, 0, 1, 1,
    ]);
    expect(readyFrameCalls.some((call) => call.name === "getAttribLocation")).toBe(false);
    expect(readyFrameCalls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 12
      && call.args[1] === 4
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(sources).toContain("in vec4 a_color;");
    expect(sources).toContain("* v_color");
  });

  it("binds glTF normals and texcoords, applies node transform, and uses the pass light", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const lightDirection = [0.25, -0.5, -1] as const;
    const renderGraph = renderScene([
      directionalLight({
        color: [0.8, 0.9, 1, 1],
        direction: lightDirection,
      }),
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [0.2, 0, 0],
          rotation: [0, 0, 0],
          scale: [2, 1, 1],
        },
        version: "staged-shading",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(calls.some((call) => call.name === "getAttribLocation")).toBe(false);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 1
      && call.args[1] === 3
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(calls.some((call) =>
      call.name === "vertexAttribPointer"
      && call.args[0] === 10
      && call.args[1] === 2
      && call.args[2] === gl.FLOAT)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_surfaceLightDirection[0]").map(roundVector)).toContainEqual([
      ...roundVector(lightDirection),
      0,
    ]);
    expect(matrixUniformPayloads(calls).map(roundVector)).toContainEqual(roundVector([
      2, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0.2, 0, 0, 1,
    ]));
  });

  it("uploads glTF base-color textures with glTF sampler defaults and image orientation", async () => {
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
        version: "staged-gltf-sampler",
      }),
    ]);

    root.render(renderGraph);
    await settleDocumentAndBuffer(loader);
    await flushAnimationFrames(viewport.animationFrames);
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(texturePixelStoreCalls(calls)).toContainEqual({
      args: [gl.UNPACK_FLIP_Y_WEBGL, false],
      name: "pixelStorei",
    });
    expect(textureParameterCalls(calls)).toContainEqual({
      args: [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT],
      name: "texParameteri",
    });
    expect(textureParameterCalls(calls)).toContainEqual({
      args: [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT],
      name: "texParameteri",
    });
  });

  it("selects one node-level MSFT_lod member from screen coverage and suppresses lower roots", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "node-lod",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const highDraws = drawCalls(calls);
    expect(highDraws.at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(drawCount(highDraws.at(-1)!), "high coverage should select the six-index LOD0 quad").toBe(6);

    const drawsBeforeLow = drawCalls(calls).length;
    root.render(renderGraph(0.2));

    const lowDraws = drawCalls(calls).slice(drawsBeforeLow);
    expect(lowDraws, "only one node in the LOD chain should draw per render").toHaveLength(1);
    expect(drawCount(lowDraws[0]!), "low coverage should select the referenced three-index LOD1 triangle").toBe(3);
  });

  it("selects and hysteretically retains LOD0 when bounds cross the perspective near plane", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const externalClock = root.acquireExternalRenderClock();
    const renderGraph = (z: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, z],
          rotation: [0, Math.PI / 4, 0],
          scale: [1, 1.2, 1],
        },
        version: "node-lod-near-plane",
      }),
    ]);
    const projectionMatrix = projectionMat4(perspectiveCamera({
      far: 20,
      fovY: Math.PI / 2,
      near: 1,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
    }), 100, 100);
    const renderNearView = (z: number): readonly number[] => {
      const callsBefore = calls.length;
      root.renderViews(renderGraph(z), {
        views: [{
          projectionMatrix,
          viewMatrix: identityMat4(),
          viewport: { height: 100, width: 100, x: 0, y: 0 },
        }],
      });
      return drawCalls(calls.slice(callsBefore)).map(drawCount);
    };

    try {
      root.render(renderGraph(-1.2));
      await settleLodDocumentAndBuffer(loader, nodeLodDocument());

      expect(renderNearView(-1.2), "clipped near-plane footprint exceeds the LOD0 threshold")
        .toEqual([6]);
      expect(renderNearView(-1.15), "small near-plane motion remains inside LOD0 hysteresis")
        .toEqual([6]);
      expect(renderNearView(-1.22), "return motion does not oscillate the selected LOD")
        .toEqual([6]);
    } finally {
      externalClock.release();
    }
  });

  it("draws a large visible lower node LOD on its first frame when LOD0 is outside every view", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "node-lod-visible-fallback" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodSeparatedBoundsDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const readyDraws = drawCalls(calls);
    expect(readyDraws, "a visible lower LOD must prevent first-frame blanking").not.toHaveLength(0);
    expect(drawCount(readyDraws.at(-1)!)).toBe(3);
  });

  it("shares the highest visible node LOD coverage across stereo views independent of view order", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "node-lod-stereo" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    for (const reverse of [false, true]) {
      const callsBeforeViews = calls.length;
      root.renderViews(renderGraph, { views: lodStereoViews(reverse) });
      const draws = drawCalls(calls.slice(callsBeforeViews));
      expect(draws, `both stereo views should draw in ${reverse ? "reverse" : "forward"} order`)
        .toHaveLength(2);
      expect(draws.map(drawCount), "the higher-coverage eye should select LOD0 for both eyes")
        .toEqual([6, 6]);
    }
  });

  it("preserves the prior shared node LOD while its group is invisible in every view", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const highScale = lodScaleForCoverage(0.205);
    const renderGraph = renderScene([
      gltf({
        ref,
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [highScale, highScale, 1],
        },
        version: "node-lod-invisible-retention",
      }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);
    expect(drawCount(drawCalls(calls).at(-1)!)).toBe(6);

    if (ref.current === null) throw new Error("Expected glTF render-object ref to be attached");
    ref.current.position.x = 10;
    const callsBeforeInvisible = calls.length;
    root.renderViews(renderGraph, { views: lodStereoViews() });
    expect(drawCalls(calls.slice(callsBeforeInvisible))).toHaveLength(0);

    const returnScale = lodScaleForCoverage(0.198);
    ref.current.position.x = 0;
    ref.current.scale.x = returnScale;
    ref.current.scale.y = returnScale;
    const callsBeforeReturn = calls.length;
    root.render(renderGraph);
    const returnedDraws = drawCalls(calls.slice(callsBeforeReturn));
    expect(returnedDraws).toHaveLength(1);
    expect(drawCount(returnedDraws[0]!), "an all-invisible frame must not demote retained LOD0").toBe(6);
  });

  it("selects material-level MSFT_lod variants from screen coverage", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const high = fakeGl();
    const highRoot = createWebGlRoot(fakeCanvas(high.gl));
    const low = fakeGl();
    const lowRoot = createWebGlRoot(fakeCanvas(low.gl));
    const renderGraph = (version: string, scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version,
      }),
    ]);

    highRoot.render(renderGraph("material-lod-high", 1));
    await settleLodDocumentAndBuffer(loader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const highColors = uniform4fvPayloads(high.calls, "u_color").map(roundVector);
    expect(highColors).toContainEqual([1, 0, 0, 1]);

    const lowLoader = installStagedGltfLoader();
    lowRoot.render(renderGraph("material-lod-low", 0.2));
    await settleLodDocumentAndBuffer(lowLoader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const lowColors = uniform4fvPayloads(low.calls, "u_color").map(roundVector);
    expect(lowColors).toContainEqual([0, 0, 1, 1]);
  });

  it("shares material LOD selection across stereo views independent of view order", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = renderScene([
      gltf({ src: lodGltfSrc, version: "material-lod-stereo" }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, materialLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    for (const reverse of [false, true]) {
      const callsBeforeViews = calls.length;
      root.renderViews(renderGraph, { views: lodStereoViews(reverse) });
      const viewCalls = calls.slice(callsBeforeViews);
      expect(drawCalls(viewCalls)).toHaveLength(2);
      expect(
        uniform4fvPayloads(viewCalls, "u_color").map(roundVector),
        "a lower-coverage eye must not mutate the finalized shared material LOD",
      ).not.toContainEqual([0, 0, 1, 1]);
    }
  });

  it("uses selected material LOD texture transforms for glTF texcoords", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene([
      gltf({
        src: triangleGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.2, 0.2, 1],
        },
        version: "material-lod-texture-transform",
      }),
    ]));
    expect(loader.resolvePendingFetch(/staged-triangle\.gltf(?:$|[?#])/, (url) =>
      responseWithJson(url, {
        ...triangleDocument(),
        extensionsRequired: ["KHR_texture_transform"],
        extensionsUsed: ["KHR_texture_transform", "MSFT_lod"],
        materials: [
          {
            extensions: { MSFT_lod: { ids: [1] } },
            extras: { MSFT_screencoverage: [0.2, 0] },
            pbrMetallicRoughness: {
              baseColorTexture: { index: 0 },
            },
          },
          {
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
            },
          },
        ],
      }))).toBe(true);
    await flushMicrotasks();
    expect(loader.resolvePendingFetch(/staged-triangle\.bin(?:$|[?#])/, (url) =>
      responseWithBuffer(url, triangleBin()))).toBe(true);
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).some((call) => call.args[0] === gl.TRIANGLES && drawCount(call) === 3)).toBe(true);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow0").map(roundVector))
      .toContainEqual([0.5, 0, 0.25, 0]);
    expect(uniform4fvPayloads(calls, "u_baseColorUvRow1").map(roundVector))
      .toContainEqual([0, 0.25, 0.5, 0]);
  });

  it("keeps node-level MSFT_lod selection stable inside a threshold hysteresis band", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const initialScale = lodScaleForCoverage(0.205);
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const graph = renderScene([
      gltf({
        src: lodGltfSrc,
        ref,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [initialScale, initialScale, 1],
        },
        version: "node-lod-hysteresis",
      }),
    ]);
    const renderGraph = (coverage: number) => {
      const value = lodScaleForCoverage(coverage);
      if (ref.current !== null) {
        ref.current.scale.x = value;
        ref.current.scale.y = value;
      }
      return graph;
    };
    const renderSelectedCount = (coverage: number): number => {
      const drawsBeforeRender = drawCalls(calls).length;
      root.render(renderGraph(coverage));
      const draws = drawCalls(calls).slice(drawsBeforeRender);
      expect(draws, `coverage ${coverage} should draw exactly one LOD member`).toHaveLength(1);

      return drawCount(draws[0]!);
    };

    root.render(renderGraph(0.205));
    await settleLodDocumentAndBuffer(loader, nodeLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    const firstDraw = drawCalls(calls).at(-1);
    expect(firstDraw, "initial high-coverage frame should draw").toBeDefined();
    expect(firstDraw?.args[0]).toBe(gl.TRIANGLES);

    const selectedCounts = [
      drawCount(firstDraw!),
      renderSelectedCount(0.198),
      renderSelectedCount(0.14),
      renderSelectedCount(0.202),
    ];

    expect(
      selectedCounts,
      "selection should not flap for small coverage jitter around the 0.2 threshold",
    ).toEqual([6, 6, 3, 3]);
  });

  it("draws selected material LOD fallback before binding its settled base-color texture", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-pending-texture",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([1, 0, 0, 1]);
    expect(ControlledImage.instances, "unselected lower LOD texture should remain dormant").toHaveLength(0);

    const pendingCallsStart = calls.length;
    root.render(renderGraph(0.2));
    const pendingCalls = calls.slice(pendingCallsStart);
    expect(ControlledImage.instances, "selected lower LOD texture should begin decoding").toHaveLength(1);
    expect(drawCalls(pendingCalls), "pending lower texture LOD should not blank the glTF").toHaveLength(1);
    expect(
      callCount(pendingCalls, "texImage2D"),
      "selecting a pending lower material must not upload its ordinary texture during draw",
    ).toBe(0);
    expect(
      callCount(pendingCalls, "generateMipmap"),
      "selecting a pending lower material must not generate mipmaps during draw",
    ).toBe(0);
    expect(
      uniform4fvPayloads(calls, "u_color").map(roundVector).at(-1),
      "renderer should draw the selected lower material with its solid fallback",
    ).toEqual([0.5, 0.5, 0.5, 1]);

    const settledCallsStart = calls.length;
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    await waitForUniform1iPayload(viewport.animationFrames, calls, "u_useTexture", 1);

    const settledCalls = calls.slice(settledCallsStart);
    const uploadIndex = settledCalls.findIndex((call) => call.name === "texImage2D");
    const drawIndex = settledCalls.findIndex((call) => drawCalls([call]).length === 1);
    expect(uploadIndex, "settled decoded glTF image should upload through the texture cache").toBeGreaterThanOrEqual(0);
    expect(drawIndex, "settled lower material should draw on the invalidated frame").toBeGreaterThan(uploadIndex);
    expect(uniform1iPayloads(settledCalls, "u_useTexture").at(-1)).toBe(1);
  });

  it("draws the selected material LOD while secondary texture slots are pending", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      directionalLight({
        color: [1, 1, 1, 1],
        direction: [0, 0, -1],
      }),
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-secondary-textures-pending",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialSecondaryTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(uniform4fvPayloads(calls, "u_color").map(roundVector)).toContainEqual([1, 0, 0, 1]);
    expect(ControlledImage.instances, "unselected secondary material textures should remain dormant").toHaveLength(0);

    const pendingCallsStart = calls.length;
    root.render(renderGraph(0.2));
    const pendingCalls = calls.slice(pendingCallsStart);
    expect(ControlledImage.instances, "selected secondary material textures should begin decoding").toHaveLength(1);

    expect(drawCalls(pendingCalls), "pending normal/ORM/emissive/extension textures should not block the LOD").toHaveLength(1);
    expect(uniform4fvPayloads(pendingCalls, "u_color").map(roundVector)).toContainEqual([0, 1, 0, 1]);
    expect(uniform1iPayloads(pendingCalls, "u_useMetallicRoughnessTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useNormalTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useEmissiveTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useOcclusionTexture")).not.toContain(1);
    expect(uniform1iPayloads(pendingCalls, "u_useSpecularTexture")).not.toContain(1);
  });

  it("budgets settled glTF ordinary texture uploads across animation frames", async () => {
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
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0.2, 0.2, 1],
        },
        version: "ordinary-texture-upload-budget",
      }),
    ]);

    root.render(renderGraph);
    await settleLodDocumentAndBuffer(loader, materialSecondaryTexturePendingLodDocument());
    await flushAnimationFrames(viewport.animationFrames);

    expect(ControlledImage.instances, "secondary material textures should share one staged image").toHaveLength(1);
    expect(callCount(calls, "texImage2D")).toBe(0);

    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    const uploadsBeforeFrames = callCount(calls, "texImage2D");
    const mipmapsBeforeFrames = callCount(calls, "generateMipmap");
    await flushAnimationFrames(viewport.animationFrames);
    expect(callCount(calls, "texImage2D") - uploadsBeforeFrames).toBe(1);
    expect(callCount(calls, "generateMipmap") - mipmapsBeforeFrames).toBe(1);

    await flushAnimationFrames(viewport.animationFrames);
    expect(callCount(calls, "texImage2D") - uploadsBeforeFrames).toBe(2);
    expect(callCount(calls, "generateMipmap") - mipmapsBeforeFrames).toBe(2);

    await waitForAnimationFrameWork(
      viewport.animationFrames,
      () => uniform1iPayloads(calls, "u_useSpecularTexture").includes(1)
        && uniform1iPayloads(calls, "u_useEmissiveTexture").includes(1),
    );
    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
  });

  it("uploads a shared glTF texture once across material MSFT_lod levels", async () => {
    vi.stubGlobal("devicePixelRatio", 1);
    const viewport = installViewportInvalidationStubs();
    const loader = installStagedGltfLoader();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const renderGraph = (scale: number) => renderScene([
      gltf({
        src: lodGltfSrc,
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [scale, scale, 1],
        },
        version: "material-lod-shared-texture",
      }),
    ]);

    root.render(renderGraph(1));
    await settleLodDocumentAndBuffer(loader, materialSharedTextureLodDocument());
    await flushAnimationFrames(viewport.animationFrames);
    expect(ControlledImage.instances, "shared LOD texture should be loaded once by URI").toHaveLength(1);

    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();
    await flushAnimationFrames(viewport.animationFrames);

    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(callCount(calls, "texImage2D"), "high LOD should upload the shared glTF texture once").toBe(1);

    root.render(renderGraph(0.2));

    expect(drawCalls(calls).at(-1)?.args[0]).toBe(gl.TRIANGLES);
    expect(
      callCount(calls, "texImage2D"),
      "switching to a lower material LOD that references the same texture index must reuse the upload",
    ).toBe(1);
  });
});

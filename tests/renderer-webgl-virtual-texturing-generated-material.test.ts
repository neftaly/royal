import { describe, expect, it, vi } from "vitest";
import {
  imageTexture,
  standardMaterial,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import {
  VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS,
  VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME,
} from "../packages/renderer-webgl/src/virtual-texture/runtime";
import {
  createWebGlRoot,
  fakeCanvas,
  fakeGl,
  ControlledImage,
  installFetchQueue,
  installCanvas2d,
  responseJson,
  responseText,
  renderScene,
  vtManifest,
  vtSinglePageManifest,
  flushMicrotasks,
  waitForModuleLoad,
  textureAllocations,
  textureDataUploads,
  textureResourceBinds,
  texParameterTriples,
  texParameterGroups,
  uniformNames,
  namedUniform1iValues,
  namedUniform4fvValues,
} from "./renderer-webgl-virtual-texturing-fixtures";

describe("WebGL renderer generated and material virtual texturing", () => {
  it("uses the opted-in generated raster VT policy without manifest requests", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 512;
    ControlledImage.instances[0]!.naturalHeight = 512;
    ControlledImage.instances[0]!.naturalWidth = 512;
    ControlledImage.instances[0]!.width = 512;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      automaticManifestUses: 1,
      automaticPagesTarget: 5,
      automaticSourceBytes: 512 * 512 * 4,
    }));
    expect(root.snapshot().virtualTexturing.pageLoadRequests).toBeGreaterThan(0);
    expect(namedUniform1iValues(calls)).toEqual(expect.objectContaining({
      u_texture: expect.arrayContaining([0]),
      u_useTexture: expect.arrayContaining([1]),
    }));
    expect(contexts[0]?.createPattern).toHaveBeenCalledWith(
      ControlledImage.instances[0],
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

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      await flushMicrotasks();
      root.render(renderScene(material));
    }

    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      pageLoadFailures: 0,
      automaticPagesTarget: 5,
      manifestFailures: 0,
      manifestRequests: 0,
      manifestsReady: 1,
      cachedPages: expect.any(Number),
      uploadedPages: expect.any(Number),
    }));
    expect(root.snapshot().virtualTexturing.pageLoadRequests).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.cachedPages).toBeGreaterThanOrEqual(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing.uploadedPageBytes).toBeGreaterThanOrEqual(258 * 258 * 4);
    expect(root.snapshot().virtualTexturing.uploadedPages).toBeGreaterThanOrEqual(1);
    expect(canvases[0]).toEqual(expect.objectContaining({ height: 258, width: 258 }));
    expect(uniformNames(calls)).toEqual(expect.arrayContaining(["u_vtAtlas", "u_vtPageTable"]));
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses the generic automatic VT page path for direct SVG textures", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    const { contexts } = installCanvas2d();
    const { calls, gl } = fakeGl();
    const canvas = fakeCanvas(gl);
    const root = createWebGlRoot(canvas, { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/plain.svg") });
    const svgText = [
      "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" onload=\"alert(1)\">",
      "<script>alert(1)</script>",
      "<image href=\"javascript:alert(1)\" width=\"1\" height=\"1\"/>",
      "<rect width=\"512\" height=\"512\" fill=\"#f60\"/>",
      "</svg>",
    ].join("");

    root.render(renderScene(material));
    await waitForModuleLoad(() => fetchRequests.some((request) => (
      request.url === "/textures/plain.svg"
    )));
    expect(fetchRequests.some((request) => request.url === "/textures/plain.svg")).toBe(true);
    fetchRequests.find((request) => request.url === "/textures/plain.svg")!
      .resolve(responseText("/textures/plain.svg", svgText));
    await flushMicrotasks();

    expect(objectUrlBlobs).toHaveLength(1);
    const normalizedSvgText = await objectUrlBlobs[0]!.text();
    expect(normalizedSvgText).toContain("<script");
    expect(normalizedSvgText).toContain("onload=");
    expect(normalizedSvgText).toContain("javascript:");
    expect(ControlledImage.instances[0]?.src).toBe("blob:royal-svg-texture-1");
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));
    expect(fetchRequests.map((request) => request.url)).toEqual(["/textures/plain.svg"]);

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      for (const image of ControlledImage.instances.slice(1)) {
        if (!image.complete) image.settleLoad();
      }
      await flushMicrotasks();
      root.render(renderScene(material));
      await flushMicrotasks();
    }
    expect(contexts.length).toBeGreaterThan(0);

    expect(objectUrlBlobs.length).toBeGreaterThan(1);
    const pageSvgText = await objectUrlBlobs[1]!.text();
    expect(pageSvgText).toContain('width="258" height="258"');
    expect(pageSvgText).toContain('width="16384" height="16384"');
    const pageObjectUrlCount = objectUrlBlobs.length;

    canvas.dispatchContextEvent("webglcontextlost");
    await flushMicrotasks();
    expect(root.snapshot().virtualTexturing.pageLoadFailures).toBe(0);
    canvas.dispatchContextEvent("webglcontextrestored");
    root.render(renderScene(material));

    expect(objectUrlBlobs.length).toBeGreaterThanOrEqual(pageObjectUrlCount);
    expect(contexts.every((context) => context.drawImage.mock.calls.some((call) => (
      ControlledImage.instances.slice(1).includes(call[0] as ControlledImage)
    )))).toBe(true);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      automaticManifestUses: 1,
      pageLoadFailures: 0,
      pageLoadRequests: expect.any(Number),
      automaticPagesTarget: 5_461,
      manifestsReady: 1,
    }));
    expect(namedUniform1iValues(calls).u_useTexture).toContain(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it("uses automatic VT for direct SVG data URIs", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const objectUrlBlobs: Blob[] = [];
    let nextObjectUrl = 0;
    class TestURL extends URL {
      static createObjectURL = vi.fn((blob: Blob) => {
        objectUrlBlobs.push(blob);
        return `blob:royal-svg-data-texture-${nextObjectUrl += 1}`;
      });
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    const { contexts } = installCanvas2d();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const svgText = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\"><rect width=\"512\" height=\"512\" fill=\"#0af\"/></svg>";
    const svgUri = `data:image/svg+xml,${encodeURIComponent(svgText)}`;
    const material = unlitMaterial({ texture: imageTexture(svgUri) });

    root.render(renderScene(material));
    await waitForModuleLoad(() => fetchRequests.some((request) => request.url === svgUri));
    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    fetchRequests[0]!.resolve(responseText(svgUri, svgText));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();

    for (let frame = 0; frame < 8 && root.snapshot().virtualTexturing.shaderBinds === 0; frame += 1) {
      root.render(renderScene(material));
      for (const image of ControlledImage.instances.slice(1)) {
        if (!image.complete) image.settleLoad();
      }
      await flushMicrotasks();
    }

    expect(fetchRequests.map((request) => request.url)).toEqual([svgUri]);
    expect(objectUrlBlobs.length).toBeGreaterThan(1);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      automaticManifestUses: 1,
      automaticPagesTarget: 5_461,
      manifestsReady: 1,
    }));
    expect(contexts.length).toBeGreaterThan(0);
    expect(namedUniform1iValues(calls).u_useTexture).toContain(1);
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("does not make automatic SVG VT policy depend on browser identity", async () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 AppleWebKit/605.1.15 Version/17.14 Safari/605.1.15",
    });
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    class TestURL extends URL {
      static createObjectURL = vi.fn(() => "blob:royal-svg-webkit");
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal("URL", TestURL);
    const { contexts } = installCanvas2d();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/webkit.svg") });

    root.render(renderScene(material));
    await waitForModuleLoad(() => fetchRequests.length > 0);
    fetchRequests[0]!.resolve(responseText(
      "/textures/webkit.svg",
      '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512"/></svg>',
    ));
    await flushMicrotasks();
    ControlledImage.instances[0]?.settleLoad();
    await flushMicrotasks();
    for (let frame = 0; frame < 8 && contexts.length === 0; frame += 1) {
      root.render(renderScene(material));
      for (const image of ControlledImage.instances.slice(1)) {
        if (!image.complete) image.settleLoad();
      }
      await flushMicrotasks();
    }

    expect(contexts.length).toBeGreaterThan(0);
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      automaticManifestUses: 1,
      pageLoadFailures: 0,
    }));
    expect(root.snapshot().virtualTexturing.pageLoadRequests).toBeGreaterThan(0);
    expect(namedUniform1iValues(calls).u_useTexture).toContain(1);
  });

  it("bounds large generated VT page preparation work per frame", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const { canvases, contexts } = installCanvas2d();
    installFetchQueue();
    const { gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl), { automaticVirtualTextures: true });
    const material = unlitMaterial({ texture: imageTexture("/textures/large-generated.png") });

    root.render(renderScene(material));
    ControlledImage.instances[0]!.height = 4096;
    ControlledImage.instances[0]!.naturalHeight = 4096;
    ControlledImage.instances[0]!.naturalWidth = 4096;
    ControlledImage.instances[0]!.width = 4096;
    ControlledImage.instances[0]!.settleLoad();
    await flushMicrotasks();

    root.render(renderScene(material));

    const pageLoadRequests = root.snapshot().virtualTexturing.pageLoadRequests;
    expect(pageLoadRequests).toBeGreaterThan(0);
    expect(pageLoadRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_PAGE_REQUESTS_PER_FRAME);
    expect(pageLoadRequests).toBeLessThanOrEqual(VIRTUAL_TEXTURE_MAX_IN_FLIGHT_PAGE_LOADS);
    expect(canvases).toHaveLength(pageLoadRequests);
    expect(contexts).toHaveLength(pageLoadRequests);
    for (const canvas of canvases) {
      expect(canvas).toEqual(expect.objectContaining({ height: 258, width: 258 }));
    }
    for (const context of contexts) {
      expect(context.createPattern).toHaveBeenCalledTimes(1);
      expect(context.createPattern.mock.calls[0]?.[1]).toBe("repeat");
      expect(context.createPattern.mock.results[0]?.value.setTransform).toHaveBeenCalledTimes(1);
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 258, 258);
    }
  });

  it("resolves explicit virtualTexture base color through prepared VT residency without ordinary image loads", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const manifestUrl = "/vt/manifest.json";

    root.render(renderScene(unlitMaterial({ texture: virtualTexture(manifestUrl) })));

    expect(fetchRequests.map((request) => request.url)).toEqual([manifestUrl]);
    expect(ControlledImage.instances).toHaveLength(0);
    expect(textureAllocations(calls)).toEqual([]);
    expect(textureDataUploads(calls)).toEqual([]);
    expect(textureResourceBinds(calls, gl.TEXTURE_2D)).toEqual([]);
    expect([
      ...fetchRequests.map((request) => request.url),
      ...ControlledImage.instances.map((image) => image.src),
    ]).not.toContain("/vt/pages/0-0.png");
    expect(root.snapshot().virtualTexturing).toEqual(expect.objectContaining({
      manifestRequests: 1,
      preparedResidencyResolutions: 1,
    }));

    fetchRequests[0]!.resolve(responseJson(vtManifest()));
    await flushMicrotasks();

    expect(ControlledImage.instances.map((image) => image.src)).toEqual([
      "/vt/pages/1-0.png",
      "/vt/pages/0-0.png",
    ]);
    expect(root.snapshot().virtualTexturing.manifestsReady).toBe(1);
  });

  it("defaults manifest and ref-unspecified VT base color to sRGB", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));
    const material = standardMaterial({
      texture: virtualTexture({ manifestUri: "/vt/manifest.json" }),
    });
    const graph = renderScene(material, { exposureEv100: 1.75, toneMapping: "pbr-neutral" });

    root.render(graph);
    fetchRequests[0]!.resolve(responseJson(vtSinglePageManifest()));
    await flushMicrotasks();
    root.render(graph);
    await flushMicrotasks();
    for (const image of ControlledImage.instances) image.settleLoad();
    await flushMicrotasks();

    root.render(graph);
    const uniform1i = namedUniform1iValues(calls);
    const uniform4fv = namedUniform4fvValues(calls);

    expect(uniformNames(calls)).toEqual(expect.arrayContaining([
      "u_surfaceLightCount",
      "u_toneMappingSettings",
      "u_vtAtlas",
      "u_vtPageTable",
      "u_vtPageTableSize",
      "u_vtAtlasGrid",
      "u_vtAtlasTexelSize",
      "u_vtBorderTexels",
      "u_vtPageSize",
      "u_vtVirtualSize",
    ]));
    expect(uniform1i).toEqual(expect.objectContaining({
      u_surfaceLightCount: expect.arrayContaining([1]),
      u_useTexture: expect.arrayContaining([0]),
      u_useVirtualTexture: expect.arrayContaining([1]),
      u_vtAtlas: expect.arrayContaining([0]),
      u_vtPageTable: expect.arrayContaining([1]),
    }));
    expect(uniform4fv).toEqual(expect.objectContaining({
      u_color: expect.arrayContaining([[1, 1, 1, 1]]),
      u_toneMappingSettings: expect.arrayContaining([[1, 1 / (1.2 * (2 ** 1.75)), 1, 0]]),
    }));
    expect(uniform4fv.u_color?.at(-1)).toEqual([1, 1, 1, 1]);
    expect(textureAllocations(calls).map((call) => call.args.slice(2, 7))).toEqual(expect.arrayContaining([
      [gl.SRGB8_ALPHA8, 6, 6, 0, gl.RGBA],
      [0x8d7c, 1, 1, 0, 0x8d99],
    ]));
    expect(root.snapshot().virtualTexturing.shaderBinds).toBeGreaterThan(0);
  });

  it("uses a mipmapped filter's leading component on the single-level VT atlas", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: {
          magFilter: "nearest",
          minFilter: "linear-mipmap-linear",
          wrapS: "repeat",
          wrapT: "mirrored-repeat",
        },
        manifestUri: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterGroups(calls)[1]).toEqual([
      [gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ]);
    expect(texParameterTriples(calls).filter((triple) =>
      triple[0] === gl.TEXTURE_2D
      && (triple[1] === gl.TEXTURE_WRAP_S || triple[1] === gl.TEXTURE_WRAP_T)
      && triple[2] === gl.CLAMP_TO_EDGE)).toHaveLength(4);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

  it("uses nearest within-page filtering for nearest-prefixed logical min filters", async () => {
    vi.stubGlobal("Image", ControlledImage);
    const fetchRequests = installFetchQueue();
    const { calls, gl } = fakeGl();
    const root = createWebGlRoot(fakeCanvas(gl));

    root.render(renderScene(unlitMaterial({
      texture: virtualTexture({
        sampler: { minFilter: "nearest-mipmap-linear" },
        manifestUri: "/vt/manifest.json",
      }),
    })));
    fetchRequests[0]!.resolve(responseJson(vtManifest(1)));
    await flushMicrotasks();

    expect(texParameterGroups(calls)[0]).toContainEqual([gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST]);
    expect(calls.some((call) => call.name === "generateMipmap")).toBe(false);
  });

});

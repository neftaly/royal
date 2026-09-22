import { createAutomaticRasterPageSource } from "../../packages/renderer-webgl/src/virtual-texture/automatic-page-source";
import { textureInspectionSource } from "../../packages/renderer-webgl/src/texture/inspection-policy";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "../../packages/react/src/runtime/canvas";
import { perspectiveCamera } from "@royal/renderer-core";
import type { RendererRoot } from "@royal/renderer-webgl";
import { TextureInspectionOwner } from "../../packages/renderer-webgl/src/texture/inspection";
import { createBrowserTextureDecoder } from "../../packages/renderer-webgl/src/texture/browser-decode";
import { TextureInspectionSampler, freezeInspectionSource, inspectionSampleKey } from "../../packages/renderer-webgl/src/texture/inspection-sample";
import { TextureAssetOwner } from "../../packages/renderer-webgl/src/texture/asset-owner";
import { PrefilteredEnvironmentAssetOwner } from "../../packages/renderer-webgl/src/environment/asset-owner";
import { environmentInspectionSample, inspectEnvironment } from "../../packages/renderer-webgl/src/environment/inspection-sample";

const assert = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const raster = (color: string, size = 1024): HTMLCanvasElement => {
  const canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
  const context = canvas.getContext("2d")!; context.fillStyle = color; context.fillRect(0, 0, size, size);
  return canvas;
};
const red = (canvas: HTMLCanvasElement): boolean => {
  const p = canvas.getContext("2d")!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data;
  return p[0]! > 200 && p[1]! < 40 && p[2]! < 40;
};
const rejected = async (promise: Promise<unknown>): Promise<boolean> => { try { await promise; return false; } catch { return true; } };
const signal = () => new AbortController().signal;

const asset = { kind: "asset" as const, src: "/shared" };

const environment = (badMip = -1) => {
  const words = new Uint32Array(6 * (4 * 4 + 2 * 2));
  let offset = 0;
  const levels = [4, 2].map((size, mip) => ({ level: mip, size,
    faces: Array.from({ length: 6 }, (_, face) => {
      const byteOffset = offset * 4;
      words.fill(mip === badMip ? 0x3c0 : 0x3c0 << 11, offset, offset + size * size);
      offset += size * size; return { face, byteOffset, byteLength: size * size * 4 };
    }) as never,
  }));
  return { size: 4, source: words.buffer, metadata: { provenance: "test" } as never, levels };
};

const frozenSources = async (passed: string[]): Promise<void> => {
  let calls = 0;
  const owner = new TextureInspectionOwner({ key: "v1", allow: async image => { calls++; return red(image); } });
  const original = raster("red");
  const retained = await owner.accept(asset, { source: original, width: 1024, height: 1024 }, signal());
  const context = original.getContext("2d")!; context.fillStyle = "blue"; context.fillRect(0, 0, 1024, 1024);
  assert(retained.kind === undefined && red(retained.source as HTMLCanvasElement), "mutable image changed after approval");
  const again = await owner.accept({ ...asset, sampler: { wrapS: "repeat" } }, { source: raster("red"), width: 1024, height: 1024 }, signal());
  assert(calls === 1, "identical pixels/sampler variant inspected twice");
  const alias = await owner.accept({ kind: "asset", src: "/different-id" }, { source: raster("red"), width: 1024, height: 1024 }, signal());
  assert(calls === 1, "identical pixels under a different asset ID repeated inference");
  alias.close?.();
  assert(await rejected(owner.accept(asset, { source: original, width: 1024, height: 1024 }, signal())), "changed same-URL pixels inherited approval");
  assert(calls === 2, "changed pixels were not inspected again");
  if (retained.kind !== undefined) throw new Error("expected frozen raster");
  const pages = createAutomaticRasterPageSource(retained, { minFilter: "linear-mipmap-linear", magFilter: "linear", wrapS: "clamp-to-edge", wrapT: "clamp-to-edge" }, "srgb");
  for (let mip = 0; mip < pages.layout.mipCount; mip++) {
    const page = await pages.read({ mip, x: 0, y: 0 }, signal());
    assert(red(page.source as HTMLCanvasElement), "generated page differs from approved frozen source");
    page.close();
  }
  assert(calls === 2, "generated pages reran classification");
  pages.close?.();
  passed.push("every automatic mip derives from approved frozen pixels without reclassification");
  retained.close?.(); again.close?.(); owner.dispose();
  passed.push("frozen display, sampler deduplication, same-URL pixel changes");
};

const publication = async (passed: string[]): Promise<void> => {
  let finish!: (allow: boolean) => void;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const gate = new TextureInspectionOwner({ key: "v1", allow: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  const lifecycle = new TextureAssetOwner({
    decode: async (source, abort) => gate.accept(source, { source: raster("red", 32), width: 32, height: 32 }, abort),
    onAssetChanged: () => undefined, onSnapshotChanged: () => undefined, onListenerError: error => { throw error; },
  });
  lifecycle.reconcile([asset]);
  await started;
  assert(lifecycle.getSnapshot(asset).status === "loading" && lifecycle.decoded(asset) === undefined, "pending inspection published texture pixels");
  finish(false);
  for (let i = 0; i < 20 && lifecycle.getSnapshot(asset).status === "loading"; i++) await new Promise(resolve => setTimeout(resolve, 0));
  assert(lifecycle.getSnapshot(asset).status === "error" && lifecycle.decoded(asset) === undefined, "blocked inspection published texture pixels");
  lifecycle.dispose(); gate.dispose();
  passed.push("publication gated during pending and denied classification");
};

const svgPixels = async (passed: string[]): Promise<void> => {
  // At small SVG viewports the blue non-scaling stroke can cover the red interior.
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="red" stroke="blue" stroke-width="400" vector-effect="non-scaling-stroke"/></svg>`;
  const uri = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const decoder = createBrowserTextureDecoder();
    const svgAsset = { kind: "asset" as const, src: uri };
    let svgCalls = 0;
    const svgOwner = new TextureInspectionOwner({ key: "no-red", allow: async image => { svgCalls++; return !red(image); } });
    const decoded = await decoder.decode(svgAsset, signal());
    assert(decoded.kind === undefined, "SVG did not reach ordinary browser image decoding");
    const displayed = freezeInspectionSource(decoded as Parameters<typeof freezeInspectionSource>[0]);
    const expected = await svgOwner.sample(displayed);
    assert(red(expected), "adversarial SVG fixture must expose a red center at its rendering resolution");
    const expectedKey = await inspectionSampleKey(expected);
    assert(await rejected(svgOwner.accept(svgAsset, displayed, signal())), "non-scaling SVG stroke hid content from inspection");
    assert(svgCalls === 1 && expectedKey.length > 64, "SVG classifier did not see its frozen pixels");
    expected.width = expected.height = 1;
    svgOwner.dispose();
    passed.push("SVG non-scaling strokes classified from frozen display pixels");
    const classifiedKeys = new Set<string>();
    let resolutionCalls = 0;
    const resolutionOwner = new TextureInspectionOwner({ key: "resolutions", allow: async image => {
      resolutionCalls++; classifiedKeys.add(await inspectionSampleKey(image)); return true;
    } });
    const renderedKeys = new Set<string>();
    for (const size of [1024, 256, 1024]) {
      const fitted = await decoder.decode(svgAsset, signal(), size * size * 4);
      const frozen = freezeInspectionSource(fitted as Parameters<typeof freezeInspectionSource>[0]);
      const displaySample = await resolutionOwner.sample(frozen);
      renderedKeys.add(await inspectionSampleKey(displaySample));
      displaySample.width = displaySample.height = 1;
      (await resolutionOwner.accept(svgAsset, frozen, signal())).close?.();
    }
    assert(resolutionCalls === renderedKeys.size && [...renderedKeys].every(key => classifiedKeys.has(key)),
      "a fitted SVG reused approval for a different inspection sample");
    resolutionOwner.dispose();
    passed.push("same SVG re-decoded at different budgets only reuses identical sample decisions");
  } finally { URL.revokeObjectURL(uri); }
};

const previews = async (passed: string[]): Promise<void> => {
  const full = raster("red", 32);
  const fullUri = full.toDataURL("image/png");
  const previewPolicy = new TextureInspectionOwner({ key: "no-red", allow: async image => !red(image) });
  const recipe = { kind: "asset" as const, src: fullUri, rasterPreview: { width: 32, height: 32 },
    astc: { kind: "asset" as const, src: "/must-not-fetch-native-preview", sourceEncoding: "ktx2-astc" as const } };
  const finalImage = await createBrowserTextureDecoder().decode(textureInspectionSource(recipe), signal());
  assert(finalImage.preview === undefined, "inspection retained a deferred preview");
  assert(await rejected(previewPolicy.accept(recipe, finalImage, signal())), "native preview approval bypassed the full raster");
  const deferredSource = { kind: "ktx2-etc2" as const, colorSpace: "srgb" as const, width: 4, height: 4, levels: [],
    preview: { size: { width: 32, height: 32 }, rasterBytes: 4096, retainedBytes: 0,
      load: async () => ({ source: full, width: 32, height: 32 }) } };
  assert(await rejected(previewPolicy.accept(asset, deferredSource, signal())), "custom deferred preview bypassed inspection");
  previewPolicy.dispose();
  passed.push("full-image inspection instead of trusting a deferred native preview");
};

const etc2 = async (passed: string[]): Promise<void> => {
  const native = new TextureInspectionOwner({ key: "v1", allow: async image => { assert(image.width === 4, "native sample dimensions"); return true; } });
  const probe = document.createElement("canvas").getContext("webgl2")!;
  if (probe.getExtension("WEBGL_compressed_texture_etc") !== null) {
    const texture = await native.accept({ kind: "asset", src: "/compressed" }, {
      kind: "ktx2-etc2", colorSpace: "srgb", width: 4, height: 4,
      levels: [{ width: 4, height: 4, blocks: new Uint8Array(16) }],
    }, signal());
    texture.close?.(); passed.push("native ETC2 offscreen sampling");
  } else throw new Error("Browser test requires ETC2 support");
  probe.getExtension("WEBGL_lose_context")?.loseContext(); native.dispose();
};

const nativeMips = async (passed: string[]): Promise<void> => {
  const envBytes = new Uint32Array(6); envBytes.fill(0x3c0); // R=1, G=B=0 in R11G11B10.
  const envImage = environmentInspectionSample({ size: 1, source: envBytes.buffer, metadata: {} as never,
    levels: [{ level: 0, size: 1, faces: Array.from({ length: 6 }, (_, face) => ({ face, byteOffset: face * 4, byteLength: 4 })) as never }] });
  assert(envImage.width === 3 && envImage.height === 2, "environment did not include all six faces");
  const envPixel = envImage.getContext("2d")!.getImageData(0, 0, 1, 1).data;
  assert(envPixel[0]! > 100 && envPixel[1] === 0 && envPixel[2] === 0, "packed HDR environment channels decoded incorrectly");
  passed.push("bounded six-face environment overview");
  // Each authored native mip is independent input, including RGB hidden by alpha.
  const block = (isRed: boolean, alpha = 255): Uint8Array => {
    const bytes = new Uint8Array(16); bytes[0] = alpha; bytes[isRed ? 8 : 9] = 255; return bytes;
  };
  const compressed = (badMip = -1, alpha = 255) => ({
    kind: "ktx2-etc2" as const, colorSpace: "srgb" as const, width: 4, height: 4,
    levels: [4, 2, 1].map((size, mip) => ({ width: size, height: size, blocks: block(mip === badMip, alpha) })),
  });
  let nativeCalls = 0;
  const nativePolicy = new TextureInspectionOwner({ key: "no-red", allow: async image => { nativeCalls++; return !red(image); } });
  const mipAsset = { kind: "asset" as const, src: "/mips" };
  await nativePolicy.accept(mipAsset, compressed(), signal());
  assert(nativeCalls === 3, "native chain did not inspect every mip including 2x2/1x1 tails");
  await nativePolicy.accept(mipAsset, compressed(), signal());
  assert(nativeCalls === 3, "identical native chain repeated classification");
  for (const mip of [1, 2]) {
    assert(await rejected(nativePolicy.accept(mipAsset, compressed(mip), signal())), "changed lower native mip inherited base approval");
  }
  assert(await rejected(nativePolicy.accept({ ...mipAsset, src: "/alpha-hidden" }, compressed(0, 0), signal())),
    "transparent native RGB bypassed inspection");
  const transparentPixels = new ImageData(new Uint8ClampedArray([255, 0, 0, 0]), 1, 1);
  const transparentBitmap = await createImageBitmap(transparentPixels, { premultiplyAlpha: "none" });
  assert(await rejected(nativePolicy.accept({ ...mipAsset, src: "/alpha-bitmap" }, {
    source: transparentBitmap, width: 1, height: 1, close: () => transparentBitmap.close(),
  }, signal())), "transparent raster RGB bypassed inspection");
  const bcProbe = document.createElement("canvas").getContext("webgl2")!;
  if (bcProbe.getExtension("WEBGL_compressed_texture_s3tc") !== null) {
    const bc = (badMip = -1) => ({
      kind: "ktx2-native" as const, format: "bc3-rgba" as const, colorSpace: "srgb" as const, width: 4, height: 4,
      levels: [4, 2, 1].map((size, mip) => {
        const blocks = new Uint8Array(16); blocks[0] = 255;
        const color = mip === badMip ? 0xf800 : 0x07e0;
        blocks[8] = blocks[10] = color & 255; blocks[9] = blocks[11] = color >>> 8;
        return { width: size, height: size, blocks };
      }),
    });
    await nativePolicy.accept({ ...mipAsset, src: "/bc-tail" }, bc(), signal());
    assert(await rejected(nativePolicy.accept({ ...mipAsset, src: "/bc-tail" }, bc(2), signal())),
      "BC tail mip escaped inspection or could not be sampled at its authored level");
    passed.push("BC 2x2/1x1 mip tails remain supported and independently inspected");
  }
  bcProbe.getExtension("WEBGL_lose_context")?.loseContext();
  nativePolicy.dispose();
  passed.push("opaque RGB inspection blocks transparent raster/native content and every authored native mip");
};

const environmentMips = async (passed: string[]): Promise<void> => {
  let envCalls = 0, currentEnvironment = environment();
  const environmentPolicy = new TextureInspectionOwner({ key: "no-red", allow: async image => {
    envCalls++; return image.getContext("2d")!.getImageData(0, 0, 1, 1).data[0]! < 100;
  } });
  const envAsset = { src: "/reload-environment", version: 1 };
  const environments = new PrefilteredEnvironmentAssetOwner({
    read: async () => currentEnvironment.source, prepare: async () => currentEnvironment,
    onAssetChanged: () => undefined, onListenerError: error => { throw error; },
    inspect: (key, prepared, abort) => inspectEnvironment(environmentPolicy, key, prepared, abort),
  });
  const reload = async (badMip = -1) => {
    environments.reconcile(undefined); currentEnvironment = environment(badMip); environments.reconcile(envAsset);
    for (let i = 0; i < 200 && environments.getSnapshot(envAsset).status === "loading"; i++) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  await reload();
  assert(environments.getSnapshot(envAsset).status === "ready" && envCalls === 2, "environment mip inspection did not complete");
  await reload();
  assert(environments.getSnapshot(envAsset).status === "ready" && envCalls === 2, "identical environment unnecessarily reclassified");
  for (const mip of [1, 0]) {
    await reload(mip);
    assert(environments.getSnapshot(envAsset).status === "error" && environments.prepared(envAsset) === undefined,
      "changed environment pixels or roughness mip inherited cached approval");
  }
  assert(envCalls === 4, "changed environment mips were not classified independently");
  environments.dispose(); environmentPolicy.dispose();
  passed.push("environment reloads fingerprint actual pixels and check every authored roughness mip");
};

const orientation = async (passed: string[]): Promise<void> => {
  const orientation = raster("red", 32);
  orientation.getContext("2d")!.fillStyle = "blue"; orientation.getContext("2d")!.fillRect(0, 16, 32, 16);
  const orientationPolicy = new TextureInspectionOwner({ key: "orientation", allow: async () => true });
  const oriented = await orientationPolicy.sample({ source: orientation, width: 32, height: 32 });
  const orientedPixels = oriented.getContext("2d")!.getImageData(0, 0, 32, 32).data;
  assert(orientedPixels[0] === 255 && orientedPixels[(31 * 32) * 4 + 2] === 255, "full-resolution readback inverted image rows");
  oriented.width = oriented.height = 1; orientationPolicy.dispose();
  passed.push("full-resolution readback preserves image orientation");
};

const sparseRaster = async (passed: string[]): Promise<void> => {
  const sparse = raster("red", 4096), sparseContext = sparse.getContext("2d")!;
  sparseContext.fillStyle = "#00ff00";
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) sparseContext.fillRect(x * 16 + 7, y * 16 + 7, 2, 2);
  let classifications = 0;
  const areaPolicy = new TextureInspectionOwner({ key: "area", allow: async image => { classifications++; return !red(image); } });
  assert(await rejected(areaPolicy.accept({ kind: "asset", src: "/sparse" }, { source: sparse, width: 4096, height: 4096 }, signal())),
    "sparse green grid concealed predominantly red source");
  assert(classifications === 1, "large raster failed sampling instead of reaching classification");
  areaPolicy.dispose();
  passed.push("area filtering rejects sparse-grid concealment across full resolution");
};

const alphaComposites = async (passed: string[]): Promise<void> => {
  const alphaPixels = new Uint8ClampedArray(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const i = (y * 32 + x) * 4;
    alphaPixels[i] = alphaPixels[i + 1] = alphaPixels[i + 2] = 255; alphaPixels[i + 3] = x < 16 ? 0 : 255;
  }
  let alphaCalls = 0;
  const alphaPolicy = new TextureInspectionOwner({ key: "opacity", allow: async image => {
    alphaCalls++;
    const pixels = image.getContext("2d")!.getImageData(0, 0, image.width, image.height).data;
    return pixels[0] === pixels[(image.width - 1) * 4];
  } });
  const alphaBitmap = await createImageBitmap(new ImageData(alphaPixels, 32, 32), { premultiplyAlpha: "none" });
  assert(await rejected(alphaPolicy.accept({ kind: "asset", src: "/alpha-pattern" }, { source: alphaBitmap, width: 32, height: 32 }, signal())),
    "opacity-only image escaped classification");
  assert(alphaCalls === 2, "opacity pattern did not receive a composite check");
  alphaPolicy.dispose();
  passed.push("opacity-only imagery is checked after raw RGB");
};

const sparseEnvironment = async (passed: string[]): Promise<void> => {
  const sparseEnvironment = environment();
  const envSize = 1024, envWords = new Uint32Array(6 * envSize * envSize); envWords.fill(0x3c0);
  for (let face = 0; face < 6; face++) for (let y = 0; y < 85; y++) for (let x = 0; x < 85; x++) {
    envWords[face * envSize * envSize + Math.floor(y * envSize / 85) * envSize + Math.floor(x * envSize / 85)] = 0x3c0 << 11;
  }
  const envOverview = environmentInspectionSample({ ...sparseEnvironment, source: envWords.buffer,
    levels: [{ ...sparseEnvironment.levels[0]!, size: envSize, faces: sparseEnvironment.levels[0]!.faces.map(face => ({ ...face, byteOffset: face.face * envSize * envSize * 4 })) }],
  });
  const sparseEnvPixel = envOverview.getContext("2d")!.getImageData(0, 0, 1, 1).data;
  assert(sparseEnvPixel[0]! > 180 && sparseEnvPixel[1]! < 30, "environment sparse grid concealed red faces");
  envOverview.width = envOverview.height = 1;
  passed.push("environment area filtering includes pixels between former grid samples");
};

const reactPolicy = async (passed: string[]): Promise<void> => {
  const mount = document.createElement("div"); mount.style.cssText = "width:32px;height:32px"; document.body.appendChild(mount);
  const react = createRoot(mount);
  let current: RendererRoot | null = null;
  const rendererRef = (root: RendererRoot | null) => { current = root; };
  const scene = { kind: "scene" as const, camera: perspectiveCamera({}), nodes: [], clearColor: [0, 0, 0, 0] as const };
  const render = (key: string, concurrency = 1) => react.render(createElement(Canvas, {
    scene, rendererRef, style: { width: "32px", height: "32px" },
    textureInspection: { key, concurrency, allow: async () => true },
  }));
  const until = async (done: () => boolean) => {
    for (let i = 0; i < 300 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert(done(), "React policy lifecycle did not settle");
  };
  try {
    render("v1"); await until(() => current !== null);
    const first = current;
    render("v1"); await new Promise(resolve => setTimeout(resolve, 50));
    assert(current === first, "callback identity replaced the Canvas root");
    render("v2"); await until(() => current !== null && current !== first);
    const second = current;
    render("v2", 2); await until(() => current !== null && current !== second);
    assert(!mount.querySelector("canvas")?.hasAttribute("textureInspection"), "inspection policy leaked to DOM");
    passed.push("React callback identity preserves root; policy key or concurrency replaces it");
  } finally { react.unmount(); mount.remove(); }
};

const workerEquivalence = async (passed: string[]): Promise<void> => {
  const sampler = new TextureInspectionSampler();
  try {
    for (const [width, height] of [[513, 517], [1, 2049], [1024, 1024]]) {
      const bytes = new Uint8ClampedArray(width! * height! * 4);
      for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 131 + (i >>> 7)) % 256;
      const bitmap = await createImageBitmap(new ImageData(bytes, width!, height!), { premultiplyAlpha: "none" });
      try {
        const source = { source: bitmap, width: width!, height: height! };
        const local = sampler.samples(source);
        const worker = await sampler.samplesAsync(source, 0, signal());
        assert(local.length === worker.length, "worker lost alpha variants");
        for (let i = 0; i < local.length; i++) {
          assert(await inspectionSampleKey(local[i]!) === await inspectionSampleKey(worker[i]!), "worker changed reduced pixels");
          local[i]!.width = worker[i]!.width = 1;
        }
      } finally { bitmap.close(); }
    }
    passed.push("worker and local reduction match exactly for odd, tall and transparent images");
  } finally { sampler.dispose(); }
};

/** Small independent async fixtures keep engine compilation and resource scopes bounded. */
export const runTextureInspectionBrowserTests = async (): Promise<string[]> => {
  const passed: string[] = [];
  for (const check of [frozenSources, publication, svgPixels, previews, etc2, nativeMips, environmentMips, orientation, sparseRaster, alphaComposites, sparseEnvironment, reactPolicy, workerEquivalence]) {
    console.info("Inspection fixture:", check.name);
    await check(passed);
  }
  return passed;
};

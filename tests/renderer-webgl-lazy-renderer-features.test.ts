import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mesh,
  planeGeometry,
  scene,
  unlitMaterial,
  virtualTexture,
} from "@royal/renderer-core";
import { preloadClusteredLightingFeature } from "../packages/renderer-webgl/src/lazy-clustered-lighting-feature";
import type { DecodedTextureSourceLifetime } from "../packages/renderer-webgl/src/texture/decoded-source-lifetime";
import { LazyImageBasedLightingFeature } from "../packages/renderer-webgl/src/lazy-image-based-lighting-feature";
import {
  createResourceArena,
  disposeResourceArena,
  resourceArenaSourceReferenceCount,
} from "../packages/renderer-webgl/src/resource-arena";
import {
  createWebGlRoot,
  createWebGlRootWithResourcePolicy,
} from "../packages/renderer-webgl/src/root";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import {
  camera,
  clusteredScene,
  fakeCanvas,
  fakeGl,
} from "./renderer-webgl-working-state-runtime";

const roots = new Set<{ dispose(): void }>();

afterEach(() => {
  for (const root of roots) root.dispose();
  roots.clear();
  vi.unstubAllGlobals();
});

describe("lazy clustered-lighting feature", () => {
  it("defers punctual-lit draws until Forward+ is available", async () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const { calls, gl } = fakeGl();
    const root = createWebGlRootWithResourcePolicy(fakeCanvas(gl));
    roots.add(root);
    const graph = clusteredScene();

    root.render(graph);
    expect(calls.filter((call) => call.name === "drawElements")).toHaveLength(0);

    await preloadClusteredLightingFeature();
    await Promise.resolve();
    root.render(graph);
    root.render(graph);

    expect(calls.filter((call) => call.name === "drawElements").length).toBeGreaterThan(0);
  });
});

describe("lazy image-based-lighting feature", () => {
  it("retains decoded glTF faces synchronously while its GPU module is unavailable", () => {
    const retain = vi.fn();
    const closeOrdinary = vi.fn();
    const resourceArena = createResourceArena(
      () => new Promise(() => undefined),
      () => undefined,
      { retain },
    );
    const feature = new LazyImageBasedLightingFeature({
      active: () => false,
      contextLifecycle: () => "lost",
      decodedTextureSources: { closeOrdinary } as unknown as DecodedTextureSourceLifetime,
      diagnostic: vi.fn(),
      disposed: () => false,
      gl: {} as WebGL2RenderingContext,
      governor: { reserve: () => undefined },
      invalidate: vi.fn(),
      resourceArena,
    });
    const specular = {
      encoding: "linear" as const,
      imageLoadKeys: [["face"]],
      imageSize: 4,
      key: "environment:test",
    };
    const first = { height: 4, width: 4 } as LoadedTextureSource;
    const replacement = { height: 4, width: 4 } as LoadedTextureSource;

    feature.settleSpecularImage(specular, "face", first);
    expect(retain).toHaveBeenCalledWith(first);
    expect(resourceArenaSourceReferenceCount(resourceArena, first)).toBe(1);

    feature.settleSpecularImage(specular, "face", replacement);
    expect(retain).toHaveBeenCalledWith(replacement);
    expect(resourceArenaSourceReferenceCount(resourceArena, first)).toBe(0);
    expect(resourceArenaSourceReferenceCount(resourceArena, replacement)).toBe(1);
    expect(closeOrdinary).toHaveBeenCalledWith(first);

    feature.releaseSpecular(specular.key);
    expect(disposeResourceArena(resourceArena).kind).toBe("disposed");
  });
});

describe("lazy virtual-texture feature", () => {
  it("starts authored VT work after the initial synchronous render", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      requests.push(typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url);
      return new Promise<Response>(() => undefined);
    }));
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => (
      setTimeout(() => callback(performance.now()), 0) as unknown as number
    )));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((handle: number) => {
      clearTimeout(handle);
    }));
    const texture = virtualTexture("/textures/lazy.vt.json");
    const root = createWebGlRoot(fakeCanvas(fakeGl().gl));
    roots.add(root);
    const graph = scene({
      camera: camera(),
      nodes: [mesh({
        geometry: planeGeometry([1, 1]),
        material: unlitMaterial({ texture }),
      })],
    });

    root.render(graph);
    expect(requests).toEqual([]);

    await import("../packages/renderer-webgl/src/virtual-texture/feature-owner");
    for (let attempt = 0; attempt < 80 && requests.length === 0; attempt += 1) {
      await Promise.resolve();
      root.render(graph);
    }

    expect(root.snapshot().diagnosticLog.entries.map((entry) => entry.message)).toEqual([]);
    expect(requests).toEqual(["/textures/lazy.vt.json"]);
    expect(root.textureAssetSnapshot(texture)).toMatchObject({
      kind: "virtual",
      state: "loading",
    });
  });
});

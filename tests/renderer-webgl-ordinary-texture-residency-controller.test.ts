import { describe, expect, it } from "vitest";
import { DecodedTextureSourceLifetime } from "../packages/renderer-webgl/src/decoded-texture-source-lifetime";
import type { ResourceManifestDelta } from "../packages/renderer-webgl/src/frame-plan";
import { OrdinaryTextureResidencyController } from "../packages/renderer-webgl/src/ordinary-texture-residency-controller";
import type { OrdinaryTextureSourceRequest } from "../packages/renderer-webgl/src/ordinary-texture-source-store";
import {
  applyResourceDelta,
  createResourceArena,
  resourceArenaSourceReferenceCount,
  type ResourceArena,
} from "../packages/renderer-webgl/src/resource-arena";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
import type { TextureAssetUploadRef } from "../packages/renderer-webgl/src/webgl/materials";
import { textureCacheKey } from "../packages/renderer-webgl/src/webgl/materials";
import { createTextureHandleArena } from "../packages/renderer-webgl/src/webgl/texture-handle-arena";
import { runFuzzTraces, type SeededRandom } from "./fuzz";

type Handle = { readonly serial: number };

class FakeGl {
  readonly CLAMP_TO_EDGE = 0x812f;
  readonly LINEAR = 0x2601;
  readonly RGBA = 0x1908;
  readonly TEXTURE0 = 0x84c0;
  readonly TEXTURE_2D = 0x0de1;
  readonly TEXTURE_MAG_FILTER = 0x2800;
  readonly TEXTURE_MIN_FILTER = 0x2801;
  readonly TEXTURE_WRAP_S = 0x2802;
  readonly TEXTURE_WRAP_T = 0x2803;
  readonly UNPACK_ALIGNMENT = 0x0cf5;
  readonly UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
  readonly UNPACK_FLIP_Y_WEBGL = 0x9240;
  readonly UNPACK_IMAGE_HEIGHT = 0x806e;
  readonly UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
  readonly UNPACK_ROW_LENGTH = 0x0cf2;
  readonly UNPACK_SKIP_IMAGES = 0x806d;
  readonly UNPACK_SKIP_PIXELS = 0x0cf4;
  readonly UNPACK_SKIP_ROWS = 0x0cf3;
  readonly UNSIGNED_BYTE = 0x1401;
  deleteFailure: unknown | undefined;
  readonly deleted: number[] = [];
  #serial = 1;
  activeTexture = (): void => undefined;
  bindTexture = (): void => undefined;
  createTexture = (): WebGLTexture => ({ serial: this.#serial++ }) as unknown as WebGLTexture;
  deleteTexture = (texture: WebGLTexture): void => {
    this.deleted.push((texture as unknown as Handle).serial);
    if (this.deleteFailure !== undefined) throw this.deleteFailure;
  };
  generateMipmap = (): void => undefined;
  pixelStorei = (): void => undefined;
  texImage2D = (): void => undefined;
  texParameteri = (): void => undefined;
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const source = (serial: number, width = 1, height = 1): LoadedTextureSource => ({
  data: new Uint8Array(width * height * 4).fill(serial),
  height,
  kind: "rgba-texture",
  width,
}) as LoadedTextureSource;
const flushJobs = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

type HarnessOptions = {
  readonly close?: (source: LoadedTextureSource) => void;
  readonly invalidate?: () => void;
  readonly load?: (texture: OrdinaryTextureSourceRequest, signal: AbortSignal) => Promise<LoadedTextureSource>;
  readonly register?: (texture: TextureAssetUploadRef, source: LoadedTextureSource) => void;
};

const emptyDelta = (): ResourceManifestDelta => ({
  bulkInstances: [],
  directGeometries: [],
  gltfRequests: [],
  ordinaryTextures: [],
  renderObjectRefs: [],
  virtualTextures: [],
});

const retainTexture = (arena: ResourceArena, texture: TextureAssetUploadRef): void => {
  const key = textureCacheKey(texture);
  applyResourceDelta(arena, {
    ...emptyDelta(),
    ordinaryTextures: [{
      delta: 1,
      key,
      nextCount: 1,
      previousCount: 0,
      resource: { count: 1, key, texture },
    }],
  });
};

const harness = (options: HarnessOptions = {}) => {
  const gl = new FakeGl();
  const lifecycle = { active: true, disposed: false, generation: 1 };
  let arena!: ResourceArena;
  let releasedDecodedLeases = 0;
  const decoded = new DecodedTextureSourceLifetime({
    ...(options.close === undefined ? {} : { closeOrdinary: options.close }),
    ordinaryReferenceCount: (candidate) => resourceArenaSourceReferenceCount(arena, candidate),
    reserveOrdinaryDecodedBytes: () => ({
      release: () => {
        releasedDecodedLeases += 1;
        return true;
      },
    }),
    scheduleRetry: () => undefined,
  });
  arena = createResourceArena(
    () => new Promise(() => undefined),
    () => undefined,
    { retain: (candidate) => decoded.retainOrdinary(candidate) },
  );
  const diagnostics: string[] = [];
  const controller = new OrdinaryTextureResidencyController({
    decodedSources: decoded,
    diagnostic: (message) => { diagnostics.push(message); },
    gl: context(gl),
    invalidate: options.invalidate ?? (() => undefined),
    lifecycle: () => lifecycle,
    loadSource: options.load ?? (() => new Promise(() => undefined)),
    registerAutoVirtualTextureDecodedSource: options.register ?? (() => undefined),
    resourceArena: arena,
    textureHandles: createTextureHandleArena(context(gl)),
  });
  return { arena, controller, diagnostics, gl, lifecycle, releasedDecodedLeases: () => releasedDecodedLeases };
};

const settle = (
  controller: OrdinaryTextureResidencyController,
  report: ReturnType<OrdinaryTextureResidencyController["process"]>,
): unknown | undefined => report.operationFailure?.error ?? controller.settleGpuReport(report)?.error;

const successfulAdmission = {
  reserve: () => ({
    cancel: () => undefined,
    commit: () => ({ release: () => undefined }),
  }),
};

describe("ordinary texture residency controller", () => {
  it("does not install a released subscription after synchronous publication failure", async () => {
    const decoded = source(1);
    const base: TextureAssetUploadRef = { kind: "asset", uri: "/shared.png" };
    const variant: TextureAssetUploadRef = {
      kind: "asset",
      sampler: { magFilter: "nearest" },
      uri: "/shared.png",
    };
    const { arena, controller, diagnostics } = harness({
      load: async () => decoded,
      register: (texture) => {
        if (texture.sampler?.magFilter === "nearest") throw new Error("publication fault");
      },
    });
    retainTexture(arena, base);
    retainTexture(arena, variant);
    controller.request(base);
    await flushJobs();

    controller.request(variant);
    expect(controller.snapshot()).toMatchObject({
      rows: 2,
      sources: { starts: 1, subscribers: 1 },
      terminalRows: 1,
    });
    controller.request(variant);
    expect(controller.snapshot().sources).toMatchObject({ starts: 1, subscribers: 1 });
    expect(diagnostics.some((message) => message.includes("publication fault"))).toBe(true);

    settle(controller, controller.release(textureCacheKey(variant)));
    settle(controller, controller.release(textureCacheKey(base)));
    controller.disposeSources();
  });

  it("invalidates an acquisition token when semantic release re-enters synchronous delivery", async () => {
    const decoded = source(2);
    const base: TextureAssetUploadRef = { kind: "asset", uri: "/reentrant.png" };
    const variant: TextureAssetUploadRef = {
      colorSpace: "linear",
      kind: "asset",
      uri: "/reentrant.png",
    };
    let controller!: OrdinaryTextureResidencyController;
    let reentrantReport: ReturnType<OrdinaryTextureResidencyController["release"]> | undefined;
    const setup = harness({
      load: async () => decoded,
      register: (texture) => {
        if (texture.colorSpace === "linear") {
          reentrantReport = controller.release(textureCacheKey(texture));
        }
      },
    });
    controller = setup.controller;
    retainTexture(setup.arena, base);
    retainTexture(setup.arena, variant);
    controller.request(base);
    await flushJobs();

    controller.request(variant);
    expect(reentrantReport).toBeDefined();
    expect(settle(controller, reentrantReport!)).toBeUndefined();
    expect(controller.snapshot()).toMatchObject({
      rows: 1,
      sources: { subscribers: 1 },
      terminalRows: 0,
    });

    settle(controller, controller.release(textureCacheKey(base)));
    controller.disposeSources();
  });

  it("keeps terminal state across retained context-loss outcomes until authoritative publication", async () => {
    const decoded = source(3);
    const texture: TextureAssetUploadRef = { kind: "asset", uri: "/terminal.png" };
    let throwInvalidation = true;
    const { arena, controller, lifecycle } = harness({
      invalidate: () => {
        if (throwInvalidation) throw new Error("publication side effect failed");
      },
      load: async () => decoded,
    });
    retainTexture(arena, texture);
    controller.request(texture);
    await flushJobs();
    expect(controller.snapshot()).toMatchObject({ terminalRows: 1, sources: { subscribers: 0 } });

    lifecycle.active = false;
    const drop = controller.dropContext();
    expect(settle(controller, drop)).toBeUndefined();
    lifecycle.generation += 1;
    lifecycle.active = true;
    controller.restore();
    expect(controller.snapshot()).toMatchObject({ resources: 1, terminalRows: 1 });

    throwInvalidation = false;
    controller.publishPrepared(texture, decoded);
    expect(controller.snapshot().terminalRows).toBe(0);
    settle(controller, controller.release(textureCacheKey(texture)));
    controller.disposeSources();
  });

  it("rejects double report settlement", () => {
    const { controller } = harness();
    const report = controller.process(0, 1, successfulAdmission);
    expect(controller.settleGpuReport(report)).toBeUndefined();
    expect(controller.settleGpuReport(report)?.error).toEqual(
      new Error("Ordinary texture GPU report was already settled"),
    );
    controller.disposeSources();
  });

  it("preserves close failure precedence while still quarantining a failed GPU deletion", async () => {
    const closeFailure = new Error("decoded close failed");
    const deletionFailure = new Error("texture delete failed");
    const decoded = source(4);
    const texture: TextureAssetUploadRef = { kind: "asset", uri: "/close-failure.png" };
    const { arena, controller, gl } = harness({
      close: () => { throw closeFailure; },
      load: async () => decoded,
    });
    retainTexture(arena, texture);
    controller.request(texture);
    await flushJobs();
    const upload = controller.process(0, 1, successfulAdmission);
    expect(settle(controller, upload)).toBeUndefined();
    gl.deleteFailure = deletionFailure;

    const release = controller.release(textureCacheKey(texture));
    expect(release.operationFailure?.error).toBe(closeFailure);
    expect(release.capacityReleased).toBe(false);
    expect(release.quarantinedBytesAfter).toBe(4);
    expect(controller.settleGpuReport(release)?.error).toBe(closeFailure);
    controller.disposeSources();
  });
});

type Command =
  | { readonly kind: "drop-restore" }
  | { readonly kind: "process"; readonly permanent: boolean }
  | { readonly kind: "publish"; readonly source: number }
  | { readonly kind: "release" }
  | { readonly kind: "request" };

const command = (random: SeededRandom): Command => {
  switch (random.int(0, 5)) {
    case 0: return { kind: "request" };
    case 1: return { kind: "publish", source: random.int(1, 5) };
    case 2: return { kind: "process", permanent: random.boolean(0.2) };
    case 3: return { kind: "drop-restore" };
    default: return { kind: "release" };
  }
};

it("keeps merged residency rows bounded under seeded command traces", async () => {
  await runFuzzTraces({
    cases: 12,
    operation: (random) => command(random),
    run: async (trace, label) => {
      const texture: TextureAssetUploadRef = { kind: "asset", uri: "/fuzz.png" };
      const setup = harness();
      retainTexture(setup.arena, texture);
      for (const [step, operation] of trace.entries()) {
        switch (operation.kind) {
          case "request":
            setup.controller.request(texture);
            break;
          case "publish":
            setup.controller.publishPrepared(texture, source(operation.source));
            break;
          case "process": {
            const report = setup.controller.process(step, setup.lifecycle.generation, {
              reserve: () => operation.permanent
                ? { limit: 0, reason: "persistent-gpu-cost-exceeds-limit" as const }
                : successfulAdmission.reserve(),
            });
            settle(setup.controller, report);
            break;
          }
          case "drop-restore": {
            setup.lifecycle.active = false;
            settle(setup.controller, setup.controller.dropContext());
            setup.lifecycle.generation += 1;
            setup.lifecycle.active = true;
            setup.controller.restore();
            break;
          }
          case "release":
            settle(setup.controller, setup.controller.release(textureCacheKey(texture)));
            break;
        }
        const snapshot = setup.controller.snapshot();
        expect(snapshot.rows, `${label} step=${step} rows`).toBeLessThanOrEqual(1);
        expect(snapshot.terminalRows, `${label} step=${step} terminal`).toBeLessThanOrEqual(snapshot.rows);
        expect(snapshot.sources.subscribers, `${label} step=${step} subscribers`).toBeLessThanOrEqual(snapshot.rows);
        expect(snapshot.resources, `${label} step=${step} resources`).toBeLessThanOrEqual(1);
      }
      settle(setup.controller, setup.controller.release(textureCacheKey(texture)));
      setup.controller.disposeSources();
      expect(setup.controller.snapshot()).toMatchObject({
        resources: 0,
        rows: 0,
        sources: { subscribers: 0 },
        terminalRows: 0,
      });
      await flushJobs();
    },
    seed: 0x6f726474,
    steps: 48,
  });
});

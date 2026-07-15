import { describe, expect, it } from "vitest";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture/sources";
import type { TextureAssetUploadRef } from "../packages/renderer-webgl/src/webgl/materials";
import {
  clearOrdinaryTextureGpuOutcomes,
  consumeOrdinaryTextureGpuWake,
  createOrdinaryTextureGpuArena,
  discardOrdinaryTexturePendingUpload,
  dropOrdinaryTextureGpuContext,
  ensureOrdinaryTextureGpuResource,
  ordinaryTextureGpuHasPendingUploads,
  ordinaryTextureGpuOutcome,
  ordinaryTextureGpuOutcomeCount,
  ordinaryTextureGpuPendingUpload,
  ordinaryTextureGpuQuarantinedBytes,
  ordinaryTextureGpuResourceCount,
  ordinaryTextureUploadCost,
  processOrdinaryTextureUploads,
  queueOrdinaryTextureUpload,
  releaseOrdinaryTextureGpuResource,
  wakeOrdinaryTextureGpuUploads,
} from "../packages/renderer-webgl/src/texture/ordinary-gpu-arena";
import {
  createTextureHandleArena,
  ownsTexture,
  releaseOwnedTexture,
  textureHandleArenaSnapshot,
} from "../packages/renderer-webgl/src/webgl/texture-handle-arena";
import { runFuzzTraces } from "./fuzz";

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
  readonly deleted: number[] = [];
  readonly created: number[] = [];
  deleteFault: unknown = new Error("delete failure");
  deleteFaultPresent = false;
  uploadFault: unknown = new Error("upload failure");
  uploadFaultPresent = false;
  samplerFaultPresent = false;
  readonly uploads: number[] = [];
  #serial = 1;
  activeTexture = (): void => undefined;
  bindTexture = (_target: number, texture: WebGLTexture): void => {
    if (texture !== null) this.#bound = (texture as unknown as Handle).serial;
  };
  #bound = 0;
  createTexture = (): WebGLTexture => {
    const serial = this.#serial++;
    this.created.push(serial);
    return { serial } as unknown as WebGLTexture;
  };
  deleteTexture = (texture: WebGLTexture): void => {
    const serial = (texture as unknown as Handle).serial;
    this.deleted.push(serial);
    if (this.deleteFaultPresent) {
      this.deleteFaultPresent = false;
      throw this.deleteFault;
    }
  };
  generateMipmap = (): void => undefined;
  pixelStorei = (): void => undefined;
  texImage2D = (): void => {
    if (this.uploadFaultPresent) {
      this.uploadFaultPresent = false;
      throw this.uploadFault;
    }
    this.uploads.push(this.#bound);
  };
  texParameteri = (): void => {
    if (this.samplerFaultPresent) {
      this.samplerFaultPresent = false;
      throw new Error("sampler failure");
    }
  };
}
const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const source = (serial: number, width = 1, height = 1): LoadedTextureSource => ({
  data: new Uint8Array(width * height * 4).fill(serial),
  height,
  kind: "rgba-texture",
  width,
}) as LoadedTextureSource;
const texture: TextureAssetUploadRef = { kind: "asset", uri: "texture.png" };
const setup = (): {
  readonly arena: ReturnType<typeof createOrdinaryTextureGpuArena>;
  readonly gl: FakeGl;
  readonly handles: ReturnType<typeof createTextureHandleArena>;
} => {
  const gl = new FakeGl();
  const handles = createTextureHandleArena(context(gl));
  return { arena: createOrdinaryTextureGpuArena(context(gl), handles), gl, handles };
};
type Operation = { readonly key: number; readonly kind: "ensure" | "queue" | "discard" | "release" }
  | { readonly frame: number; readonly generation: number; readonly kind: "process" };
const runOperationTrace = (trace: readonly Operation[], label: string): void => {
  const { arena, gl } = setup();
  type Resource = ReturnType<typeof ensureOrdinaryTextureGpuResource>;
  const actual = new Map<number, Resource>();
  const live = new Set<number>();
  const pending = new Set<number>();
  const uploaded = new Set<number>();
  let frame = -1;
  let uploadsInFrame = 0;
  let uploads = 0;
  for (const [step, operation] of trace.entries()) {
    if (operation.kind === "process") {
      if (frame !== operation.frame) {
        frame = operation.frame;
        uploadsInFrame = 0;
      }
      const eligible = [...pending].find((candidate) => live.has(candidate) && !actual.get(candidate)!.uploaded);
      processOrdinaryTextureUploads(arena, frame, operation.generation);
      if (eligible !== undefined && operation.generation === 1 && uploadsInFrame === 0) {
        pending.delete(eligible);
        uploaded.add(eligible);
        uploadsInFrame = 1;
        uploads += 1;
      } else if (operation.generation !== 1) {
        pending.clear();
      }
    } else if (operation.kind === "ensure") {
      const key = String(operation.key);
      const resource = ensureOrdinaryTextureGpuResource(arena, key, 1);
      if (live.has(operation.key)) expect(resource).toBe(actual.get(operation.key));
      actual.set(operation.key, resource);
      live.add(operation.key);
    } else if (operation.kind === "queue") {
      const resource = actual.get(operation.key);
      if (resource !== undefined) {
        const accepted = live.has(operation.key) && !resource.uploaded && !pending.has(operation.key);
        expect(queueOrdinaryTextureUpload(arena, resource, { source: source(step), texture })).toBe(accepted);
        if (accepted) pending.add(operation.key);
      }
    } else if (operation.kind === "discard") {
      const resource = actual.get(operation.key);
      if (resource !== undefined) discardOrdinaryTexturePendingUpload(arena, resource);
      pending.delete(operation.key);
    } else if (operation.kind === "release") {
      releaseOrdinaryTextureGpuResource(arena, String(operation.key));
      live.delete(operation.key);
      pending.delete(operation.key);
      uploaded.delete(operation.key);
    }
    expect(ordinaryTextureGpuResourceCount(arena), `${label} step=${step} resources`).toBe(live.size);
    expect(gl.uploads, `${label} step=${step} independent upload budget`).toHaveLength(uploads);
    for (const candidate of live) {
      const resource = actual.get(candidate)!;
      expect(ordinaryTextureGpuPendingUpload(resource) !== undefined).toBe(pending.has(candidate));
      expect(resource.uploaded).toBe(uploaded.has(candidate));
    }
  }
};
describe("ordinary texture GPU arena", () => {
  it("accounts compressed mip storage and upload bytes without RGBA inflation", () => {
    const levels = [
      { data: new Uint8Array(16), height: 4, width: 4 },
      { data: new Uint8Array(16), height: 2, width: 2 },
      { data: new Uint8Array(16), height: 1, width: 1 },
    ];
    expect(ordinaryTextureUploadCost({
      source: {
        ...levels[0]!,
        format: 0x9278,
        kind: "compressed-texture",
        levels,
        srgbFormat: 0x9279,
      },
      texture: {
        kind: "asset",
        sampler: { minFilter: "linear-mipmap-linear" },
        uri: "compressed.ktx2",
      },
    })).toEqual({ persistentGpuBytes: 48, uploadBytes: 48 });
  });

  it("keeps lifecycle accounting conserved across replayable operation traces", async () => {
    await runFuzzTraces<Operation>({
      cases: 12,
      operation: (random) => random.int(0, 5) === 4
        ? { frame: random.int(0, 5), generation: random.int(1, 3), kind: "process" }
        : { key: random.int(0, 4), kind: random.pick(["ensure", "queue", "discard", "release"] as const) },
      replayEnvName: "ROYAL_ORDINARY_TEXTURE_GPU_REPLAY",
      replays: [{ label: "idempotence-budget-replacement-stale-generation", value: [
        { key: 0, kind: "ensure" }, { key: 0, kind: "ensure" }, { key: 0, kind: "queue" },
        { key: 0, kind: "discard" }, { key: 0, kind: "queue" }, { key: 1, kind: "ensure" },
        { key: 1, kind: "queue" }, { frame: 1, generation: 1, kind: "process" },
        { frame: 1, generation: 1, kind: "process" }, { frame: 2, generation: 1, kind: "process" },
      ] }],
      run: runOperationTrace,
      seed: 0x0d71_a63b,
      steps: 48,
    });
  });
  it("preserves opaque upload-fault precedence and the same queue row for retry", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    consumeOrdinaryTextureGpuWake(arena);
    const uploadFault = { stage: "upload" };
    gl.uploadFault = uploadFault;
    gl.uploadFaultPresent = true;
    let thrown: unknown;
    try {
      processOrdinaryTextureUploads(arena, 1, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBe(uploadFault);
    expect(resource.uploaded).toBe(false);
    expect(ordinaryTextureGpuPendingUpload(resource)?.source).toBeDefined();
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(true);
    expect(ordinaryTextureGpuOutcomeCount(arena)).toBe(0);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(false);
    processOrdinaryTextureUploads(arena, 1, 1);
    expect(resource.uploaded).toBe(true);
    expect(gl.uploads).toEqual([(resource.texture as unknown as Handle).serial]);
    expect(ordinaryTextureGpuOutcome(arena, 0)?.kind).toBe("completed");
  });
  it("leaves a durable-capacity-denied upload queued and quiescent until capacity is released", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);

    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({ reason: "persistent-gpu-capacity" }),
    });

    expect(gl.created).toEqual([]);
    expect(gl.uploads).toEqual([]);
    expect(gl.deleted).toEqual([]);
    expect(resource.uploaded).toBe(false);
    expect(ordinaryTextureGpuPendingUpload(resource)).toBeDefined();
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(true);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(false);
    expect(wakeOrdinaryTextureGpuUploads(arena)).toBe(true);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
  });
  it("requests a next-frame retry for frame-local upload-capacity denial", () => {
    const { arena } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    consumeOrdinaryTextureGpuWake(arena);

    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({ reason: "upload-capacity" }),
    });

    expect(resource.uploaded).toBe(false);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
  });
  it("quiesces an intrinsically oversized upload with a deterministic failed outcome", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "oversized", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1, 2, 2), texture });
    consumeOrdinaryTextureGpuWake(arena);

    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({ limit: 8, reason: "upload-cost-exceeds-limit" }),
    });

    expect(gl.created).toEqual([]);
    expect(gl.uploads).toEqual([]);
    expect(ordinaryTextureGpuPendingUpload(resource)).toBeUndefined();
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(false);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(false);
    expect(ordinaryTextureGpuOutcome(arena, 0)).toMatchObject({
      kind: "failed",
      message: expect.stringMatching(/requires 16 upload bytes.*limit 8/),
    });
  });
  it("quiesces an intrinsically oversized persistent GPU allocation without GL work", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "oversized-gpu", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1, 2, 2), texture });
    consumeOrdinaryTextureGpuWake(arena);

    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({ limit: 8, reason: "persistent-gpu-cost-exceeds-limit" }),
    });

    expect(gl.created).toEqual([]);
    expect(gl.uploads).toEqual([]);
    expect(ordinaryTextureGpuPendingUpload(resource)).toBeUndefined();
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(false);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(false);
    expect(ordinaryTextureGpuOutcome(arena, 0)).toMatchObject({
      kind: "failed",
      message: expect.stringMatching(/requires 16 persistent GPU bytes.*limit 8/),
    });
  });
  it("retries temporary frame upload pressure and completes on the next frame", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "temporary", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    consumeOrdinaryTextureGpuWake(arena);
    let pressured = true;
    const admission = {
      reserve: () => pressured
        ? { reason: "upload-capacity" as const }
        : {
          cancel: () => undefined,
          commit: () => ({ release: () => undefined }),
        },
    };

    processOrdinaryTextureUploads(arena, 1, 1, admission);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
    pressured = false;
    processOrdinaryTextureUploads(arena, 2, 1, admission);

    expect(resource.uploaded).toBe(true);
    expect(gl.created).toHaveLength(1);
    expect(gl.uploads).toHaveLength(1);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(false);
  });
  it("rotates a denied row so a later affordable upload can proceed", () => {
    const { arena, gl } = setup();
    const large = ensureOrdinaryTextureGpuResource(arena, "large", 1);
    const small = ensureOrdinaryTextureGpuResource(arena, "small", 1);
    queueOrdinaryTextureUpload(arena, large, { source: source(1, 2, 2), texture });
    queueOrdinaryTextureUpload(arena, small, { source: source(2), texture });
    consumeOrdinaryTextureGpuWake(arena);
    let commits = 0;

    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: ({ persistentGpuBytes }) => persistentGpuBytes > 4 ? {
        reason: "persistent-gpu-capacity" as const,
      } : {
        cancel: () => undefined,
        commit: () => ({ release: () => undefined }),
      },
    });

    commits += small.uploaded ? 1 : 0;
    expect(commits).toBe(1);
    expect(large.uploaded).toBe(false);
    expect(ordinaryTextureGpuPendingUpload(large)).toBeDefined();
    expect(small.uploaded).toBe(true);
    expect(gl.created).toHaveLength(1);
    expect(gl.uploads).toHaveLength(1);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
  });
  it("spends upload admission and releases its failed unpublished allocation", () => {
    const { arena, gl, handles } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let cancels = 0;
    let commits = 0;
    let releases = 0;
    gl.uploadFaultPresent = true;

    expect(() => processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => { cancels += 1; },
        commit: () => {
          commits += 1;
          return { release: () => { releases += 1; } };
        },
      }),
    })).toThrow("upload failure");

    expect({ cancels, commits, releases }).toEqual({ cancels: 0, commits: 1, releases: 1 });
    expect(gl.created).toHaveLength(1);
    expect(gl.deleted).toHaveLength(1);
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(0);
    expect(resource.uploaded).toBe(false);
    expect(ordinaryTextureGpuPendingUpload(resource)).toBeDefined();
  });
  it("spends upload admission but releases durable bytes when sampler setup fails after upload", () => {
    const { arena, gl, handles } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let commits = 0;
    let releases = 0;
    gl.samplerFaultPresent = true;

    expect(() => processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => {
          commits += 1;
          return { release: () => { releases += 1; } };
        },
      }),
    })).toThrow("sampler failure");

    expect(gl.uploads).toHaveLength(1);
    expect({ commits, releases }).toEqual({ commits: 1, releases: 1 });
    expect(textureHandleArenaSnapshot(handles).ownedTextureCount).toBe(0);
    expect(resource.uploaded).toBe(false);
    expect(ordinaryTextureGpuPendingUpload(resource)).toBeDefined();
  });
  it("publishes the pending outcome before preserving an opaque release fault", () => {
    const { arena, gl, handles } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let releases = 0;
    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => ({ release: () => { releases += 1; } }),
      }),
    });
    clearOrdinaryTextureGpuOutcomes(arena);
    const releaseFault = { stage: "release" };
    gl.deleteFault = releaseFault;
    gl.deleteFaultPresent = true;
    expect(releaseOrdinaryTextureGpuResource(arena, "a").releaseError).toBe(releaseFault);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(ordinaryTextureGpuOutcomeCount(arena)).toBe(0);
    expect(releases).toBe(0);
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(4);
    if (!resource.uploaded) throw new Error("Expected admitted texture upload");
    expect(ownsTexture(handles, resource.texture)).toBe(true);
    dropOrdinaryTextureGpuContext(arena);
    expect(releases).toBe(1);
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(0);
    releaseOwnedTexture(handles, resource.texture);
  });
  it("removes uploaded residency once and releases its durable lease", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "generated", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let releases = 0;
    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => ({ release: () => { releases += 1; } }),
      }),
    });

    expect(releaseOrdinaryTextureGpuResource(arena, "generated")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: false,
      released: true,
    });
    expect(releaseOrdinaryTextureGpuResource(arena, "generated")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: false,
      released: false,
    });
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(gl.deleted).toHaveLength(1);
    expect(releases).toBe(1);
  });
  it("distinguishes an opaque deletion failure from successful removal", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "opaque", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let releases = 0;
    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => ({ release: () => { releases += 1; } }),
      }),
    });
    gl.deleteFault = undefined;
    gl.deleteFaultPresent = true;

    expect(releaseOrdinaryTextureGpuResource(arena, "opaque")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: true,
      released: true,
    });
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(4);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(releases).toBe(0);
    dropOrdinaryTextureGpuContext(arena);
    expect(releases).toBe(1);
  });
  it("still deletes the texture when durable lease release throws opaquely", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "lease-failure", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => ({ release: () => { throw undefined; } }),
      }),
    });

    expect(releaseOrdinaryTextureGpuResource(arena, "lease-failure")).toEqual({
      releaseError: undefined,
      releaseErrorPresent: true,
      released: true,
    });
    expect(gl.deleted).toHaveLength(1);
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(0);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
  });
  it("keeps context-loss cleanup GL-free and publishes pending retention", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    dropOrdinaryTextureGpuContext(arena);
    expect(gl.deleted).toEqual([]);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(false);
    expect(ordinaryTextureGpuOutcome(arena, 0)?.kind).toBe("retained");
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(0);
    clearOrdinaryTextureGpuOutcomes(arena);
    expect(ordinaryTextureGpuOutcomeCount(arena)).toBe(0);
  });
  it("releases live leases without GL deletion when the context is dropped", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    let releases = 0;
    processOrdinaryTextureUploads(arena, 1, 1, {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => ({ release: () => { releases += 1; } }),
      }),
    });

    dropOrdinaryTextureGpuContext(arena);

    expect(releases).toBe(1);
    expect(gl.deleted).toEqual([]);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(ordinaryTextureGpuQuarantinedBytes(arena)).toBe(0);
  });

  it("continues context-loss lease cleanup and retries only failures", () => {
    const { arena, gl } = setup();
    const leases: Array<{ fail: boolean; released: boolean }> = [];
    const admission = {
      reserve: () => ({
        cancel: () => undefined,
        commit: () => {
          const state = { fail: false, released: false };
          leases.push(state);
          return {
            release: () => {
              if (state.fail) throw new Error("ordinary texture lease release failed");
              state.released = true;
            },
          };
        },
      }),
    };
    const first = ensureOrdinaryTextureGpuResource(arena, "first", 1);
    queueOrdinaryTextureUpload(arena, first, { source: source(1), texture });
    processOrdinaryTextureUploads(arena, 1, 1, admission);
    const second = ensureOrdinaryTextureGpuResource(arena, "second", 1);
    queueOrdinaryTextureUpload(arena, second, { source: source(2), texture });
    processOrdinaryTextureUploads(arena, 2, 1, admission);
    expect(leases).toHaveLength(2);
    leases[0]!.fail = true;

    expect(() => dropOrdinaryTextureGpuContext(arena))
      .toThrow("ordinary texture lease release failed");
    expect(leases[1]!.released).toBe(true);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(gl.deleted).toEqual([]);

    leases[0]!.fail = false;
    dropOrdinaryTextureGpuContext(arena);
    expect(leases[0]!.released).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { LoadedTextureSource } from "../packages/renderer-webgl/src/texture-sources";
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
  ordinaryTextureGpuResourceCount,
  processOrdinaryTextureUploads,
  queueOrdinaryTextureUpload,
  releaseOrdinaryTextureGpuResource,
} from "../packages/renderer-webgl/src/webgl/ordinary-texture-gpu-arena";
import {
  createTextureHandleArena,
  ownsTexture,
  releaseOwnedTexture,
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
  deleteFault: unknown = new Error("delete failure");
  deleteFaultPresent = false;
  uploadFault: unknown = new Error("upload failure");
  uploadFaultPresent = false;
  readonly uploads: number[] = [];
  #serial = 1;
  activeTexture = (): void => undefined;
  bindTexture = (_target: number, texture: WebGLTexture): void => {
    if (texture !== null) this.#bound = (texture as unknown as Handle).serial;
  };
  #bound = 0;
  createTexture = (): WebGLTexture => ({ serial: this.#serial++ }) as unknown as WebGLTexture;
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
  texParameteri = (): void => undefined;
}
const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;
const source = (serial: number): LoadedTextureSource => ({
  data: new Uint8Array([serial, 0, 0, 255]),
  height: 1,
  kind: "rgba-texture",
  width: 1,
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
  it("publishes the pending outcome before preserving an opaque release fault", () => {
    const { arena, gl, handles } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    const releaseFault = { stage: "release" };
    gl.deleteFault = releaseFault;
    gl.deleteFaultPresent = true;
    expect(releaseOrdinaryTextureGpuResource(arena, "a").releaseError).toBe(releaseFault);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(ordinaryTextureGpuOutcome(arena, 0)?.kind).toBe("discarded");
    expect(ownsTexture(handles, resource.texture)).toBe(true);
    releaseOwnedTexture(handles, resource.texture);
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
    clearOrdinaryTextureGpuOutcomes(arena);
    expect(ordinaryTextureGpuOutcomeCount(arena)).toBe(0);
  });
});

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
  ordinaryTextureGpuResource,
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
  failDelete = false;
  failUpload = false;
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
    if (this.failDelete) throw new Error("delete failure");
  };
  generateMipmap = (): void => undefined;
  pixelStorei = (): void => undefined;
  texImage2D = (): void => {
    if (this.failUpload) {
      this.failUpload = false;
      throw new Error("upload failure");
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

describe("ordinary texture GPU arena", () => {
  it("creates idempotently, reports count, and rejects generation mismatch", () => {
    const { arena } = setup();
    const first = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    expect(ensureOrdinaryTextureGpuResource(arena, "a", 1)).toBe(first);
    expect(ordinaryTextureGpuResource(arena, "a")).toBe(first);
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(1);
    expect(() => ensureOrdinaryTextureGpuResource(arena, "a", 2)).toThrow(/stale context generation/);
  });

  it("uploads at most one success per frame and leaves a sticky wake for remaining work", () => {
    const { arena, gl } = setup();
    const first = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    const second = ensureOrdinaryTextureGpuResource(arena, "b", 1);
    queueOrdinaryTextureUpload(arena, first, { source: source(1), texture });
    queueOrdinaryTextureUpload(arena, second, { source: source(2), texture });
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
    processOrdinaryTextureUploads(arena, 4, 1);
    expect(gl.uploads).toHaveLength(1);
    expect(ordinaryTextureGpuHasPendingUploads(arena)).toBe(true);
    expect(consumeOrdinaryTextureGpuWake(arena)).toBe(true);
    processOrdinaryTextureUploads(arena, 4, 1);
    expect(gl.uploads).toHaveLength(1);
    processOrdinaryTextureUploads(arena, 5, 1);
    expect(gl.uploads).toHaveLength(2);
  });

  it("keeps a failed upload on the same handle and queue row for retry", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    consumeOrdinaryTextureGpuWake(arena);
    gl.failUpload = true;
    expect(() => processOrdinaryTextureUploads(arena, 1, 1)).toThrow(/upload failure/);
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

  it("coalesces pending replacement without double upload", () => {
    const { arena, gl } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    const oldSource = source(1);
    const nextSource = source(2);
    queueOrdinaryTextureUpload(arena, resource, { source: oldSource, texture });
    discardOrdinaryTexturePendingUpload(arena, resource);
    queueOrdinaryTextureUpload(arena, resource, { source: nextSource, texture });
    processOrdinaryTextureUploads(arena, 1, 1);
    processOrdinaryTextureUploads(arena, 2, 1);
    expect(gl.uploads).toHaveLength(1);
    expect(ordinaryTextureGpuOutcome(arena, 0)).toMatchObject({ kind: "discarded" });
    expect(ordinaryTextureGpuOutcome(arena, 1)).toMatchObject({ kind: "completed" });
  });

  it("discards stale generation rows without consuming upload budget", () => {
    const { arena, gl } = setup();
    const stale = ensureOrdinaryTextureGpuResource(arena, "stale", 1);
    const current = ensureOrdinaryTextureGpuResource(arena, "current", 2);
    queueOrdinaryTextureUpload(arena, stale, { source: source(1), texture });
    queueOrdinaryTextureUpload(arena, current, { source: source(2), texture });
    processOrdinaryTextureUploads(arena, 1, 2);
    expect(gl.uploads).toEqual([(current.texture as unknown as Handle).serial]);
    expect(ordinaryTextureGpuOutcome(arena, 0)?.kind).toBe("discarded");
    expect(ordinaryTextureGpuOutcome(arena, 1)?.kind).toBe("completed");
  });

  it("publishes a pending source and forgets the map before a release delete failure", () => {
    const { arena, gl, handles } = setup();
    const resource = ensureOrdinaryTextureGpuResource(arena, "a", 1);
    queueOrdinaryTextureUpload(arena, resource, { source: source(1), texture });
    gl.failDelete = true;
    expect(releaseOrdinaryTextureGpuResource(arena, "a").releaseError).toEqual(
      expect.objectContaining({ message: "delete failure" }),
    );
    expect(ordinaryTextureGpuResourceCount(arena)).toBe(0);
    expect(ordinaryTextureGpuOutcome(arena, 0)?.kind).toBe("discarded");
    expect(ownsTexture(handles, resource.texture)).toBe(true);
    gl.failDelete = false;
    releaseOwnedTexture(handles, resource.texture);
  });

  it("drops a lost context without GL calls and publishes pending retention", () => {
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

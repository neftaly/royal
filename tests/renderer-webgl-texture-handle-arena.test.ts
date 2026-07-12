import { describe, expect, it } from "vitest";
import {
  createOwnedTexture,
  createTextureHandleArena,
  dropTextureHandleContext,
  ownsTexture,
  releaseOwnedTexture,
  releaseTextureHandleContextHandles,
  textureHandleArenaSnapshot,
} from "../packages/renderer-webgl/src/webgl/texture-handle-arena";

type Handle = { readonly serial: number };

class FakeGl {
  readonly deleted: Handle[] = [];
  readonly deleteFailures = new Set<number>();
  failCreate = false;
  #serial = 1;

  createTexture = (): WebGLTexture | null => {
    if (this.failCreate) return null;
    return { serial: this.#serial++ } as unknown as WebGLTexture;
  };

  deleteTexture = (texture: WebGLTexture): void => {
    const handle = texture as unknown as Handle;
    this.deleted.push(handle);
    if (this.deleteFailures.delete(handle.serial)) {
      throw new Error(`deleteTexture failure ${handle.serial}`);
    }
  };
}

const context = (gl: FakeGl): WebGL2RenderingContext => gl as unknown as WebGL2RenderingContext;

describe("texture handle arena", () => {
  it("publishes only successfully created owned handles", () => {
    const gl = new FakeGl();
    const arena = createTextureHandleArena(context(gl));
    gl.failCreate = true;
    expect(() => createOwnedTexture(arena)).toThrow(/texture creation failed/);
    expect(textureHandleArenaSnapshot(arena).ownedTextureCount).toBe(0);
    gl.failCreate = false;
    const texture = createOwnedTexture(arena);
    expect(ownsTexture(arena, texture)).toBe(true);
    expect(textureHandleArenaSnapshot(arena).ownedTextureCount).toBe(1);
  });

  it("releases owned handles once and ignores foreign handles", () => {
    const gl = new FakeGl();
    const arena = createTextureHandleArena(context(gl));
    const texture = createOwnedTexture(arena);
    const foreign = { serial: 99 } as unknown as WebGLTexture;
    releaseOwnedTexture(arena, foreign);
    expect(gl.deleted).toHaveLength(0);
    releaseOwnedTexture(arena, texture);
    releaseOwnedTexture(arena, texture);
    expect(gl.deleted).toEqual([{ serial: 1 }]);
    expect(ownsTexture(arena, texture)).toBe(false);
  });

  it("retains a handle when individual deletion fails so release can retry", () => {
    const gl = new FakeGl();
    const arena = createTextureHandleArena(context(gl));
    const texture = createOwnedTexture(arena);
    gl.deleteFailures.add(1);
    expect(() => releaseOwnedTexture(arena, texture)).toThrow(/deleteTexture failure 1/);
    expect(ownsTexture(arena, texture)).toBe(true);
    releaseOwnedTexture(arena, texture);
    expect(ownsTexture(arena, texture)).toBe(false);
    expect(gl.deleted).toEqual([{ serial: 1 }, { serial: 1 }]);
  });

  it("attempts every active handle and retains only failed deletions", () => {
    const gl = new FakeGl();
    const arena = createTextureHandleArena(context(gl));
    createOwnedTexture(arena);
    createOwnedTexture(arena);
    createOwnedTexture(arena);
    gl.deleteFailures.add(2);
    expect(() => releaseTextureHandleContextHandles(arena)).toThrow(/deleteTexture failure 2/);
    expect(gl.deleted.map(({ serial }) => serial)).toEqual([1, 2, 3]);
    expect(textureHandleArenaSnapshot(arena).ownedTextureCount).toBe(1);
    releaseTextureHandleContextHandles(arena);
    expect(gl.deleted.map(({ serial }) => serial)).toEqual([1, 2, 3, 2]);
    expect(textureHandleArenaSnapshot(arena).ownedTextureCount).toBe(0);
  });

  it("forgets lost-context handles without issuing GL commands", () => {
    const gl = new FakeGl();
    const arena = createTextureHandleArena(context(gl));
    const first = createOwnedTexture(arena);
    const second = createOwnedTexture(arena);
    dropTextureHandleContext(arena);
    expect(gl.deleted).toHaveLength(0);
    expect(ownsTexture(arena, first)).toBe(false);
    expect(ownsTexture(arena, second)).toBe(false);
    expect(textureHandleArenaSnapshot(arena).ownedTextureCount).toBe(0);
  });
});

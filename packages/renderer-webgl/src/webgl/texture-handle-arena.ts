declare const authority: unique symbol;

/** Explicit authority over the renderer's generic WebGL texture handles. */
export interface TextureHandleArena {
  readonly [authority]: "TextureHandleArena";
}

export interface TextureHandleArenaSnapshot {
  readonly ownedTextureCount: number;
}

type State = {
  readonly gl: WebGL2RenderingContext;
  readonly ownedTextures: Set<WebGLTexture>;
};

export const createTextureHandleArena = (
  gl: WebGL2RenderingContext,
): TextureHandleArena => ({
  gl,
  ownedTextures: new Set(),
} as unknown as TextureHandleArena);

export const createOwnedTexture = (arena: TextureHandleArena): WebGLTexture => {
  const state = arena as unknown as State;
  const texture = state.gl.createTexture();
  if (texture === null) throw new Error("WebGL texture creation failed");
  state.ownedTextures.add(texture);
  return texture;
};

export const ownsTexture = (
  arena: TextureHandleArena,
  texture: WebGLTexture,
): boolean => (arena as unknown as State).ownedTextures.has(texture);

export const releaseOwnedTexture = (
  arena: TextureHandleArena,
  texture: WebGLTexture,
): void => {
  const state = arena as unknown as State;
  if (!state.ownedTextures.has(texture)) return;
  state.gl.deleteTexture(texture);
  state.ownedTextures.delete(texture);
};

export const releaseTextureHandleContextHandles = (
  arena: TextureHandleArena,
): void => {
  const state = arena as unknown as State;
  let error: unknown;
  for (const texture of Array.from(state.ownedTextures)) {
    try {
      releaseOwnedTexture(arena, texture);
    } catch (caught) {
      error ??= caught;
    }
  }
  if (error !== undefined) throw error;
};

export const dropTextureHandleContext = (arena: TextureHandleArena): void => {
  (arena as unknown as State).ownedTextures.clear();
};

export const textureHandleArenaSnapshot = (
  arena: TextureHandleArena,
): TextureHandleArenaSnapshot => ({
  ownedTextureCount: (arena as unknown as State).ownedTextures.size,
});

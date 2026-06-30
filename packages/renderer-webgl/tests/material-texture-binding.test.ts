import {
  solidTexture,
  textureAsset,
} from "@royal/renderer-core";
import { describe, expect, it, vi } from "vitest";
import type { RendererWebGlContext } from "../src/gl";
import {
  bindMaterialBaseColor,
  lowerMaterialBaseColorBinding,
} from "../src/material-texture-binding";
import type { TextureAssetLoadResult } from "../src/texture-cache";

type UniformCall = {
  readonly name: string;
  readonly value: number | readonly number[];
};

const uniform = (name: string): WebGLUniformLocation =>
  ({ name }) as unknown as WebGLUniformLocation;

const uniformName = (location: WebGLUniformLocation): string =>
  (location as unknown as { readonly name: string }).name;

const baseColorUniforms = () => ({
  baseColor: uniform("baseColor"),
  color: uniform("color"),
  useBaseColorTexture: uniform("useBaseColorTexture"),
});

const fakeGl = (): {
  readonly activeTextureUnits: number[];
  readonly boundTextures: (WebGLTexture | null)[];
  readonly gl: RendererWebGlContext;
  readonly uniformCalls: UniformCall[];
} => {
  const activeTextureUnits: number[] = [];
  const boundTextures: (WebGLTexture | null)[] = [];
  const uniformCalls: UniformCall[] = [];
  const gl = {
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    activeTexture(unit: number) {
      activeTextureUnits.push(unit);
    },
    bindTexture(_target: GLenum, texture: WebGLTexture | null) {
      boundTextures.push(texture);
    },
    uniform1i(location: WebGLUniformLocation, value: number) {
      uniformCalls.push({ name: uniformName(location), value });
    },
    uniform4fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
  } as unknown as RendererWebGlContext;

  return { activeTextureUnits, boundTextures, gl, uniformCalls };
};

describe("lowerMaterialBaseColorBinding", () => {
  it("preserves solid texture identity", () => {
    const source = solidTexture({
      color: [0.2, 0.3, 0.4, 1],
      colorSpace: "linear",
      id: "paint",
      revision: 2,
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toEqual({
      color: [0.2, 0.3, 0.4, 1],
      kind: "solid",
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).not.toHaveBeenCalled();
  });

  it("preserves asset texture identity and load state", () => {
    const source = textureAsset({
      colorSpace: "srgb",
      fallback: solidTexture({ color: [0.1, 0.2, 0.3, 1] }),
      id: "crate-base-color",
      revision: "b",
      sampler: {
        magFilter: "nearest",
        minFilter: "linear-mipmap-linear",
        wrapS: "repeat",
        wrapT: "clamp-to-edge",
      },
      uri: "https://example.test/crate.png",
    });
    const load = {
      kind: "ready",
      texture: {} as WebGLTexture,
    } satisfies TextureAssetLoadResult;
    const onTextureSettled = vi.fn();
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => load),
    };

    const binding = lowerMaterialBaseColorBinding(source, {
      onTextureSettled,
      textureCache,
    });

    expect(binding).toEqual({
      fallbackColor: [0.1, 0.2, 0.3, 1],
      kind: "asset",
      load,
      source,
    });
    expect(textureCache.loadTextureAssetBaseColor).toHaveBeenCalledWith(
      source,
      onTextureSettled,
    );
  });

  it("uses white as the asset fallback color when none is declared", () => {
    const source = textureAsset({
      id: "albedo",
      uri: "https://example.test/albedo.png",
    });
    const textureCache = {
      loadTextureAssetBaseColor: vi.fn(() => ({ kind: "loading" } as const)),
    };

    const binding = lowerMaterialBaseColorBinding(source, { textureCache });

    expect(binding).toMatchObject({
      fallbackColor: [1, 1, 1, 1],
      kind: "asset",
      source,
    });
  });
});

describe("bindMaterialBaseColor", () => {
  it("binds a ready asset texture to the selected texture unit", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const texture = {} as WebGLTexture;
    const source = textureAsset({
      id: "crate",
      uri: "https://example.test/crate.png",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [1, 1, 1, 1],
        kind: "asset",
        load: { kind: "ready", texture },
        source,
      },
      2,
    );

    expect(activeTextureUnits).toEqual([gl.TEXTURE0 + 2]);
    expect(boundTextures).toEqual([texture]);
    expect(uniformCalls).toEqual([
      { name: "baseColor", value: 2 },
      { name: "useBaseColorTexture", value: 1 },
    ]);
  });

  it("binds the fallback color while an asset texture is unavailable", () => {
    const { activeTextureUnits, boundTextures, gl, uniformCalls } = fakeGl();
    const source = textureAsset({
      id: "crate",
      uri: "https://example.test/crate.png",
    });

    bindMaterialBaseColor(
      gl,
      baseColorUniforms(),
      {
        fallbackColor: [0.2, 0.4, 0.6, 1],
        kind: "asset",
        load: { kind: "loading" },
        source,
      },
    );

    expect(activeTextureUnits).toEqual([]);
    expect(boundTextures).toEqual([]);
    expect(uniformCalls).toEqual([
      { name: "color", value: [0.2, 0.4, 0.6, 1] },
      { name: "useBaseColorTexture", value: 0 },
    ]);
  });
});

import {
  boxGeometry,
  mesh,
  solidTexture,
  textureAsset,
  unlitMaterial,
} from "@royal/renderer-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawMesh } from "../src/draw";
import { GeometryCache } from "../src/geometry-cache";
import type { RendererWebGlContext } from "../src/gl";
import { identity } from "../src/matrix";
import type { MeshProgram } from "../src/programs";
import { TextureCache } from "../src/texture-cache";

type UniformCall = {
  readonly name: string;
  readonly value: number | readonly number[];
};

type BoundTexture = {
  readonly id: number;
};

const uniform = (name: string): WebGLUniformLocation =>
  ({ name }) as unknown as WebGLUniformLocation;

const meshProgram = (): MeshProgram => ({
  attributes: {
    normal: 1,
    position: 0,
  },
  program: {} as WebGLProgram,
  uniforms: {
    baseColor: uniform("baseColor"),
    boxSize: uniform("boxSize"),
    color: uniform("color"),
    lightColor: uniform("lightColor"),
    lightDirection: uniform("lightDirection"),
    model: uniform("model"),
    unlit: uniform("unlit"),
    useVirtualTexture: uniform("useVirtualTexture"),
    useBaseColorTexture: uniform("useBaseColorTexture"),
    viewProjection: uniform("viewProjection"),
    virtualAtlas: uniform("virtualAtlas"),
    virtualBorderTexels: uniform("virtualBorderTexels"),
    virtualMip: uniform("virtualMip"),
    virtualPaddedPageSize: uniform("virtualPaddedPageSize"),
    virtualPageSize: uniform("virtualPageSize"),
    virtualPageTable: uniform("virtualPageTable"),
    virtualPageTableSize: uniform("virtualPageTableSize"),
    virtualPhysicalAtlasSize: uniform("virtualPhysicalAtlasSize"),
  },
});

const uniformName = (location: WebGLUniformLocation): string =>
  (location as unknown as { readonly name: string }).name;

const fakeGl = (): {
  readonly boundTextures: BoundTexture[];
  readonly counts: { readonly drawElements: number };
  readonly gl: RendererWebGlContext;
  readonly uniformCalls: UniformCall[];
} => {
  let drawElements = 0;
  let textureId = 0;
  const boundTextures: BoundTexture[] = [];
  const uniformCalls: UniformCall[] = [];

  const gl = {
    ARRAY_BUFFER: 0x8892,
    CLAMP_TO_EDGE: 0x812F,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    FLOAT: 0x1406,
    LINEAR: 0x2601,
    LINEAR_MIPMAP_LINEAR: 0x2703,
    LINEAR_MIPMAP_NEAREST: 0x2701,
    MIRRORED_REPEAT: 0x8370,
    NEAREST: 0x2600,
    NEAREST_MIPMAP_LINEAR: 0x2702,
    NEAREST_MIPMAP_NEAREST: 0x2700,
    REPEAT: 0x2901,
    RGBA: 0x1908,
    STATIC_DRAW: 0x88E4,
    TEXTURE0: 0x84C0,
    TEXTURE_2D: 0x0DE1,
    TEXTURE_MAG_FILTER: 0x2800,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    TRIANGLES: 0x0004,
    UNPACK_FLIP_Y_WEBGL: 0x9240,
    UNSIGNED_BYTE: 0x1401,
    UNSIGNED_SHORT: 0x1403,
    activeTexture() {},
    bindBuffer() {},
    bindTexture(_target: GLenum, texture: WebGLTexture | null) {
      if (texture !== null) boundTextures.push(texture as unknown as BoundTexture);
    },
    bufferData() {},
    createBuffer: () => ({} as WebGLBuffer),
    createTexture: () => {
      textureId += 1;
      return { id: textureId } as unknown as WebGLTexture;
    },
    deleteTexture() {},
    drawElements() {
      drawElements += 1;
    },
    enableVertexAttribArray() {},
    generateMipmap() {},
    pixelStorei() {},
    texImage2D() {},
    texParameteri() {},
    uniform1i(location: WebGLUniformLocation, value: number) {
      uniformCalls.push({ name: uniformName(location), value });
    },
    uniform3fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
    uniform4fv(location: WebGLUniformLocation, value: Float32List) {
      uniformCalls.push({ name: uniformName(location), value: Array.from(value) });
    },
    uniformMatrix4fv() {},
    useProgram() {},
    vertexAttribPointer() {},
  } as unknown as RendererWebGlContext;

  return {
    boundTextures,
    counts: {
      get drawElements() {
        return drawElements;
      },
    },
    gl,
    uniformCalls,
  };
};

const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for condition");
};

const drawTexturedBox = (
  gl: RendererWebGlContext,
  textureCache: TextureCache,
  onTextureSettled = (): void => undefined,
): void => {
  drawMesh(
    gl,
    { mesh: meshProgram() },
    mesh({
      geometry: boxGeometry({ size: [2, 2, 2] }),
      material: unlitMaterial({
        texture: textureAsset({
          fallback: solidTexture({ color: [0.2, 0.4, 0.6, 1] }),
          id: "crate",
          uri: "https://example.test/crate.png",
        }),
      }),
    }),
    {
      directionalLight: undefined,
      geometryCache: new GeometryCache(gl),
      onTextureSettled,
      textureCache,
      viewProjectionMatrix: identity(),
    },
  );
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("drawMesh textureAsset baseColor", () => {
  it("draws a textured mesh with fallback color while the asset is loading", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
    const { counts, gl, uniformCalls } = fakeGl();
    const textureCache = new TextureCache(gl);

    drawTexturedBox(gl, textureCache);

    expect(fetch).toHaveBeenCalledWith("https://example.test/crate.png");
    expect(counts.drawElements).toBe(1);
    expect(uniformCalls).toContainEqual({ name: "useBaseColorTexture", value: 0 });
    expect(uniformCalls).toContainEqual({ name: "color", value: [0.2, 0.4, 0.6, 1] });
  });

  it("keeps drawing the fallback color after an asset load error", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 404 }))));
    const onTextureSettled = vi.fn();
    const { counts, gl, uniformCalls } = fakeGl();
    const textureCache = new TextureCache(gl);

    drawTexturedBox(gl, textureCache, onTextureSettled);
    await waitFor(() => onTextureSettled.mock.calls.length === 1);
    drawTexturedBox(gl, textureCache, onTextureSettled);

    expect(counts.drawElements).toBe(2);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(uniformCalls.filter((call) => call.name === "color").at(-1)).toEqual({
      name: "color",
      value: [0.2, 0.4, 0.6, 1],
    });
    expect(uniformCalls).toContainEqual({ name: "useBaseColorTexture", value: 0 });
  });

  it("binds the loaded texture on later draws", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(new Blob(["image"])))));
    vi.stubGlobal("createImageBitmap", vi.fn(() =>
      Promise.resolve({ height: 4, width: 4 } as ImageBitmap)
    ));
    const onTextureSettled = vi.fn();
    const { boundTextures, counts, gl, uniformCalls } = fakeGl();
    const textureCache = new TextureCache(gl);

    drawTexturedBox(gl, textureCache, onTextureSettled);
    await waitFor(() => onTextureSettled.mock.calls.length === 1);
    drawTexturedBox(gl, textureCache, onTextureSettled);

    expect(counts.drawElements).toBe(2);
    expect(boundTextures).toContainEqual({ id: 1 });
    expect(uniformCalls).toContainEqual({ name: "baseColor", value: 0 });
    expect(uniformCalls).toContainEqual({ name: "useBaseColorTexture", value: 1 });
  });

  it("falls back to HTMLImageElement decoding when createImageBitmap rejects SVG blobs", async () => {
    class FakeImage {
      decoding = "auto";
      height = 16;
      naturalHeight = 16;
      naturalWidth = 16;
      onerror: (() => void) | null = null;
      onload: (() => void) | null = null;
      width = 16;
      #src = "";

      get src(): string {
        return this.#src;
      }

      set src(value: string) {
        this.#src = value;
        queueMicrotask(() => this.onload?.());
      }
    }

    const objectUrl = "blob:https://example.test/svg";
    vi.stubGlobal("fetch", vi.fn(() =>
      Promise.resolve(new Response(new Blob(["<svg />"], { type: "image/svg+xml" })))
    ));
    vi.stubGlobal("createImageBitmap", vi.fn(() =>
      Promise.reject(new Error("SVG decode unsupported"))
    ));
    vi.stubGlobal("Image", FakeImage);
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({
        getContext: vi.fn(() => ({
          drawImage: vi.fn(),
        })),
        height: 0,
        width: 0,
      })),
    });
    vi.spyOn(URL, "createObjectURL").mockReturnValue(objectUrl);
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    const onTextureSettled = vi.fn();
    const { boundTextures, counts, gl, uniformCalls } = fakeGl();
    const textureCache = new TextureCache(gl);

    drawTexturedBox(gl, textureCache, onTextureSettled);
    await waitFor(() => onTextureSettled.mock.calls.length === 1);
    drawTexturedBox(gl, textureCache, onTextureSettled);

    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(objectUrl);
    expect(counts.drawElements).toBe(2);
    expect(boundTextures).toContainEqual({ id: 1 });
    expect(uniformCalls).toContainEqual({ name: "baseColor", value: 0 });
    expect(uniformCalls).toContainEqual({ name: "useBaseColorTexture", value: 1 });
  });
});

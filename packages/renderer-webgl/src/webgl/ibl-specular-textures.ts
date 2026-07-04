import {
  isDecodedRgbaTexture,
  isPowerOfTwo,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "../texture-sources";
import type { SurfaceImageBasedLightSpecular } from "./lights";
import { IBL_SPECULAR_TEXTURE_UNIT } from "./ibl-uniforms";

export type IblSpecularTextureResource = {
  readonly imageSize: number;
  readonly key: string;
  readonly mipCount: number;
  readonly sources: Map<string, LoadedTextureSource>;
  readonly texture: WebGLTexture;
  uploaded: boolean;
};

export type IblSpecularTextureContext = {
  readonly createTexture: () => WebGLTexture;
  readonly gl: WebGL2RenderingContext;
  readonly isDisposed: () => boolean;
  readonly isTextureOwned: (texture: WebGLTexture) => boolean;
  readonly recordUnsupportedGltfImageBasedLight: (message: string) => void;
  readonly textures: Map<string, IblSpecularTextureResource>;
};

export const ensureIblSpecularTexture = (
  context: IblSpecularTextureContext,
  specular: SurfaceImageBasedLightSpecular,
): IblSpecularTextureResource => {
  const existing = context.textures.get(specular.key);
  if (existing !== undefined) {
    uploadIblSpecularTextureIfReady(context, specular, existing);
    return existing;
  }

  const resource: IblSpecularTextureResource = {
    imageSize: specular.imageSize,
    key: specular.key,
    mipCount: specular.imageLoadKeys.length,
    sources: new Map(),
    texture: context.createTexture(),
    uploaded: false,
  };
  context.textures.set(specular.key, resource);
  uploadIblSpecularTextureIfReady(context, specular, resource);
  return resource;
};

export const settleIblSpecularImage = (
  context: IblSpecularTextureContext,
  specular: SurfaceImageBasedLightSpecular,
  key: string,
  image: LoadedTextureSource,
): void => {
  if (!specular.imageLoadKeys.some((mip) => mip.includes(key))) return;
  const resource = ensureIblSpecularTexture(context, specular);
  resource.sources.set(key, image);
  if (resource.uploaded) resource.uploaded = false;
  uploadIblSpecularTextureIfReady(context, specular, resource);
};

export const uploadIblSpecularTextureIfReady = (
  context: IblSpecularTextureContext,
  specular: SurfaceImageBasedLightSpecular,
  resource: IblSpecularTextureResource,
): void => {
  if (resource.uploaded || context.isDisposed() || !context.isTextureOwned(resource.texture)) return;

  const sources = specular.imageLoadKeys.map((mip) =>
    mip.map((key) => resource.sources.get(key)));
  if (sources.some((mip) => mip.some((source) => source === undefined))) return;

  const gl = context.gl;
  gl.activeTexture(gl.TEXTURE0 + IBL_SPECULAR_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, resource.texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

  for (const [mipIndex, mipSources] of sources.entries()) {
    const expectedSize = Math.max(1, specular.imageSize >> mipIndex);
    for (const [faceIndex, source] of mipSources.entries()) {
      if (source === undefined) return;
      const [width, height] = loadedTextureSourceSize(source);
      if (width !== height || width !== expectedSize || !isPowerOfTwo(width)) {
        context.recordUnsupportedGltfImageBasedLight(
          `glTF EXT_lights_image_based specular cubemap ${specular.key} mip ${mipIndex} face ${faceIndex} has ${width}x${height}; expected ${expectedSize}x${expectedSize}.`,
        );
        return;
      }
      const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex;
      if (isDecodedRgbaTexture(source)) {
        gl.texImage2D(target, mipIndex, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, source.data);
      } else {
        gl.texImage2D(target, mipIndex, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
    }
  }

  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(
    gl.TEXTURE_CUBE_MAP,
    gl.TEXTURE_MIN_FILTER,
    resource.mipCount > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, resource.mipCount - 1);
  resource.uploaded = true;
};

export const createFallbackIblSpecularTexture = (
  context: Pick<IblSpecularTextureContext, "createTexture" | "gl">,
): WebGLTexture => {
  const gl = context.gl;
  const texture = context.createTexture();
  gl.activeTexture(gl.TEXTURE0 + IBL_SPECULAR_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, 1, gl.RGBA8, 1, 1);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, 0);

  return texture;
};

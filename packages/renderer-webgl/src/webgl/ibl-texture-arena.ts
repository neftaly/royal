import {
  isDecodedRgbaTexture,
  isPowerOfTwo,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "../texture-sources";
import { identityMat4 } from "../math/mat4";
import { uploadIblBrdfLutTexture } from "./ibl-brdf-lut";
import { prepareTextureUpload } from "./imperative-state";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./lights";
import {
  uniform1i,
  uniformColor,
  uniformMatrix,
  type ProgramArena,
} from "./program-arena";
import {
  STUDIO_ENVIRONMENT_SPECULAR_KEY,
  uploadStudioEnvironmentSpecularTexture,
  type StudioEnvironmentSpecularResource,
} from "./studio-environment";

export const IBL_SPECULAR_TEXTURE_UNIT = 2;
const IBL_IRRADIANCE_COEFFICIENT_COUNT = 9;

export interface IblSpecularTextureResource {
  readonly imageSize: number;
  readonly key: string;
  readonly mipCount: number;
  readonly texture: WebGLTexture;
  uploadError?: unknown;
  unsupportedMessage?: string;
  uploaded: boolean;
}

export interface IblTextureArenaSnapshot {
  readonly brdfLut: boolean;
  readonly gltfSpecularCount: number;
  readonly ownedTextureCount: number;
  readonly studioSpecular: boolean;
}

declare const authority: unique symbol;
export interface IblTextureArena { readonly [authority]: "IblTextureArena" }

type State = {
  brdfLut?: WebGLTexture;
  readonly gl: WebGL2RenderingContext;
  readonly gltfSpecular: Map<string, IblSpecularTextureResource & {
    readonly encoding: SurfaceImageBasedLightSpecular["encoding"];
    readonly imageLoadKeys: SurfaceImageBasedLightSpecular["imageLoadKeys"];
  }>;
  readonly ownedTextures: Set<WebGLTexture>;
  studio?: StudioEnvironmentSpecularResource;
};

export const createIblTextureArena = (gl: WebGL2RenderingContext): IblTextureArena => ({
  gl,
  gltfSpecular: new Map(),
  ownedTextures: new Set(),
} as unknown as IblTextureArena);

const createTexture = (state: State): WebGLTexture => {
  const texture = state.gl.createTexture();
  if (texture === null) throw new Error("WebGL texture creation failed");
  state.ownedTextures.add(texture);
  return texture;
};

const deleteTexture = (state: State, texture: WebGLTexture): void => {
  if (!state.ownedTextures.has(texture)) return;
  state.gl.deleteTexture(texture);
  state.ownedTextures.delete(texture);
};

const rollbackTexture = (state: State, texture: WebGLTexture): void => {
  try { deleteTexture(state, texture); } catch { /* Retain failed deletes for context release retry. */ }
};

const uploadGltfSpecularIfReady = (
  state: State,
  specular: SurfaceImageBasedLightSpecular,
  resource: IblSpecularTextureResource,
  sources: ReadonlyMap<string, LoadedTextureSource>,
): string | undefined => {
  if (resource.uploaded || !state.ownedTextures.has(resource.texture)) return undefined;
  for (const mip of specular.imageLoadKeys) {
    if (mip.length !== 6) {
      return `glTF EXT_lights_image_based specular cubemap ${specular.key} must provide 6 faces per mip.`;
    }
    for (const key of mip) if (sources.get(key) === undefined) return undefined;
  }
  for (let mipIndex = 0; mipIndex < specular.imageLoadKeys.length; mipIndex += 1) {
    const expectedSize = Math.max(1, specular.imageSize >> mipIndex);
    const mipKeys = specular.imageLoadKeys[mipIndex]!;
    for (let faceIndex = 0; faceIndex < mipKeys.length; faceIndex += 1) {
      const source = sources.get(mipKeys[faceIndex]!);
      if (source === undefined) return undefined;
      const [width, height] = loadedTextureSourceSize(source);
      if (width !== height || width !== expectedSize || !isPowerOfTwo(width)) {
        return `glTF EXT_lights_image_based specular cubemap ${specular.key} mip ${mipIndex} face ${faceIndex} has ${width}x${height}; expected ${expectedSize}x${expectedSize}.`;
      }
    }
  }

  const gl = state.gl;
  prepareTextureUpload(gl, false);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, resource.texture);
  for (let mipIndex = 0; mipIndex < specular.imageLoadKeys.length; mipIndex += 1) {
    const mipKeys = specular.imageLoadKeys[mipIndex]!;
    for (let faceIndex = 0; faceIndex < mipKeys.length; faceIndex += 1) {
      const source = sources.get(mipKeys[faceIndex]!)!;
      const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex;
      if (isDecodedRgbaTexture(source)) {
        gl.texImage2D(
          target, mipIndex, gl.RGBA, source.width, source.height, 0,
          gl.RGBA, gl.UNSIGNED_BYTE, source.data,
        );
      } else gl.texImage2D(target, mipIndex, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
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
  return undefined;
};

const imageLoadKeysMatch = (
  left: SurfaceImageBasedLightSpecular["imageLoadKeys"],
  right: SurfaceImageBasedLightSpecular["imageLoadKeys"],
): boolean => {
  if (left.length !== right.length) return false;
  for (let mipIndex = 0; mipIndex < left.length; mipIndex += 1) {
    const leftMip = left[mipIndex]!;
    const rightMip = right[mipIndex]!;
    if (leftMip.length !== rightMip.length) return false;
    for (let faceIndex = 0; faceIndex < leftMip.length; faceIndex += 1) {
      if (leftMip[faceIndex] !== rightMip[faceIndex]) return false;
    }
  }
  return true;
};

export const ensureGltfIblSpecularTexture = (
  arena: IblTextureArena,
  specular: SurfaceImageBasedLightSpecular,
  sources: ReadonlyMap<string, LoadedTextureSource>,
): IblSpecularTextureResource => {
  const state = arena as unknown as State;
  let resource = state.gltfSpecular.get(specular.key);
  if (resource === undefined) {
    resource = {
      encoding: specular.encoding,
      imageSize: specular.imageSize,
      imageLoadKeys: specular.imageLoadKeys,
      key: specular.key,
      mipCount: specular.imageLoadKeys.length,
      texture: createTexture(state),
      uploaded: false,
    };
    state.gltfSpecular.set(specular.key, resource);
  } else if (
    resource.encoding !== specular.encoding
    || resource.imageSize !== specular.imageSize
    || resource.imageLoadKeys.length !== specular.imageLoadKeys.length
    || (resource.imageLoadKeys !== specular.imageLoadKeys && !imageLoadKeysMatch(
      resource.imageLoadKeys,
      specular.imageLoadKeys,
    ))
  ) {
    resource.unsupportedMessage = `glTF EXT_lights_image_based specular cubemap ${specular.key} changed its image layout.`;
    delete resource.uploadError;
    resource.uploaded = false;
    return resource;
  }
  delete resource.unsupportedMessage;
  delete resource.uploadError;
  if (resource.uploaded) return resource;
  try {
    const unsupportedMessage = uploadGltfSpecularIfReady(state, specular, resource, sources);
    if (unsupportedMessage !== undefined) resource.unsupportedMessage = unsupportedMessage;
  } catch (uploadError) {
    resource.uploadError = uploadError;
  }
  return resource;
};

export const releaseGltfIblSpecularTexture = (arena: IblTextureArena, key: string): void => {
  const state = arena as unknown as State;
  const resource = state.gltfSpecular.get(key);
  state.gltfSpecular.delete(key);
  if (resource !== undefined) deleteTexture(state, resource.texture);
};

export const markGltfIblSpecularTextureDirty = (arena: IblTextureArena, key: string): void => {
  const resource = (arena as unknown as State).gltfSpecular.get(key);
  if (resource !== undefined) resource.uploaded = false;
};

export const ensureStudioEnvironmentSpecularTexture = (
  arena: IblTextureArena,
): StudioEnvironmentSpecularResource => {
  const state = arena as unknown as State;
  if (state.studio !== undefined) return state.studio;
  const texture = createTexture(state);
  try {
    const resource = uploadStudioEnvironmentSpecularTexture(state.gl, texture);
    state.studio = resource;
    return resource;
  } catch (error) {
    rollbackTexture(state, texture);
    throw error;
  }
};

const ensureBrdfLut = (state: State): WebGLTexture => {
  if (state.brdfLut !== undefined) return state.brdfLut;
  const texture = createTexture(state);
  try {
    uploadIblBrdfLutTexture(state.gl, texture);
    state.brdfLut = texture;
    return texture;
  } catch (error) {
    rollbackTexture(state, texture);
    throw error;
  }
};

export const bindSurfaceIbl = (
  arena: IblTextureArena,
  programArena: ProgramArena,
  program: WebGLProgram,
  lightSet: SurfaceLightSet,
  brdfLutTextureUnit: number | undefined,
): void => {
  const state = arena as unknown as State;
  const irradiance = lightSet.irradiance;
  uniform1i(programArena, program, "u_useIblIrradiance", irradiance === undefined ? 0 : 1);
  uniformColor(programArena, program, "u_iblIrradianceSettings", [
    irradiance === undefined ? 0 : 1, irradiance?.intensity ?? 1, 0, 0,
  ]);
  uniformMatrix(programArena, program, "u_iblWorldToIbl", irradiance?.worldToIbl ?? identityMat4());
  const specular = lightSet.specular;
  uniform1i(programArena, program, "u_useIblSpecular", specular === undefined ? 0 : 1);
  uniformColor(programArena, program, "u_iblSpecularSettings", [
    specular === undefined ? 0 : 1,
    specular?.intensity ?? 1,
    specular?.mipCount ?? 1,
    specular?.encoding === "rgbd" ? 1 : 0,
  ]);
  if (specular !== undefined) {
    state.gl.activeTexture(state.gl.TEXTURE0 + IBL_SPECULAR_TEXTURE_UNIT);
    state.gl.bindTexture(state.gl.TEXTURE_CUBE_MAP, specular.texture);
    uniform1i(programArena, program, "u_iblSpecularCube", IBL_SPECULAR_TEXTURE_UNIT);
  }
  const brdfLut = specular === undefined || brdfLutTextureUnit === undefined
    ? undefined
    : ensureBrdfLut(state);
  uniform1i(programArena, program, "u_useIblBrdfLut", brdfLut === undefined ? 0 : 1);
  if (brdfLut !== undefined && brdfLutTextureUnit !== undefined) {
    state.gl.activeTexture(state.gl.TEXTURE0 + brdfLutTextureUnit);
    state.gl.bindTexture(state.gl.TEXTURE_2D, brdfLut);
    uniform1i(programArena, program, "u_iblBrdfLut", brdfLutTextureUnit);
  }
  for (let index = 0; index < IBL_IRRADIANCE_COEFFICIENT_COUNT; index += 1) {
    const coefficient = irradiance?.coefficients[index] ?? [0, 0, 0] as const;
    uniformColor(programArena, program, `u_iblIrradianceCoefficients[${index}]`, [
      coefficient[0], coefficient[1], coefficient[2], 0,
    ]);
  }
};

const clearPublished = (state: State): void => {
  delete state.brdfLut;
  delete state.studio;
  state.gltfSpecular.clear();
};

export const releaseIblTextureContextHandles = (arena: IblTextureArena): void => {
  const state = arena as unknown as State;
  clearPublished(state);
  let error: unknown;
  for (const texture of Array.from(state.ownedTextures)) {
    try { deleteTexture(state, texture); } catch (caught) { error ??= caught; }
  }
  if (error !== undefined) throw error;
};

export const dropIblTextureContext = (arena: IblTextureArena): void => {
  const state = arena as unknown as State;
  clearPublished(state);
  state.ownedTextures.clear();
};

export const iblTextureArenaSnapshot = (arena: IblTextureArena): IblTextureArenaSnapshot => {
  const state = arena as unknown as State;
  return {
    brdfLut: state.brdfLut !== undefined,
    gltfSpecularCount: state.gltfSpecular.size,
    ownedTextureCount: state.ownedTextures.size,
    studioSpecular: state.studio?.key === STUDIO_ENVIRONMENT_SPECULAR_KEY,
  };
};

export type { StudioEnvironmentSpecularResource } from "./studio-environment";
export { IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT } from "./ibl-brdf-lut";

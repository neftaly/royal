import {
  isDecodedCompressedTexture,
  isDecodedRgbaTexture,
  loadedTextureSourceSize,
  type LoadedTextureSource,
} from "../texture/sources";
import { captureFirstFailure, type CapturedFailure } from "../captured-failure";
import { IBL_BRDF_LUT_BYTES, uploadIblBrdfLutTexture } from "./ibl-brdf-lut";
import { prepareTextureUpload } from "./imperative-state";
import type { SurfaceImageBasedLightSpecular, SurfaceLightSet } from "./lights";
import type { PreparedRoyalEnvironment } from "../environment/royal-environment-ktx1";
import {
  uniform1i,
  uniform4f,
  type ProgramArena,
} from "./program-arena";
import { bindSurfaceIblIrradiance } from "./surface-ibl-uniforms";
import { WebGlTextureBindingShell } from "./texture-binding-shell";
import {
  STUDIO_ENVIRONMENT_SPECULAR_KEY,
  STUDIO_ENVIRONMENT_SPECULAR_GPU_BYTES,
  STUDIO_ENVIRONMENT_SPECULAR_UPLOAD_BYTES,
  uploadStudioEnvironmentSpecularTexture,
  type StudioEnvironmentSpecularResource,
} from "./studio-environment";

const MAX_WEBGL_GLSIZEI = 0x7fff_ffff;

interface IblSpecularTextureResourceBase {
  readonly imageSize: number;
  readonly key: string;
  readonly mipCount: number;
  uploadError?: unknown;
  uploadCursor: number;
  unsupportedMessage?: string;
}

export type IblSpecularTextureResource = IblSpecularTextureResourceBase & (
  | { readonly texture: WebGLTexture; uploaded: true }
  | { texture?: WebGLTexture; uploaded: false }
);

export interface IblTextureGpuLease { release(): void }
export interface IblTextureGpuReservation {
  cancel(): void;
  commit(): IblTextureGpuLease;
}
export interface IblTextureGpuDenial {
  readonly permanent: boolean;
  readonly reason: string;
}
export interface IblTextureGpuGovernor {
  reserve(cost: { readonly persistentGpuBytes: number; readonly uploadBytes: number }):
    IblTextureGpuDenial | IblTextureGpuReservation | undefined;
}

export interface IblTextureArenaSnapshot {
  readonly brdfLut: boolean;
  readonly gltfSpecularCount: number;
  readonly ownedTextureCount: number;
  readonly prefilteredSpecularCount: number;
  readonly retainedLeaseCount: number;
  readonly studioSpecular: boolean;
}

declare const authority: unique symbol;
export interface IblTextureArena { readonly [authority]: "IblTextureArena" }

type MutableIblSpecularTextureResource = IblSpecularTextureResourceBase & {
  readonly encoding: SurfaceImageBasedLightSpecular["encoding"];
  readonly imageLoadKeys: SurfaceImageBasedLightSpecular["imageLoadKeys"];
  texture?: WebGLTexture;
  uploadError?: unknown;
  unsupportedMessage?: string;
  uploaded: boolean;
};

type State = {
  brdfLut?: WebGLTexture;
  readonly diagnostics: string[];
  durablePressurePending: boolean;
  frameWakeRequested: boolean;
  readonly gl: WebGL2RenderingContext;
  readonly maxTextureImageUnits: number;
  readonly gltfSpecular: Map<string, MutableIblSpecularTextureResource>;
  readonly ownedTextures: Set<WebGLTexture>;
  readonly prefilteredSpecular: Map<string, MutableIblSpecularTextureResource>;
  readonly governor?: IblTextureGpuGovernor;
  readonly retiredGltfSpecular: Map<string, WebGLTexture>;
  readonly textureLeases: Map<WebGLTexture, IblTextureGpuLease>;
  readonly terminalDenials: Map<string, string>;
  studio?: StudioEnvironmentSpecularResource;
};

const maxTextureImageUnits = (gl: WebGL2RenderingContext): number => {
  const value: unknown = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`MAX_TEXTURE_IMAGE_UNITS must be a non-negative integer, received ${String(value)}`);
  }
  return value as number;
};

const assertTextureUnit = (state: State, unit: number, label: string): void => {
  if (!Number.isInteger(unit) || unit < 0 || unit >= state.maxTextureImageUnits) {
    throw new RangeError(
      `${label} texture unit must be an integer in [0, ${state.maxTextureImageUnits}), received ${unit}`,
    );
  }
};

export const createIblTextureArena = (
  gl: WebGL2RenderingContext,
  governor?: IblTextureGpuGovernor,
): IblTextureArena => ({
  diagnostics: [],
  durablePressurePending: false,
  frameWakeRequested: false,
  gl,
  gltfSpecular: new Map(),
  maxTextureImageUnits: maxTextureImageUnits(gl),
  ...(governor === undefined ? {} : { governor }),
    ownedTextures: new Set(),
    prefilteredSpecular: new Map(),
  retiredGltfSpecular: new Map(),
  textureLeases: new Map(),
  terminalDenials: new Map(),
} as unknown as IblTextureArena);

export type PrefilteredEnvironmentSpecularResource = IblSpecularTextureResource;

const NOOP_LEASE: IblTextureGpuLease = { release: () => undefined };
const NOOP_RESERVATION: IblTextureGpuReservation = {
  cancel: () => undefined,
  commit: () => NOOP_LEASE,
};

const reserve = (
  state: State,
  identity: string,
  persistentGpuBytes: number,
  uploadBytes: number,
): IblTextureGpuReservation | undefined => {
  if (state.terminalDenials.has(identity)) return undefined;
  if (state.governor === undefined) return NOOP_RESERVATION;
  const admission = state.governor.reserve({ persistentGpuBytes, uploadBytes });
  if (admission === undefined) {
    state.durablePressurePending = true;
    return undefined;
  }
  if (!("reason" in admission)) return admission;
  if (admission.permanent) {
    const message = `${identity} is disabled because its GPU request cannot fit the configured resource policy: ${admission.reason}`;
    state.terminalDenials.set(identity, message);
    state.diagnostics.push(message);
  } else if (admission.reason === "upload-capacity") {
    state.frameWakeRequested = true;
  } else {
    state.durablePressurePending = true;
  }
  return undefined;
};

const takeTerminalDiagnostic = (state: State, identity: string): string | undefined => {
  const message = state.terminalDenials.get(identity);
  if (message === undefined) return undefined;
  const diagnosticIndex = state.diagnostics.indexOf(message);
  if (diagnosticIndex >= 0) state.diagnostics.splice(diagnosticIndex, 1);
  return message;
};

const clearTerminalDenial = (state: State, identity: string): void => {
  const message = state.terminalDenials.get(identity);
  state.terminalDenials.delete(identity);
  if (message === undefined) return;
  const diagnosticIndex = state.diagnostics.indexOf(message);
  if (diagnosticIndex >= 0) state.diagnostics.splice(diagnosticIndex, 1);
};

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
  state.textureLeases.get(texture)?.release();
  state.textureLeases.delete(texture);
};

const rollbackTexture = (state: State, texture: WebGLTexture): void => {
  try { deleteTexture(state, texture); } catch { /* Retain failed deletes for context release retry. */ }
};

const createGovernedTexture = <Result>(
  state: State,
  identity: string,
  persistentGpuBytes: number,
  uploadBytes: number,
  upload: (texture: WebGLTexture) => Result,
): Result | undefined => {
  const reservation = reserve(state, identity, persistentGpuBytes, uploadBytes);
  if (reservation === undefined) return undefined;
  let texture: WebGLTexture;
  try {
    texture = createTexture(state);
  } catch (error) {
    reservation.cancel();
    throw error;
  }
  try {
    const result = upload(texture);
    state.textureLeases.set(texture, reservation.commit());
    return result;
  } catch (error) {
    state.textureLeases.set(texture, reservation.commit());
    rollbackTexture(state, texture);
    throw error;
  }
};

const uploadGltfSpecularIfReady = (
  state: State,
  specular: SurfaceImageBasedLightSpecular,
  resource: MutableIblSpecularTextureResource,
  sources: ReadonlyMap<string, LoadedTextureSource>,
): string | undefined => {
  if (resource.uploaded) return undefined;
  const imageSize = specular.imageSize;
  const imageSizeLog2 = Math.log2(imageSize);
  if (
    !Number.isSafeInteger(imageSize)
    || imageSize <= 0
    || imageSize > MAX_WEBGL_GLSIZEI
    || !Number.isInteger(imageSizeLog2)
  ) {
    return `glTF EXT_lights_image_based specular cubemap ${specular.key} has invalid image size ${imageSize}; expected a positive safe power-of-two WebGL dimension no greater than ${MAX_WEBGL_GLSIZEI}.`;
  }
  const maximumMipCount = imageSizeLog2 + 1;
  if (specular.imageLoadKeys.length === 0) {
    return `glTF EXT_lights_image_based specular cubemap ${specular.key} must provide at least one mip level.`;
  }
  if (specular.imageLoadKeys.length > maximumMipCount) {
    return `glTF EXT_lights_image_based specular cubemap ${specular.key} has ${specular.imageLoadKeys.length} mip levels; image size ${imageSize} supports at most ${maximumMipCount}.`;
  }
  for (const mip of specular.imageLoadKeys) {
    if (mip.length !== 6) {
      return `glTF EXT_lights_image_based specular cubemap ${specular.key} must provide 6 faces per mip.`;
    }
    for (const key of mip) if (sources.get(key) === undefined) return undefined;
  }
  for (let mipIndex = 0; mipIndex < specular.imageLoadKeys.length; mipIndex += 1) {
    const expectedSize = imageSize / (2 ** mipIndex);
    const mipKeys = specular.imageLoadKeys[mipIndex]!;
    for (let faceIndex = 0; faceIndex < mipKeys.length; faceIndex += 1) {
      const source = sources.get(mipKeys[faceIndex]!);
      if (source === undefined) return undefined;
      const [width, height] = loadedTextureSourceSize(source);
      if (width !== height || width !== expectedSize) {
        return `glTF EXT_lights_image_based specular cubemap ${specular.key} mip ${mipIndex} face ${faceIndex} has ${width}x${height}; expected ${expectedSize}x${expectedSize}.`;
      }
    }
  }

  let persistentGpuBytes = 0;
  let maximumUploadBytes = 0;
  for (const mip of specular.imageLoadKeys) {
    for (const key of mip) {
      const source = sources.get(key)!;
      const [width, height] = loadedTextureSourceSize(source);
      const faceBytes = width * height * 4;
      if (!Number.isSafeInteger(faceBytes)
        || !Number.isSafeInteger(persistentGpuBytes + faceBytes)) {
        return `glTF EXT_lights_image_based specular cubemap ${specular.key} exceeds safe GPU byte accounting.`;
      }
      persistentGpuBytes += faceBytes;
      maximumUploadBytes = Math.max(
        maximumUploadBytes,
        isDecodedRgbaTexture(source) ? source.data.byteLength : faceBytes,
      );
    }
  }
  const identity = `glTF IBL cubemap ${specular.key}`;
  // Probe every upload pass, including retained-texture reuploads, before any
  // pixel-store or binding mutation. Policy adapters may change their
  // intrinsic decision while a semantic cubemap remains retained.
  const uploadPreflight = reserve(state, identity, 0, maximumUploadBytes);
  if (uploadPreflight === undefined) return takeTerminalDiagnostic(state, identity);
  uploadPreflight.cancel();
  let texture = resource.texture;
  if (texture === undefined) {
    const allocation = reserve(state, identity, persistentGpuBytes, 0);
    if (allocation === undefined) return takeTerminalDiagnostic(state, identity);
    try {
      texture = createTexture(state);
      resource.texture = texture;
    } catch (error) {
      allocation.cancel();
      throw error;
    }
    state.textureLeases.set(texture, allocation.commit());
  }
  const gl = state.gl;
    prepareTextureUpload(gl);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
  let uploadOrdinal = 0;
  for (let mipIndex = 0; mipIndex < specular.imageLoadKeys.length; mipIndex += 1) {
    const mipKeys = specular.imageLoadKeys[mipIndex]!;
    for (let faceIndex = 0; faceIndex < mipKeys.length; faceIndex += 1) {
      const source = sources.get(mipKeys[faceIndex]!)!;
      if (isDecodedCompressedTexture(source)) {
        throw new Error(`glTF IBL cubemap ${specular.key} does not accept KHR_texture_basisu payloads`);
      }
      if (uploadOrdinal < resource.uploadCursor) {
        uploadOrdinal += 1;
        continue;
      }
      const [width, height] = loadedTextureSourceSize(source);
      const uploadBytes = isDecodedRgbaTexture(source) ? source.data.byteLength : width * height * 4;
      const identity = `glTF IBL cubemap ${specular.key}`;
      const uploadReservation = reserve(state, identity, 0, uploadBytes);
      if (uploadReservation === undefined) return takeTerminalDiagnostic(state, identity);
      const target = gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex;
      try {
        if (isDecodedRgbaTexture(source)) {
          gl.texImage2D(
            target, mipIndex, gl.RGBA, source.width, source.height, 0,
            gl.RGBA, gl.UNSIGNED_BYTE, source.data,
          );
        } else gl.texImage2D(target, mipIndex, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      } catch (error) {
        uploadReservation.commit().release();
        throw error;
      }
      uploadReservation.commit().release();
      uploadOrdinal += 1;
      resource.uploadCursor = uploadOrdinal;
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
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
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
      uploadCursor: 0,
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
    return resource as IblSpecularTextureResource;
  }
  delete resource.unsupportedMessage;
  delete resource.uploadError;
  if (resource.uploaded) return resource as IblSpecularTextureResource;
  const terminalMessage = state.terminalDenials.get(`glTF IBL cubemap ${specular.key}`);
  if (terminalMessage !== undefined) {
    resource.unsupportedMessage = terminalMessage;
    return resource as IblSpecularTextureResource;
  }
  try {
    const unsupportedMessage = uploadGltfSpecularIfReady(state, specular, resource, sources);
    if (unsupportedMessage !== undefined) resource.unsupportedMessage = unsupportedMessage;
  } catch (uploadError) {
    if (resource.texture === undefined) {
      state.gltfSpecular.delete(specular.key);
      throw uploadError;
    }
    resource.uploadError = uploadError;
  }
  return resource as IblSpecularTextureResource;
};

export const releaseGltfIblSpecularTexture = (arena: IblTextureArena, key: string): void => {
  const state = arena as unknown as State;
  clearTerminalDenial(state, `glTF IBL cubemap ${key}`);
  const resource = state.gltfSpecular.get(key);
  state.gltfSpecular.delete(key);
  const texture = resource?.texture ?? state.retiredGltfSpecular.get(key);
  if (texture === undefined) return;
  try {
    deleteTexture(state, texture);
    state.retiredGltfSpecular.delete(key);
  } catch (error) {
    state.retiredGltfSpecular.set(key, texture);
    throw error;
  }
};

const prefilteredEnvironmentIdentity = (key: string): string =>
  `Prefiltered environment cubemap ${key}`;

const preparedEnvironmentLayoutMatches = (
  resource: MutableIblSpecularTextureResource,
  prepared: PreparedRoyalEnvironment,
): boolean => resource.imageSize === prepared.size
  && resource.mipCount === prepared.levels.length;

const uploadPrefilteredEnvironmentIfReady = (
  state: State,
  key: string,
  prepared: PreparedRoyalEnvironment,
  resource: MutableIblSpecularTextureResource,
): void => {
  if (resource.uploaded) return;
  let persistentGpuBytes = 0;
  let maximumUploadBytes = 0;
  for (const level of prepared.levels) {
    for (const face of level.faces) {
      persistentGpuBytes += face.byteLength;
      maximumUploadBytes = Math.max(maximumUploadBytes, face.byteLength);
    }
  }
  const identity = prefilteredEnvironmentIdentity(key);
  const uploadPreflight = reserve(state, identity, 0, maximumUploadBytes);
  if (uploadPreflight === undefined) return;
  uploadPreflight.cancel();

  let texture = resource.texture;
  if (texture === undefined) {
    const allocation = reserve(state, identity, persistentGpuBytes, 0);
    if (allocation === undefined) return;
    try {
      texture = createTexture(state);
      resource.texture = texture;
      prepareTextureUpload(state.gl);
      state.gl.bindTexture(state.gl.TEXTURE_CUBE_MAP, texture);
      state.gl.texStorage2D(
        state.gl.TEXTURE_CUBE_MAP,
        prepared.levels.length,
        state.gl.R11F_G11F_B10F,
        prepared.size,
        prepared.size,
      );
    } catch (error) {
      allocation.cancel();
      if (texture !== undefined) rollbackTexture(state, texture);
      delete resource.texture;
      throw error;
    }
    state.textureLeases.set(texture, allocation.commit());
  } else {
    prepareTextureUpload(state.gl);
    state.gl.bindTexture(state.gl.TEXTURE_CUBE_MAP, texture);
  }

  let uploadOrdinal = 0;
  for (const level of prepared.levels) {
    for (const face of level.faces) {
      if (uploadOrdinal < resource.uploadCursor) {
        uploadOrdinal += 1;
        continue;
      }
      const reservation = reserve(state, identity, 0, face.byteLength);
      if (reservation === undefined) return;
      try {
        state.gl.texSubImage2D(
          state.gl.TEXTURE_CUBE_MAP_POSITIVE_X + face.face,
          level.level,
          0,
          0,
          level.size,
          level.size,
          state.gl.RGB,
          state.gl.UNSIGNED_INT_10F_11F_11F_REV,
          new Uint32Array(prepared.source, face.byteOffset, face.byteLength / 4),
        );
      } catch (error) {
        reservation.commit().release();
        throw error;
      }
      reservation.commit().release();
      uploadOrdinal += 1;
      resource.uploadCursor = uploadOrdinal;
    }
  }
  state.gl.texParameteri(state.gl.TEXTURE_CUBE_MAP, state.gl.TEXTURE_MAG_FILTER, state.gl.LINEAR);
  state.gl.texParameteri(
    state.gl.TEXTURE_CUBE_MAP,
    state.gl.TEXTURE_MIN_FILTER,
    state.gl.LINEAR_MIPMAP_LINEAR,
  );
  state.gl.texParameteri(state.gl.TEXTURE_CUBE_MAP, state.gl.TEXTURE_WRAP_S, state.gl.CLAMP_TO_EDGE);
  state.gl.texParameteri(state.gl.TEXTURE_CUBE_MAP, state.gl.TEXTURE_WRAP_T, state.gl.CLAMP_TO_EDGE);
  state.gl.texParameteri(state.gl.TEXTURE_CUBE_MAP, state.gl.TEXTURE_WRAP_R, state.gl.CLAMP_TO_EDGE);
  state.gl.texParameteri(
    state.gl.TEXTURE_CUBE_MAP,
    state.gl.TEXTURE_MAX_LEVEL,
    prepared.levels.length - 1,
  );
  resource.uploaded = true;
};

export const ensurePrefilteredEnvironmentSpecularTexture = (
  arena: IblTextureArena,
  key: string,
  prepared: PreparedRoyalEnvironment,
): PrefilteredEnvironmentSpecularResource => {
  const state = arena as unknown as State;
  let resource = state.prefilteredSpecular.get(key);
  if (resource === undefined) {
    resource = {
      encoding: "linear",
      imageLoadKeys: [],
      imageSize: prepared.size,
      key,
      mipCount: prepared.levels.length,
      uploadCursor: 0,
      uploaded: false,
    };
    state.prefilteredSpecular.set(key, resource);
  } else if (!preparedEnvironmentLayoutMatches(resource, prepared)) {
    resource.unsupportedMessage = `Prefiltered environment ${key} changed its image layout.`;
    resource.uploaded = false;
    return resource as PrefilteredEnvironmentSpecularResource;
  }
  delete resource.unsupportedMessage;
  delete resource.uploadError;
  if (resource.uploaded) return resource as PrefilteredEnvironmentSpecularResource;
  const terminalMessage = state.terminalDenials.get(prefilteredEnvironmentIdentity(key));
  if (terminalMessage !== undefined) {
    resource.unsupportedMessage = terminalMessage;
    return resource as PrefilteredEnvironmentSpecularResource;
  }
  try {
    uploadPrefilteredEnvironmentIfReady(state, key, prepared, resource);
  } catch (uploadError) {
    resource.uploadError = uploadError;
  }
  return resource as PrefilteredEnvironmentSpecularResource;
};

export const releasePrefilteredEnvironmentSpecularTexture = (
  arena: IblTextureArena,
  key: string,
): void => {
  const state = arena as unknown as State;
  clearTerminalDenial(state, prefilteredEnvironmentIdentity(key));
  const resource = state.prefilteredSpecular.get(key);
  state.prefilteredSpecular.delete(key);
  if (resource?.texture !== undefined) deleteTexture(state, resource.texture);
};

export const markGltfIblSpecularTextureDirty = (arena: IblTextureArena, key: string): void => {
  const resource = (arena as unknown as State).gltfSpecular.get(key);
  if (resource !== undefined) {
    resource.uploaded = false;
    resource.uploadCursor = 0;
  }
};

export const ensureStudioEnvironmentSpecularTexture = (
  arena: IblTextureArena,
): StudioEnvironmentSpecularResource | undefined => {
  const state = arena as unknown as State;
  if (state.studio !== undefined) return state.studio;
  const resource = createGovernedTexture(
    state,
    "Studio IBL specular texture",
    STUDIO_ENVIRONMENT_SPECULAR_GPU_BYTES,
    STUDIO_ENVIRONMENT_SPECULAR_UPLOAD_BYTES,
    (texture) => uploadStudioEnvironmentSpecularTexture(state.gl, texture),
  );
  if (resource !== undefined) state.studio = resource;
  return resource;
};

const ensureBrdfLut = (state: State): WebGLTexture | undefined => {
  if (state.brdfLut !== undefined) return state.brdfLut;
  const texture = createGovernedTexture(
    state,
    "IBL BRDF lookup texture",
    IBL_BRDF_LUT_BYTES,
    IBL_BRDF_LUT_BYTES,
    (candidate) => {
      uploadIblBrdfLutTexture(state.gl, candidate);
      return candidate;
    },
  );
  if (texture !== undefined) state.brdfLut = texture;
  return texture;
};

export const prepareSurfaceIblBrdfLut = (arena: IblTextureArena): boolean =>
  ensureBrdfLut(arena as unknown as State) !== undefined;

export const bindSurfaceIbl = (
  arena: IblTextureArena,
  programArena: ProgramArena,
  program: WebGLProgram,
  lightSet: SurfaceLightSet,
  specularTextureUnit: number | undefined,
  brdfLutTextureUnit: number | undefined,
  bindings: WebGlTextureBindingShell = new WebGlTextureBindingShell(
    (arena as unknown as State).gl,
  ),
  bindUniforms = true,
): void => {
  const state = arena as unknown as State;
  const specular = lightSet.specular;
  const useSpecular = specular !== undefined && specularTextureUnit !== undefined;
  const useBrdfLut = useSpecular && brdfLutTextureUnit !== undefined;
  if (!bindUniforms) {
    // The owning program/unit revision already completed the validating bind;
    // only texture targets can have been displaced by intervening materials.
    if (useSpecular) bindings.bindCube(specularTextureUnit, specular.texture);
    if (useSpecular && brdfLutTextureUnit !== undefined && state.brdfLut !== undefined) {
      bindings.bindTexture2d(brdfLutTextureUnit, state.brdfLut);
    }
    return;
  }
  bindSurfaceIblIrradiance(programArena, program, lightSet);
  if (useSpecular) assertTextureUnit(state, specularTextureUnit, "IBL specular");
  if (useBrdfLut) {
    assertTextureUnit(state, brdfLutTextureUnit, "IBL BRDF LUT");
    if (brdfLutTextureUnit === specularTextureUnit) {
      throw new RangeError(`IBL specular and BRDF LUT texture units must not alias unit ${brdfLutTextureUnit}`);
    }
  }
  uniform1i(programArena, program, "u_useIblSpecular", useSpecular ? 1 : 0);
  uniform4f(programArena, program, "u_iblSpecularSettings",
    useSpecular ? 1 : 0, specular?.intensity ?? 1, specular?.mipCount ?? 1,
    specular?.encoding === "rgbd" ? 1 : 0);
  if (useSpecular) {
    bindings.bindCube(specularTextureUnit, specular.texture);
    uniform1i(programArena, program, "u_iblSpecularCube", specularTextureUnit);
  }
  const hadBrdfLut = state.brdfLut !== undefined;
  const brdfLut = useBrdfLut ? ensureBrdfLut(state) : undefined;
  // First-time LUT realization uses the raw upload lane and invalidates every
  // target binding on its transient unit before retained draw binding resumes.
  if (!hadBrdfLut && brdfLut !== undefined) bindings.invalidate();
  uniform1i(programArena, program, "u_useIblBrdfLut", brdfLut === undefined ? 0 : 1);
  if (brdfLut !== undefined && brdfLutTextureUnit !== undefined) {
    bindings.bindTexture2d(brdfLutTextureUnit, brdfLut);
    uniform1i(programArena, program, "u_iblBrdfLut", brdfLutTextureUnit);
  }
};

const clearPublished = (state: State, clearPolicyState: boolean): void => {
  delete state.brdfLut;
  delete state.studio;
  state.gltfSpecular.clear();
  state.prefilteredSpecular.clear();
  state.retiredGltfSpecular.clear();
  if (clearPolicyState) {
    state.terminalDenials.clear();
    state.diagnostics.length = 0;
  }
  state.durablePressurePending = false;
  state.frameWakeRequested = false;
};

const EMPTY_IBL_TEXTURE_DIAGNOSTICS: readonly string[] = [];

export const consumeIblTextureDiagnostics = (arena: IblTextureArena): readonly string[] => {
  const state = arena as unknown as State;
  if (state.diagnostics.length === 0) return EMPTY_IBL_TEXTURE_DIAGNOSTICS;
  const diagnostics = state.diagnostics.slice();
  state.diagnostics.length = 0;
  return diagnostics;
};

/** Imperative drain boundary for frame shells that own reusable diagnostic storage. */
export const drainIblTextureDiagnostics = (
  arena: IblTextureArena,
  consume: (message: string) => void,
): void => {
  const state = arena as unknown as State;
  for (let index = 0; index < state.diagnostics.length; index += 1) {
    consume(state.diagnostics[index]!);
  }
  state.diagnostics.length = 0;
};

export const consumeIblTextureFrameWake = (arena: IblTextureArena): boolean => {
  const state = arena as unknown as State;
  const requested = state.frameWakeRequested;
  state.frameWakeRequested = false;
  return requested;
};

export const wakeIblTextureDurablePressure = (arena: IblTextureArena): boolean => {
  const state = arena as unknown as State;
  if (!state.durablePressurePending) return false;
  state.durablePressurePending = false;
  return true;
};

export const releaseIblTextureContextHandles = (arena: IblTextureArena): void => {
  const state = arena as unknown as State;
  clearPublished(state, true);
  let error: unknown;
  for (const texture of Array.from(state.ownedTextures)) {
    try { deleteTexture(state, texture); } catch (caught) { error ??= caught; }
  }
  if (error !== undefined) throw error;
};

export const dropIblTextureContext = (arena: IblTextureArena): void => {
  const state = arena as unknown as State;
  clearPublished(state, false);
  let failure: CapturedFailure | undefined;
  for (const [texture, lease] of state.textureLeases) {
    failure = captureFirstFailure(failure, () => {
      lease.release();
      state.textureLeases.delete(texture);
    });
  }
  state.ownedTextures.clear();
  if (failure !== undefined) throw failure.value;
};

export const iblTextureArenaSnapshot = (arena: IblTextureArena): IblTextureArenaSnapshot => {
  const state = arena as unknown as State;
  return {
    brdfLut: state.brdfLut !== undefined,
    gltfSpecularCount: state.gltfSpecular.size,
    ownedTextureCount: state.ownedTextures.size,
    prefilteredSpecularCount: state.prefilteredSpecular.size,
    retainedLeaseCount: state.textureLeases.size,
    studioSpecular: state.studio?.key === STUDIO_ENVIRONMENT_SPECULAR_KEY,
  };
};

export type { StudioEnvironmentSpecularResource } from "./studio-environment";
export { IBL_BRDF_LUT_PREFERRED_TEXTURE_UNIT } from "./ibl-brdf-lut";

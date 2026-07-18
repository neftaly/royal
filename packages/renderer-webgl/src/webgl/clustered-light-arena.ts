import { copyMat4ValuesInto, mat4ValuesEqual, type Mat4 } from "../math/mat4";
import { GpuUploadCapacityError } from "../gpu-upload-capacity-error";
import {
  buildClusterGrid,
  clusterBuildScratchCapacity,
  createClusterBuildScratch,
  createClusterBuildScratchWithCapacity,
  type ClusterGrid,
  type ClusterBuildScratch,
  type ClusteredPunctualLight,
} from "./clustered-lights";
import { DEFAULT_LIGHT_DIRECTION } from "./lights";
import {
  uniform1i,
  uniform2f,
  uniform4f,
  type ProgramArena,
} from "./program-arena";

export interface ClusteredLightTextureUnits {
  readonly grid: number;
  readonly indices: number;
  readonly lights: number;
}

export interface ClusteredLightArenaSnapshot {
  readonly ownedTextureCount: number;
  readonly resourceCount: number;
  readonly textureUnits: ClusteredLightTextureUnits;
}

export interface ClusteredLightGpuLease { release(): boolean }
export interface ClusteredLightGpuReservation {
  cancel(): boolean;
  commit(): ClusteredLightGpuLease;
}
export interface ClusteredLightGpuDenial {
  readonly permanent?: boolean;
  readonly reason: string;
}
export interface ClusteredLightGpuGovernor {
  replace(lease: ClusteredLightGpuLease, cost: {
    readonly cpuDecodedBytes?: number; readonly persistentGpuBytes?: number;
    readonly transientPeakBytes?: number; readonly uploadBytes?: number;
  }): ClusteredLightGpuDenial | ClusteredLightGpuReservation | undefined;
  reserve(cost: {
    readonly cpuDecodedBytes?: number; readonly persistentGpuBytes?: number;
    readonly transientPeakBytes?: number; readonly uploadBytes?: number;
  }): ClusteredLightGpuDenial | ClusteredLightGpuReservation | undefined;
}

declare const authority: unique symbol;
export interface ClusteredLightArena { readonly [authority]: "ClusteredLightArena" }

type MutableTextureUnits = { grid: number; indices: number; lights: number };
type ClusterGridMetadata = Omit<ClusterGrid, "indices" | "offsetsAndCounts">;
type ClusteredLightResource = {
  gpuBytes: number;
  gpuValid: boolean;
  gpuLease?: ClusteredLightGpuLease;
  grid?: ClusterGridMetadata;
  readonly gridTexture: WebGLTexture;
  gridTextureHeight: number;
  gridTextureWidth: number;
  indexData: Uint32Array;
  readonly indexTexture: WebGLTexture;
  indexTextureHeight: number;
  indexTextureWidth: number;
  lastUsedFrame: number;
  lightCount: number;
  lightData: Float32Array;
  lightSnapshot: Float64Array;
  readonly lightTexture: WebGLTexture;
  lightTextureHeight: number;
  projection: Float64Array;
  view: Float64Array;
  viewportHeight: number;
  viewportWidth: number;
};
type State = {
  buildScratch: ClusterBuildScratch;
  cpuBytes: number;
  cpuLease?: ClusteredLightGpuLease;
  readonly gl: WebGL2RenderingContext;
  readonly governor?: ClusteredLightGpuGovernor;
  maxTextureSize: number;
  readonly ownedTextures: Set<WebGLTexture>;
  resource?: ClusteredLightResource;
  readonly textureUnits: MutableTextureUnits;
};

const isGpuDenial = (
  value: ClusteredLightGpuDenial | ClusteredLightGpuReservation | undefined,
): value is ClusteredLightGpuDenial => value !== undefined && "reason" in value;

export const createClusteredLightArena = (
  gl: WebGL2RenderingContext,
  governor?: ClusteredLightGpuGovernor,
): ClusteredLightArena => ({
  buildScratch: createClusterBuildScratch(),
  cpuBytes: 0,
  gl,
  ...(governor === undefined ? {} : { governor }),
  maxTextureSize: 0,
  ownedTextures: new Set(),
  textureUnits: { grid: -1, indices: -1, lights: -1 },
} as unknown as ClusteredLightArena);

export const configureClusteredLightArena = (
  arena: ClusteredLightArena,
  maxTextureImageUnits: number,
  maxTextureSize: number,
): void => {
  const state = arena as unknown as State;
  state.maxTextureSize = Number.isFinite(maxTextureSize) ? maxTextureSize : 0;
  if (maxTextureImageUnits >= 8) {
    state.textureUnits.grid = maxTextureImageUnits - 3;
    state.textureUnits.indices = maxTextureImageUnits - 2;
    state.textureUnits.lights = maxTextureImageUnits - 1;
  } else {
    state.textureUnits.grid = -1;
    state.textureUnits.indices = -1;
    state.textureUnits.lights = -1;
  }
};

export const clusteredLightTextureUnits = (
  arena: ClusteredLightArena,
): ClusteredLightTextureUnits => (arena as unknown as State).textureUnits;

const createTexture = (state: State): WebGLTexture => {
  const texture = state.gl.createTexture();
  if (texture === null) throw new Error("WebGL texture creation failed");
  state.ownedTextures.add(texture);
  return texture;
};

const createResource = (state: State): ClusteredLightResource => {
  const created: WebGLTexture[] = [];
  try {
    const gridTexture = createTexture(state);
    created.push(gridTexture);
    const indexTexture = createTexture(state);
    created.push(indexTexture);
    const lightTexture = createTexture(state);
    created.push(lightTexture);
    return {
      gpuBytes: 0, gpuValid: false, gridTexture, gridTextureHeight: 0, gridTextureWidth: 0,
      indexData: new Uint32Array(0), indexTexture, indexTextureHeight: 0, indexTextureWidth: 0,
      lastUsedFrame: -1, lightCount: 0, lightData: new Float32Array(0), lightSnapshot: new Float64Array(0),
      lightTexture, lightTextureHeight: 0,
      projection: new Float64Array(16).fill(Number.NaN),
      view: new Float64Array(16).fill(Number.NaN),
      viewportHeight: 0, viewportWidth: 0,
    };
  } catch (error) {
    for (const texture of created) {
      try {
        state.gl.deleteTexture(texture);
        state.ownedTextures.delete(texture);
      } catch { /* Preserve the creation failure and retain the handle for teardown retry. */ }
    }
    throw error;
  }
};

const configureTexture = (state: State, unit: number, texture: WebGLTexture): void => {
  const gl = state.gl;
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

const snapshotMatches = (
  resource: ClusteredLightResource,
  lights: readonly ClusteredPunctualLight[],
): boolean => {
  if (resource.lightCount !== lights.length) return false;
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 14;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    const values = resource.lightSnapshot;
    if (
      !Object.is(values[offset], light.kind === "point" ? 1 : 2)
      || !Object.is(values[offset + 1], light.color[0])
      || !Object.is(values[offset + 2], light.color[1])
      || !Object.is(values[offset + 3], light.color[2])
      || !Object.is(values[offset + 4], light.position[0])
      || !Object.is(values[offset + 5], light.position[1])
      || !Object.is(values[offset + 6], light.position[2])
      || !Object.is(values[offset + 7], light.range === undefined ? 0 : 1)
      || !Object.is(values[offset + 8], light.range ?? 0)
      || !Object.is(values[offset + 9], direction[0])
      || !Object.is(values[offset + 10], direction[1])
      || !Object.is(values[offset + 11], direction[2])
      || !Object.is(values[offset + 12], light.kind === "spot" ? light.innerConeAngle : 0)
      || !Object.is(values[offset + 13], light.kind === "spot" ? light.outerConeAngle : 0)
    ) return false;
  }
  return true;
};

const commitSnapshot = (
  lights: readonly ClusteredPunctualLight[],
  current: Float64Array,
): Float64Array => {
  const length = lights.length * 14;
  const values = current.length === length ? current : new Float64Array(length);
  for (let index = 0; index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 14;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    values[offset] = light.kind === "point" ? 1 : 2;
    values[offset + 1] = light.color[0];
    values[offset + 2] = light.color[1];
    values[offset + 3] = light.color[2];
    values[offset + 4] = light.position[0];
    values[offset + 5] = light.position[1];
    values[offset + 6] = light.position[2];
    values[offset + 7] = light.range === undefined ? 0 : 1;
    values[offset + 8] = light.range ?? 0;
    values[offset + 9] = direction[0];
    values[offset + 10] = direction[1];
    values[offset + 11] = direction[2];
    values[offset + 12] = light.kind === "spot" ? light.innerConeAngle : 0;
    values[offset + 13] = light.kind === "spot" ? light.outerConeAngle : 0;
  }
  return values;
};

const scratchBytes = (scratch: ClusterBuildScratch): number =>
  scratch.bounds.byteLength + scratch.counts.byteLength
  + scratch.indices.byteLength + scratch.offsetsAndCounts.byteLength;

const powerOfTwoCapacity = (required: number): number =>
  required <= 1 ? required : 2 ** Math.ceil(Math.log2(required));

const paddedIndexElementLength = (
  required: number,
  currentLength: number,
  maxTextureSize: number,
): number => {
  if (currentLength >= required) return currentLength;
  const capacity = powerOfTwoCapacity(Math.max(required, 1));
  if (maxTextureSize < 1) return capacity;
  const width = Math.min(maxTextureSize, capacity);
  return width * Math.ceil(capacity / width);
};

const retainedCpuBytesAfterUpload = (
  scratch: ClusterBuildScratch,
  current: ClusteredLightResource | undefined,
  grid: ClusterGrid,
  lightCount: number,
  maxTextureSize: number,
): number => {
  const requiredIndexCount = Math.max(1, grid.indexCount);
  const indexLength = paddedIndexElementLength(
    requiredIndexCount,
    current?.indexData.length ?? 0,
    maxTextureSize,
  );
  const requiredLightCount = Math.max(lightCount, 1);
  const lightHeight = Math.max(
    current?.lightTextureHeight ?? 0,
    Math.min(maxTextureSize, powerOfTwoCapacity(requiredLightCount)),
  );
  return scratchBytes(scratch)
    + indexLength * Uint32Array.BYTES_PER_ELEMENT
    + lightHeight * 16 * Float32Array.BYTES_PER_ELEMENT
    + Math.max(current?.lightSnapshot.length ?? 0, lightCount * 14) * Float64Array.BYTES_PER_ELEMENT
    + 32 * Float64Array.BYTES_PER_ELEMENT;
};

const conservativeRetainedCpuBytes = (
  capacity: ReturnType<typeof clusterBuildScratchCapacity>,
  current: ClusteredLightResource | undefined,
  lightCount: number,
  maxTextureSize: number,
): number => {
  const scratch = (capacity.bounds + capacity.counts
    + capacity.indices + capacity.offsetsAndCounts) * Uint32Array.BYTES_PER_ELEMENT;
  const indexLength = paddedIndexElementLength(
    Math.max(capacity.indices, 1),
    current?.indexData.length ?? 0,
    maxTextureSize,
  );
  const lightHeight = Math.max(
    current?.lightTextureHeight ?? 0,
    Math.min(maxTextureSize, powerOfTwoCapacity(Math.max(lightCount, 1))),
  );
  return scratch
    + indexLength * Uint32Array.BYTES_PER_ELEMENT
    + lightHeight * 16 * Float32Array.BYTES_PER_ELEMENT
    + Math.max(current?.lightSnapshot.length ?? 0, lightCount * 14) * Float64Array.BYTES_PER_ELEMENT
    + 32 * Float64Array.BYTES_PER_ELEMENT;
};

const upload = (
  state: State,
  current: ClusteredLightResource | undefined,
  grid: ClusterGrid,
  lights: readonly ClusteredPunctualLight[],
  uploadLightData: boolean,
): ClusteredLightResource => {
  const gl = state.gl;
  const units = state.textureUnits;
  if (lights.length > state.maxTextureSize) {
    throw new Error(`Clustered light count ${lights.length} exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
  }
  const gridWidth = grid.tileCountX * grid.tileCountY;
  if (gridWidth > state.maxTextureSize || grid.zSliceCount > state.maxTextureSize) {
    throw new Error(
      `Clustered light grid ${gridWidth}x${grid.zSliceCount} exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`,
    );
  }
  const requiredIndexCount = Math.max(1, grid.indexCount);
  const resizedIndexTexture = (current?.indexData.length ?? 0) < requiredIndexCount;
  let indexTextureWidth = current?.indexTextureWidth ?? 0;
  let indexTextureHeight = current?.indexTextureHeight ?? 0;
  let indexData: Uint32Array;
  if (resizedIndexTexture) {
    const capacity = 2 ** Math.ceil(Math.log2(requiredIndexCount));
    indexTextureWidth = Math.min(state.maxTextureSize, capacity);
    indexTextureHeight = Math.ceil(capacity / indexTextureWidth);
    if (indexTextureHeight > state.maxTextureSize) {
      throw new Error(`Clustered light index table exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
    }
    indexData = new Uint32Array(indexTextureWidth * indexTextureHeight);
  } else {
    indexData = current!.indexData;
  }
  if (indexTextureHeight > state.maxTextureSize) {
    throw new Error(`Clustered light index table exceeds MAX_TEXTURE_SIZE ${state.maxTextureSize}`);
  }
  for (let index = 0; index < grid.indexCount; index += 1) indexData[index] = grid.indices[index]!;
  const requiredLightCount = Math.max(lights.length, 1);
  const resizedLightTexture = (current?.lightTextureHeight ?? 0) < requiredLightCount;
  let lightTextureHeight = current?.lightTextureHeight ?? 0;
  let lightData: Float32Array;
  if (resizedLightTexture) {
    lightTextureHeight = Math.min(
      state.maxTextureSize,
      2 ** Math.ceil(Math.log2(requiredLightCount)),
    );
    lightData = new Float32Array(lightTextureHeight * 16);
  } else {
    lightData = current!.lightData;
  }
  for (let index = 0; uploadLightData && index < lights.length; index += 1) {
    const light = lights[index]!;
    const offset = index * 16;
    const direction = light.kind === "point" ? DEFAULT_LIGHT_DIRECTION : light.direction;
    lightData[offset] = light.color[0];
    lightData[offset + 1] = light.color[1];
    lightData[offset + 2] = light.color[2];
    lightData[offset + 3] = light.kind === "point" ? 1 : 2;
    lightData[offset + 4] = light.position[0];
    lightData[offset + 5] = light.position[1];
    lightData[offset + 6] = light.position[2];
    lightData[offset + 7] = light.range ?? 0;
    lightData[offset + 8] = direction[0];
    lightData[offset + 9] = direction[1];
    lightData[offset + 10] = direction[2];
    lightData[offset + 11] = light.kind === "spot" ? Math.cos(light.innerConeAngle) : 1;
    lightData[offset + 12] = light.kind === "spot" ? Math.cos(light.outerConeAngle) : 0;
  }
  const gridBytes = gridWidth * grid.zSliceCount * 2 * Uint32Array.BYTES_PER_ELEMENT;
  const indexBytes = indexTextureWidth * indexTextureHeight * Uint32Array.BYTES_PER_ELEMENT;
  const lightBytes = 4 * lightTextureHeight * 4 * Float32Array.BYTES_PER_ELEMENT;
  const persistentGpuBytes = gridBytes + indexBytes + lightBytes;
  const gridResized = current?.gridTextureWidth !== gridWidth
    || current?.gridTextureHeight !== grid.zSliceCount;
  const storageChanged = current === undefined || gridResized || resizedIndexTexture || resizedLightTexture;
  const uploadBytes = gridBytes + indexBytes + (uploadLightData ? lightBytes : 0);
  let storageReservation: ClusteredLightGpuReservation | undefined;
  let uploadReservation: ClusteredLightGpuReservation | undefined;
  if (state.governor !== undefined) {
    const storageAdmission = !storageChanged
      ? undefined
      : current?.gpuLease !== undefined
      ? state.governor.replace(current.gpuLease, {
        persistentGpuBytes,
        transientPeakBytes: current.gpuBytes + persistentGpuBytes,
      })
      : state.governor.reserve({ persistentGpuBytes, transientPeakBytes: persistentGpuBytes });
    if (storageChanged && (storageAdmission === undefined || isGpuDenial(storageAdmission))) {
      const reason = isGpuDenial(storageAdmission) ? `: ${storageAdmission.reason}` : "";
      throw new Error(`Clustered-light GPU update denied by root resource governor${reason}`);
    }
    storageReservation = storageAdmission as ClusteredLightGpuReservation | undefined;
    const uploadAdmission = state.governor.reserve({ uploadBytes });
    if (uploadAdmission === undefined || isGpuDenial(uploadAdmission)) {
      storageReservation?.cancel();
      if (
        isGpuDenial(uploadAdmission)
        && uploadAdmission.reason === "upload-capacity"
        && uploadAdmission.permanent !== true
      ) {
        throw new GpuUploadCapacityError(
          "Clustered-light GPU update deferred by root resource governor: upload-capacity",
        );
      }
      const reason = isGpuDenial(uploadAdmission) ? `: ${uploadAdmission.reason}` : "";
      throw new Error(`Clustered-light GPU upload denied by root resource governor${reason}`);
    }
    uploadReservation = uploadAdmission;
  }
  let resource = current;
  if (resource === undefined) {
    try {
      resource = createResource(state);
      state.resource = resource;
    } catch (error) {
      storageReservation?.cancel();
      uploadReservation?.cancel();
      throw error;
    }
  }
  let allocationStarted = false;
  let uploadStarted = false;
  let storageSettled = false;
  let uploadSettled = false;
  // From the first possible GL mutation onward, the three textures are one
  // poisoned generation until every upload completes successfully.
  resource.gpuValid = false;
  try {
    configureTexture(state, units.grid, resource.gridTexture);
    uploadStarted = true;
    if (!gridResized) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gridWidth, grid.zSliceCount,
        gl.RG_INTEGER, gl.UNSIGNED_INT, grid.offsetsAndCounts);
    } else {
      allocationStarted = true;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32UI, gridWidth, grid.zSliceCount, 0,
        gl.RG_INTEGER, gl.UNSIGNED_INT, grid.offsetsAndCounts);
    }
    configureTexture(state, units.indices, resource.indexTexture);
    if (!resizedIndexTexture) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, indexTextureWidth, indexTextureHeight,
        gl.RED_INTEGER, gl.UNSIGNED_INT, indexData);
    } else {
      allocationStarted = true;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, indexTextureWidth, indexTextureHeight, 0,
        gl.RED_INTEGER, gl.UNSIGNED_INT, indexData);
    }
    if (uploadLightData) {
      configureTexture(state, units.lights, resource.lightTexture);
      if (!resizedLightTexture) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 4, lightTextureHeight,
          gl.RGBA, gl.FLOAT, lightData);
      } else {
        allocationStarted = true;
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 4, lightTextureHeight, 0,
          gl.RGBA, gl.FLOAT, lightData);
      }
    }
    storageSettled = true;
    const lease = storageReservation?.commit();
    if (storageChanged) {
      if (lease !== undefined) resource.gpuLease = lease;
      resource.gpuBytes = persistentGpuBytes;
    } else lease?.release();
    resource.gridTextureWidth = gridWidth; resource.gridTextureHeight = grid.zSliceCount;
    resource.indexTextureWidth = indexTextureWidth; resource.indexTextureHeight = indexTextureHeight;
    resource.indexData = indexData;
    resource.lightTextureHeight = lightTextureHeight; resource.lightData = lightData;
    if (uploadLightData) {
      resource.lightCount = lights.length;
      resource.lightSnapshot = commitSnapshot(lights, resource.lightSnapshot);
    }
    uploadSettled = true;
    uploadReservation?.commit().release();
    resource.gpuValid = true;
    return resource;
  } catch (error) {
    if (!uploadSettled) {
      uploadSettled = true;
      if (uploadStarted) uploadReservation?.commit().release();
      else uploadReservation?.cancel();
    }
    if (!storageSettled) {
      storageSettled = true;
      if (storageChanged && allocationStarted && persistentGpuBytes >= resource.gpuBytes) {
        const lease = storageReservation?.commit();
        if (lease !== undefined) resource.gpuLease = lease;
        resource.gpuBytes = persistentGpuBytes;
      } else storageReservation?.cancel();
    }
    throw error;
  }
};

export const bindClusteredLights = (
  arena: ClusteredLightArena,
  programArena: ProgramArena,
  program: WebGLProgram,
  lights: readonly ClusteredPunctualLight[],
  projection: Mat4,
  view: Mat4,
  width: number,
  height: number,
  frame: number,
): void => {
  const state = arena as unknown as State;
  if (lights.length === 0) {
    uniform1i(programArena, program, "u_useClusteredLights", 0);
    return;
  }
  const units = state.textureUnits;
  if (units.grid < 0 || units.indices < 0 || units.lights < 0) {
    throw new Error("Clustered Forward+ lighting requires three fragment texture units");
  }
  const perspective = Math.abs(projection[15]) < 0.5;
  const near = Math.abs(perspective
    ? projection[14] / (projection[10] - 1)
    : (projection[14] + 1) / projection[10]);
  const far = Math.abs(perspective
    ? projection[14] / (projection[10] + 1)
    : (projection[14] - 1) / projection[10]);
  let resource = state.resource;
  const lightsChanged = resource === undefined || !resource.gpuValid || !snapshotMatches(resource, lights);
  const viewChanged = resource?.gpuValid !== true || resource.grid === undefined
    || !mat4ValuesEqual(resource.projection, projection)
    || !mat4ValuesEqual(resource.view, view)
    || resource.viewportWidth !== width
    || resource.viewportHeight !== height;
  let grid = resource?.grid;
  if (lightsChanged || viewChanged) {
    const capacity = clusterBuildScratchCapacity(width, height, lights.length);
    const conservativeCpuBytes = conservativeRetainedCpuBytes(
      capacity,
      resource,
      lights.length,
      state.maxTextureSize,
    );
    let cpuReservation: ClusteredLightGpuReservation | undefined;
    let reservedCpuBytes = conservativeCpuBytes;
    if (state.governor !== undefined) {
      const cost = {
        cpuDecodedBytes: conservativeCpuBytes,
        transientPeakBytes: state.cpuBytes + conservativeCpuBytes,
      };
      const cpuAdmission = state.cpuLease === undefined
        ? state.governor.reserve(cost)
        : state.governor.replace(state.cpuLease, cost);
      if (cpuAdmission === undefined || isGpuDenial(cpuAdmission)) {
        const reason = isGpuDenial(cpuAdmission) ? `: ${cpuAdmission.reason}` : "";
        throw new Error(`Clustered-light CPU update denied by root resource governor${reason}`);
      }
      cpuReservation = cpuAdmission;
    }
    let nextScratch: ClusterBuildScratch;
    let builtGrid: ClusterGrid;
    try {
      const scratch = state.buildScratch;
      nextScratch = scratch.bounds.length >= capacity.bounds
        && scratch.counts.length >= capacity.counts
        && scratch.indices.length >= capacity.indices
        && scratch.offsetsAndCounts.length >= capacity.offsetsAndCounts
        ? scratch
        : createClusterBuildScratchWithCapacity(capacity);
      builtGrid = buildClusterGrid({
        camera: { far, kind: perspective ? "perspective-camera" : "orthographic-camera", near },
        height, lights, projection, view, width,
      }, nextScratch);
    } catch (error) {
      cpuReservation?.cancel();
      throw error;
    }
    const nextCpuBytes = retainedCpuBytesAfterUpload(
      nextScratch,
      resource,
      builtGrid,
      lights.length,
      state.maxTextureSize,
    );
    if (state.governor !== undefined && nextCpuBytes !== conservativeCpuBytes) {
      cpuReservation?.cancel();
      const cost = {
        cpuDecodedBytes: nextCpuBytes,
        transientPeakBytes: state.cpuBytes + nextCpuBytes,
      };
      const cpuAdmission = state.cpuLease === undefined
        ? state.governor.reserve(cost)
        : state.governor.replace(state.cpuLease, cost);
      reservedCpuBytes = nextCpuBytes;
      if (cpuAdmission === undefined || isGpuDenial(cpuAdmission)) {
        const reason = isGpuDenial(cpuAdmission) ? `: ${cpuAdmission.reason}` : "";
        throw new Error(`Clustered-light CPU update denied by root resource governor${reason}`);
      }
      cpuReservation = cpuAdmission;
    }
    try {
      resource = upload(state, resource, builtGrid, lights, lightsChanged);
    } catch (error) {
      if (
        state.cpuLease === undefined
        && state.resource !== undefined
        && cpuReservation !== undefined
      ) {
        // A failed initial GPU allocation may retain its texture authority for
        // teardown retry. Keep the already-admitted conservative CPU lease for
        // the retained resource object instead of leaving those bytes unowned.
        state.cpuLease = cpuReservation.commit();
        state.cpuBytes = reservedCpuBytes;
      } else cpuReservation?.cancel();
      throw error;
    }
    const cpuLease = cpuReservation?.commit();
    if (cpuLease !== undefined) state.cpuLease = cpuLease;
    state.cpuBytes = nextCpuBytes;
    state.buildScratch = nextScratch;
    const { indices: _indices, offsetsAndCounts: _offsetsAndCounts, ...metadata } = builtGrid;
    grid = metadata;
    resource.grid = metadata;
    copyMat4ValuesInto(resource.projection, projection);
    copyMat4ValuesInto(resource.view, view);
    resource.viewportWidth = width;
    resource.viewportHeight = height;
    resource.lastUsedFrame = frame;
  } else if (resource !== undefined) resource.lastUsedFrame = frame;
  if (grid === undefined || resource === undefined) throw new Error("Clustered light grid was not prepared");

  const gl = state.gl;
  gl.activeTexture(gl.TEXTURE0 + units.grid);
  gl.bindTexture(gl.TEXTURE_2D, resource.gridTexture);
  gl.activeTexture(gl.TEXTURE0 + units.indices);
  gl.bindTexture(gl.TEXTURE_2D, resource.indexTexture);
  gl.activeTexture(gl.TEXTURE0 + units.lights);
  gl.bindTexture(gl.TEXTURE_2D, resource.lightTexture);
  uniform1i(programArena, program, "u_useClusteredLights", 1);
  uniform1i(programArena, program, "u_clusterGrid", units.grid);
  uniform1i(programArena, program, "u_clusterLightIndices", units.indices);
  uniform1i(programArena, program, "u_clusterLightData", units.lights);
  uniform4f(programArena, program, "u_clusterDimensions",
    grid.tileCountX, grid.tileCountY, grid.zSliceCount, grid.tileSize);
  uniform4f(programArena, program, "u_clusterDepth", grid.zSliceScale, grid.zSliceBias, near, 0);
  uniform2f(programArena, program, "u_clusterProjection", perspective ? 0 : 1, resource.indexTextureWidth);
  uniform2f(programArena, program, "u_clusterViewportOrigin", 0, 0);
};

const clear = (state: State): void => {
  state.resource?.gpuLease?.release();
  state.cpuLease?.release();
  delete state.cpuLease;
  state.cpuBytes = 0;
  state.buildScratch = createClusterBuildScratch();
  delete state.resource;
  state.ownedTextures.clear();
};

export const releaseClusteredLightContextHandles = (arena: ClusteredLightArena): void => {
  const state = arena as unknown as State;
  let failure: { readonly value: unknown } | undefined;
  for (const texture of Array.from(state.ownedTextures)) {
    try {
      state.gl.deleteTexture(texture);
      state.ownedTextures.delete(texture);
    } catch (caught) {
      failure ??= { value: caught };
    }
  }
  if (state.ownedTextures.size === 0) {
    state.resource?.gpuLease?.release();
    state.cpuLease?.release();
    delete state.cpuLease;
    state.cpuBytes = 0;
    state.buildScratch = createClusterBuildScratch();
    delete state.resource;
  }
  if (failure !== undefined) throw failure.value;
};

export const dropClusteredLightContext = (arena: ClusteredLightArena): void => {
  clear(arena as unknown as State);
};

export const clusteredLightArenaSnapshot = (arena: ClusteredLightArena): ClusteredLightArenaSnapshot => {
  const state = arena as unknown as State;
  return {
    ownedTextureCount: state.ownedTextures.size,
    resourceCount: state.resource === undefined ? 0 : 1,
    textureUnits: state.textureUnits,
  };
};

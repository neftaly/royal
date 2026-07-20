import {
  affineSurfaceNormalTransformInto,
  identityMat4,
} from "../math/mat4";
import type { CanonicalDrawSurface } from "./scene-lowering";
import {
  surfaceGeometryResourceKey,
  surfaceGeometryUploadByteLength,
  surfaceInstanceUploadByteLength,
  surfaceUsesTextureCoordinateSet,
} from "./gpu-admission";
import {
  geometryBatchLayoutByteLength,
  planGeometryBatchChunks,
  planGeometryBatchLayout,
  type GeometryIndexArray,
  type GeometryBatchLayoutPlan,
  type GeometryBatchRange,
} from "./geometry-batch-plan";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";
import {
  DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME,
  FrameUploadBudgetOwner,
  type FrameUploadBudgetSnapshot,
} from "../resource/frame-upload-budget";

type GpuGeometryArena = Readonly<{
  budgetIdentity: object;
  colorBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer;
  normalBuffer: WebGLBuffer | null;
  tangentBuffer: WebGLBuffer | null;
  textureCoordinateBuffer: WebGLBuffer | null;
  textureCoordinate1Buffer: WebGLBuffer | null;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

export type GpuGeometry = Readonly<{
  arena: GpuGeometryArena;
  colorBuffer: WebGLBuffer | null;
  indexBuffer: WebGLBuffer;
  indexOffset: number;
  indexCount: number;
  indexType: number;
  key: string;
  normalBuffer: WebGLBuffer | null;
  tangentBuffer: WebGLBuffer | null;
  textureCoordinateBuffer: WebGLBuffer | null;
  textureCoordinate1Buffer: WebGLBuffer | null;
  vertexArray: WebGLVertexArrayObject;
  vertexBuffer: WebGLBuffer;
}>;

export type GpuGeometrySurface = Readonly<{
  geometry: GpuGeometry;
  instanceCount: number;
  surface: CanonicalDrawSurface;
  vertexArray: WebGLVertexArrayObject;
}>;

type GpuInstanceData = {
  budgetIdentity: object;
  buffer: WebGLBuffer;
  count: number;
  key: string;
  revision?: string;
};

type GpuInstanceVertexArray = Readonly<{
  key: string;
  vertexArray: WebGLVertexArrayObject;
}>;

export type SurfaceGeometryPlan = Readonly<{
  commit: () => void;
  offset: number;
  rollback: () => void;
  surfaces: readonly GpuGeometrySurface[];
}>;

const indexType = (
  gl: WebGL2RenderingContext,
  indexBytes: 1 | 2 | 4,
): number => indexBytes === 4
  ? gl.UNSIGNED_INT
  : indexBytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_BYTE;

const geometryLayout = (surface: CanonicalDrawSurface): number => {
  let layout = surface.material.kind === "standard"
    && surface.geometry.normals !== undefined ? 1 : 0;
  if (
    surface.material.kind === "standard"
    && surface.material.normalAsset !== undefined
    && surface.material.normalTextureCoordinates === undefined
    && surface.geometry.tangents !== undefined
  ) layout |= 2;
  if (surfaceUsesTextureCoordinateSet(surface, 0)) layout |= 4;
  if (surfaceUsesTextureCoordinateSet(surface, 1)) layout |= 8;
  if (surface.geometry.colors !== undefined) layout |= 16;
  return layout;
};

const geometryVertexStrideBytes = (layout: number): number => (
  3 * 4
  + ((layout & 1) !== 0 ? 3 * 4 : 0)
  + ((layout & 2) !== 0 ? 4 * 4 : 0)
  + ((layout & 4) !== 0 ? 2 * 4 : 0)
  + ((layout & 8) !== 0 ? 2 * 4 : 0)
  + ((layout & 16) !== 0 ? 4 * 4 : 0)
);

type PendingGeometry = Readonly<{
  key: string;
  surface: CanonicalDrawSurface;
}>;

type PlannedGeometry = PendingGeometry & Readonly<{
  planIndex: number;
  range: GeometryBatchRange;
}>;

type PlannedGeometryArena = Readonly<{
  batch: GeometryBatchLayoutPlan;
  entries: readonly PlannedGeometry[];
  layout: number;
}>;

type GeometryIndexUploadWorkspace = {
  uint8?: Uint8Array;
  uint16?: Uint16Array;
  uint32?: Uint32Array;
};

const indexUploadWorkspace = (
  workspace: GeometryIndexUploadWorkspace,
  indexBytes: 1 | 2 | 4,
  length: number,
): GeometryIndexArray => {
  if (indexBytes === 1) {
    if (workspace.uint8 === undefined || workspace.uint8.length < length) {
      workspace.uint8 = new Uint8Array(length);
    }
    return workspace.uint8;
  }
  if (indexBytes === 2) {
    if (workspace.uint16 === undefined || workspace.uint16.length < length) {
      workspace.uint16 = new Uint16Array(length);
    }
    return workspace.uint16;
  }
  if (workspace.uint32 === undefined || workspace.uint32.length < length) {
    workspace.uint32 = new Uint32Array(length);
  }
  return workspace.uint32;
};

const planGeometryArenas = (
  surfaces: readonly CanonicalDrawSurface[],
): Readonly<{
  key: string;
  plans: readonly PlannedGeometryArena[];
  uploads: ReadonlyMap<string, PlannedGeometry>;
}> => {
  const byLayout = new Map<number, PendingGeometry[]>();
  const keys = new Set<string>();
  for (const surface of surfaces) {
    const key = surfaceGeometryResourceKey(surface);
    if (keys.has(key)) continue;
    keys.add(key);
    const layout = geometryLayout(surface);
    const entries = byLayout.get(layout);
    if (entries === undefined) byLayout.set(layout, [{ key, surface }]);
    else entries.push({ key, surface });
  }
  const plans: PlannedGeometryArena[] = [];
  const identity: unknown[] = [];
  for (const [layout, entries] of byLayout) {
    const inputs = entries.map(({ surface }) => ({
      indices: surface.geometry.indices,
      vertexCount: surface.geometry.positions.length / 3,
    }));
    for (const chunk of planGeometryBatchChunks(
      inputs,
      geometryVertexStrideBytes(layout),
      DEFAULT_GPU_UPLOAD_BYTE_BUDGET_PER_FRAME,
    )) {
      const chunkEntries = entries.slice(chunk.start, chunk.end);
      const batch = planGeometryBatchLayout(inputs.slice(chunk.start, chunk.end));
      const planIndex = plans.length;
      plans.push({
        batch,
        entries: chunkEntries.map((entry, index) => ({
          ...entry,
          planIndex,
          range: batch.ranges[index]!,
        })),
        layout,
      });
    }
    identity.push(layout, entries.map(({ key, surface }) => [
      key,
      surface.geometry.positions.length,
      surface.geometry.indices.length,
    ]));
  }
  const uploads = new Map<string, PlannedGeometry>();
  for (const plan of plans) {
    for (const entry of plan.entries) uploads.set(entry.key, entry);
  }
  return { key: JSON.stringify(identity), plans, uploads };
};

/** Owns geometry buffers and vertex arrays for one context generation. */
export class SurfaceGeometryGpuOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #gl: WebGL2RenderingContext;
  readonly #uploadBudget: FrameUploadBudgetOwner;
  #geometryArenas: (GpuGeometryArena | undefined)[] = [];
  #geometryPlanKey = "";
  #geometryResourcesByKey = new Map<string, GpuGeometry>();
  #indexUploadWorkspace: GeometryIndexUploadWorkspace = {};
  #uploadedGeometryKeys = new Set<string>();
  #plannedGeometry: ReturnType<typeof planGeometryArenas> | null = null;
  #plannedSurfaces: readonly CanonicalDrawSurface[] | null = null;
  #instanceResources: readonly GpuInstanceData[] = [];
  #instanceVertexArrays: readonly GpuInstanceVertexArray[] = [];

  constructor(
    gl: WebGL2RenderingContext,
    budget = new PersistentGpuBudgetOwner(),
    uploadBudget = new FrameUploadBudgetOwner(),
  ) {
    this.#gl = gl;
    this.#budget = budget;
    this.#uploadBudget = uploadBudget;
  }

  beginFrame(): void {
    this.#uploadBudget.beginFrame();
  }

  snapshot(): FrameUploadBudgetSnapshot {
    return this.#uploadBudget.snapshot();
  }

  dispose(): void {
    this.#deleteResources();
    this.#indexUploadWorkspace = {};
    this.#plannedGeometry = null;
    this.#plannedSurfaces = null;
  }

  invalidate(): void {
    for (const resource of this.#instanceResources) this.#budget.release(resource.budgetIdentity);
    for (const arena of this.#geometryArenas) {
      if (arena !== undefined) this.#budget.release(arena.budgetIdentity);
    }
    this.#geometryArenas = [];
    this.#geometryPlanKey = "";
    this.#geometryResourcesByKey.clear();
    this.#indexUploadWorkspace = {};
    this.#uploadedGeometryKeys.clear();
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
  }

  #deleteGeometryArena(arena: GpuGeometryArena): void {
    this.#gl.deleteBuffer(arena.indexBuffer);
    if (arena.normalBuffer !== null) this.#gl.deleteBuffer(arena.normalBuffer);
    if (arena.colorBuffer !== null) this.#gl.deleteBuffer(arena.colorBuffer);
    if (arena.tangentBuffer !== null) this.#gl.deleteBuffer(arena.tangentBuffer);
    if (arena.textureCoordinateBuffer !== null) {
      this.#gl.deleteBuffer(arena.textureCoordinateBuffer);
    }
    if (arena.textureCoordinate1Buffer !== null) {
      this.#gl.deleteBuffer(arena.textureCoordinate1Buffer);
    }
    this.#gl.deleteBuffer(arena.vertexBuffer);
    this.#gl.deleteVertexArray(arena.vertexArray);
    this.#budget.release(arena.budgetIdentity);
  }

  #deleteResources(): void {
    for (const resource of this.#instanceVertexArrays) {
      this.#gl.deleteVertexArray(resource.vertexArray);
    }
    for (const resource of this.#instanceResources) {
      this.#gl.deleteBuffer(resource.buffer);
      this.#budget.release(resource.budgetIdentity);
    }
    for (const arena of this.#geometryArenas) {
      if (arena !== undefined) this.#deleteGeometryArena(arena);
    }
    this.#geometryArenas = [];
    this.#geometryPlanKey = "";
    this.#geometryResourcesByKey.clear();
    this.#uploadedGeometryKeys.clear();
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
  }

  #createGeometryArena(plan: PlannedGeometryArena): Readonly<{
    arena: GpuGeometryArena;
    geometries: readonly GpuGeometry[];
  }> {
    const gl = this.#gl;
    const { batch, entries, layout } = plan;
    const hasNormals = (layout & 1) !== 0;
    const hasTangents = (layout & 2) !== 0;
    const hasTextureCoordinates = (layout & 4) !== 0;
    const hasTextureCoordinates1 = (layout & 8) !== 0;
    const hasColors = (layout & 16) !== 0;
    const byteLength = geometryBatchLayoutByteLength(
      batch,
      geometryVertexStrideBytes(layout),
    );
    const budgetIdentity = {};
    if (!this.#budget.tryClaim(budgetIdentity, byteLength)) {
      throw new Error("Royal persistent GPU budget denied surface geometry");
    }
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const normalBuffer = hasNormals ? gl.createBuffer() : null;
    const colorBuffer = hasColors ? gl.createBuffer() : null;
    const tangentBuffer = hasTangents ? gl.createBuffer() : null;
    const textureCoordinateBuffer = hasTextureCoordinates ? gl.createBuffer() : null;
    const textureCoordinate1Buffer = hasTextureCoordinates1 ? gl.createBuffer() : null;
    if (
      vertexArray === null
      || vertexBuffer === null
      || indexBuffer === null
      || (hasNormals && normalBuffer === null)
      || (hasColors && colorBuffer === null)
      || (hasTangents && tangentBuffer === null)
      || (hasTextureCoordinates && textureCoordinateBuffer === null)
      || (hasTextureCoordinates1 && textureCoordinate1Buffer === null)
    ) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (colorBuffer !== null) gl.deleteBuffer(colorBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      if (textureCoordinate1Buffer !== null) gl.deleteBuffer(textureCoordinate1Buffer);
      this.#budget.release(budgetIdentity);
      throw new Error("Royal could not allocate surface geometry");
    }
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 3 * 4, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (normalBuffer === null) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 3 * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (colorBuffer === null) {
        gl.disableVertexAttribArray(12);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 4 * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(12);
        gl.vertexAttribPointer(12, 4, gl.FLOAT, false, 0, 0);
      }
      if (textureCoordinateBuffer === null) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordinateBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 2 * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (textureCoordinate1Buffer === null) {
        gl.disableVertexAttribArray(11);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, textureCoordinate1Buffer);
        gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 2 * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(11);
        gl.vertexAttribPointer(11, 2, gl.FLOAT, false, 0, 0);
      }
      if (tangentBuffer === null) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, tangentBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, batch.vertexCount * 4 * 4, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, batch.indexCount * batch.indexBytes, gl.STATIC_DRAW);
      const arena = {
        budgetIdentity,
        colorBuffer,
        indexBuffer,
        normalBuffer,
        tangentBuffer,
        textureCoordinateBuffer,
        textureCoordinate1Buffer,
        vertexArray,
        vertexBuffer,
      };
      return {
        arena,
        geometries: entries.map((entry): GpuGeometry => ({
          arena,
          colorBuffer,
          indexBuffer,
          indexCount: entry.range.indexCount,
          indexOffset: entry.range.indexByteOffset,
          indexType: indexType(gl, batch.indexBytes),
          key: entry.key,
          normalBuffer,
          tangentBuffer,
          textureCoordinateBuffer,
          textureCoordinate1Buffer,
          vertexArray,
          vertexBuffer,
        })),
      };
    } catch (error) {
      gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
      if (colorBuffer !== null) gl.deleteBuffer(colorBuffer);
      if (tangentBuffer !== null) gl.deleteBuffer(tangentBuffer);
      if (textureCoordinateBuffer !== null) gl.deleteBuffer(textureCoordinateBuffer);
      if (textureCoordinate1Buffer !== null) gl.deleteBuffer(textureCoordinate1Buffer);
      gl.deleteBuffer(vertexBuffer);
      gl.deleteVertexArray(vertexArray);
      this.#budget.release(budgetIdentity);
      throw error;
    }
  }

  #uploadGeometry(
    arena: GpuGeometryArena,
    plan: PlannedGeometryArena,
    entry: PlannedGeometry,
    indexWorkspace: GeometryIndexUploadWorkspace,
  ): void {
    const gl = this.#gl;
    const geometry = entry.surface.geometry;
    const vertexOffset = entry.range.vertexOffset;
    gl.bindVertexArray(arena.vertexArray);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, arena.indexBuffer);
    if (
      vertexOffset === 0
      && geometry.indices.BYTES_PER_ELEMENT === plan.batch.indexBytes
    ) {
      gl.bufferSubData(
        gl.ELEMENT_ARRAY_BUFFER,
        entry.range.indexByteOffset,
        geometry.indices,
      );
    } else {
      const rebasedIndices = indexUploadWorkspace(
        indexWorkspace,
        plan.batch.indexBytes,
        geometry.indices.length,
      );
      for (let index = 0; index < geometry.indices.length; index += 1) {
        rebasedIndices[index] = vertexOffset + geometry.indices[index]!;
      }
      gl.bufferSubData(
        gl.ELEMENT_ARRAY_BUFFER,
        entry.range.indexByteOffset,
        rebasedIndices,
        0,
        geometry.indices.length,
      );
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, arena.vertexBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, vertexOffset * 3 * 4, geometry.positions);
    if (arena.normalBuffer !== null) {
      if (geometry.normals === undefined) {
        throw new Error("Royal geometry arena is missing NORMAL data");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.normalBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, vertexOffset * 3 * 4, geometry.normals);
    }
    if (arena.colorBuffer !== null) {
      if (geometry.colors === undefined) {
        throw new Error("Royal geometry arena is missing COLOR_0 data");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.colorBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, vertexOffset * 4 * 4, geometry.colors);
    }
    if (arena.textureCoordinateBuffer !== null) {
      if (geometry.textureCoordinates0 === undefined) {
        throw new Error("Royal textured surface requires TEXCOORD_0 geometry");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.textureCoordinateBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        vertexOffset * 2 * 4,
        geometry.textureCoordinates0,
      );
    }
    if (arena.textureCoordinate1Buffer !== null) {
      if (geometry.textureCoordinates1 === undefined) {
        throw new Error("Royal textured surface requires TEXCOORD_1 geometry");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.textureCoordinate1Buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        vertexOffset * 2 * 4,
        geometry.textureCoordinates1,
      );
    }
    if (arena.tangentBuffer !== null) {
      if (geometry.tangents === undefined) {
        throw new Error("Royal geometry arena is missing TANGENT data");
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, arena.tangentBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, vertexOffset * 4 * 4, geometry.tangents);
    }
  }

  #prepareInstanceValues(surface: CanonicalDrawSurface): Float32Array {
    const instances = surface.instances;
    if (
      instances === undefined
      || !Number.isSafeInteger(instances.count)
      || instances.count < 1
      || instances.localModels.length !== instances.count * 16
    ) throw new Error("Royal instanced surface has invalid matrix storage");
    const values = new Float32Array(instances.count * 28);
    const model = identityMat4();
    const normal = identityMat4();
    for (let instance = 0; instance < instances.count; instance += 1) {
      const sourceOffset = instance * 16;
      const targetOffset = instance * 28;
      for (let component = 0; component < 16; component += 1) {
        const value = instances.localModels[sourceOffset + component];
        if (value === undefined || !Number.isFinite(value)) {
          throw new Error(`Royal instance ${instance} matrix is not finite`);
        }
        model[component] = value;
        values[targetOffset + component] = value;
      }
      affineSurfaceNormalTransformInto(normal, model);
      for (let column = 0; column < 3; column += 1) {
        const normalSource = column * 4;
        const normalTarget = targetOffset + 16 + column * 4;
        values[normalTarget] = normal[normalSource]!;
        values[normalTarget + 1] = normal[normalSource + 1]!;
        values[normalTarget + 2] = normal[normalSource + 2]!;
        values[normalTarget + 3] = column === 2 ? normal[15] : 0;
      }
    }
    return values;
  }

  #createInstanceData(surface: CanonicalDrawSurface): GpuInstanceData {
    const instances = surface.instances!;
    const values = this.#prepareInstanceValues(surface);
    const budgetIdentity = {};
    if (!this.#budget.tryClaim(budgetIdentity, values.byteLength)) {
      throw new Error("Royal persistent GPU budget denied instance transforms");
    }
    const buffer = this.#gl.createBuffer();
    if (buffer === null) {
      this.#budget.release(budgetIdentity);
      throw new Error("Royal could not allocate instance transforms");
    }
    try {
      this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, buffer);
      this.#gl.bufferData(this.#gl.ARRAY_BUFFER, values, this.#gl.STATIC_DRAW);
      return {
        budgetIdentity,
        buffer,
        count: instances.count,
        key: instances.key,
        ...(instances.revision === undefined ? {} : { revision: instances.revision }),
      };
    } catch (error) {
      this.#gl.deleteBuffer(buffer);
      this.#budget.release(budgetIdentity);
      throw error;
    }
  }

  #createInstanceVertexArray(
    geometry: GpuGeometry,
    instances: GpuInstanceData,
    key: string,
  ): GpuInstanceVertexArray {
    const gl = this.#gl;
    const vertexArray = gl.createVertexArray();
    if (vertexArray === null) throw new Error("Royal could not allocate an instanced vertex array");
    try {
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, geometry.vertexBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      if (geometry.normalBuffer === null) {
        gl.disableVertexAttribArray(1);
        gl.vertexAttrib3f(1, 0, 0, 0);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.normalBuffer);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      }
      if (geometry.colorBuffer === null) {
        gl.disableVertexAttribArray(12);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.colorBuffer);
        gl.enableVertexAttribArray(12);
        gl.vertexAttribPointer(12, 4, gl.FLOAT, false, 0, 0);
      }
      if (geometry.textureCoordinateBuffer === null) {
        gl.disableVertexAttribArray(2);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.textureCoordinateBuffer);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);
      }
      if (geometry.textureCoordinate1Buffer === null) {
        gl.disableVertexAttribArray(11);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.textureCoordinate1Buffer);
        gl.enableVertexAttribArray(11);
        gl.vertexAttribPointer(11, 2, gl.FLOAT, false, 0, 0);
      }
      if (geometry.tangentBuffer === null) {
        gl.disableVertexAttribArray(10);
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, geometry.tangentBuffer);
        gl.enableVertexAttribArray(10);
        gl.vertexAttribPointer(10, 4, gl.FLOAT, false, 0, 0);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, instances.buffer);
      const stride = 28 * 4;
      for (let column = 0; column < 4; column += 1) {
        const location = 3 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 4, gl.FLOAT, false, stride, column * 16);
        gl.vertexAttribDivisor(location, 1);
      }
      for (let column = 0; column < 3; column += 1) {
        const location = 7 + column;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(
          location,
          column === 2 ? 4 : 3,
          gl.FLOAT,
          false,
          stride,
          64 + column * 16,
        );
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer);
      return { key, vertexArray };
    } catch (error) {
      gl.deleteVertexArray(vertexArray);
      throw error;
    }
  }

  prepare(
    surfaces: readonly CanonicalDrawSurface[],
    admittedCount = surfaces.length,
    retainedSurfaceCount = 0,
  ): SurfaceGeometryPlan {
    let planned = this.#plannedGeometry;
    if (this.#plannedSurfaces !== surfaces || planned === null) {
      planned = planGeometryArenas(surfaces);
      this.#plannedGeometry = planned;
      this.#plannedSurfaces = surfaces;
    }
    const geometryPlanChanged = planned.key !== this.#geometryPlanKey;
    const surfaceOffset = geometryPlanChanged ? 0 : retainedSurfaceCount;
    const retainsPrefix = surfaceOffset > 0;
    if (geometryPlanChanged) this.#indexUploadWorkspace = {};
    const previousInstancesByKey = new Map(
      this.#instanceResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstanceVaosByKey = geometryPlanChanged
      ? new Map<string, GpuInstanceVertexArray>()
      : new Map(
        this.#instanceVertexArrays.map((resource) => [resource.key, resource] as const),
      );
    const nextInstancesByKey = new Map(
      retainsPrefix ? previousInstancesByKey : undefined,
    );
    const nextInstanceVaosByKey = new Map(
      retainsPrefix ? previousInstanceVaosByKey : undefined,
    );
    const nextInstanceResources: GpuInstanceData[] = retainsPrefix
      ? [...this.#instanceResources]
      : [];
    const nextInstanceVertexArrays: GpuInstanceVertexArray[] = retainsPrefix
      ? [...this.#instanceVertexArrays]
      : [];
    const nextSurfaces: GpuGeometrySurface[] = [];
    const stagedGeometryByKey = new Map<string, GpuGeometry>();
    const stagedUploadedGeometryKeys = new Set<string>();
    const createdArenas: GpuGeometryArena[] = [];
    const createdArenaIndices: number[] = [];
    const createdInstances: GpuInstanceData[] = [];
    const createdInstanceVaos: GpuInstanceVertexArray[] = [];
    const pendingInstanceUpdates = new Map<GpuInstanceData, Readonly<{
      revision: string;
      values: Float32Array;
    }>>();
    try {
      for (
        let surfaceIndex = surfaceOffset;
        surfaceIndex < admittedCount;
        surfaceIndex += 1
      ) {
        const surface = surfaces[surfaceIndex]!;
        const key = surfaceGeometryResourceKey(surface);
        let geometry = stagedGeometryByKey.get(key)
          ?? (geometryPlanChanged ? undefined : this.#geometryResourcesByKey.get(key));
        const geometryUpload = planned.uploads.get(key)!;
        const geometryArenaPlan = planned.plans[geometryUpload.planIndex]!;
        const instances = surface.instances;
        let instanceData = instances === undefined
          ? undefined
          : nextInstancesByKey.get(instances.key)
            ?? previousInstancesByKey.get(instances.key);
        const instanceUploadRequired = instances !== undefined && (
          instanceData === undefined
          || (
            instances.revision !== undefined
            && instances.revision !== instanceData.revision
            && !pendingInstanceUpdates.has(instanceData)
          )
        );
        if (
          instances !== undefined
          && instanceData !== undefined
          && instanceUploadRequired
          && instances.count !== instanceData.count
        ) {
          throw new Error("Royal instance count changed for a retained key");
        }
        const geometryUploaded = stagedUploadedGeometryKeys.has(key)
          || (!geometryPlanChanged && this.#uploadedGeometryKeys.has(key));
        const uploadByteLength = (geometryUploaded
          ? 0
          : surfaceGeometryUploadByteLength(surface, geometryArenaPlan.batch.indexBytes))
          + (instanceUploadRequired ? surfaceInstanceUploadByteLength(surface) : 0);
        if (!this.#uploadBudget.tryAdmit(uploadByteLength)) break;
        if (geometry === undefined) {
          const created = this.#createGeometryArena(geometryArenaPlan);
          createdArenas.push(created.arena);
          createdArenaIndices.push(geometryUpload.planIndex);
          for (const resource of created.geometries) {
            stagedGeometryByKey.set(resource.key, resource);
          }
          geometry = stagedGeometryByKey.get(key)!;
        }
        if (!geometryUploaded) {
          this.#uploadGeometry(
            geometry.arena,
            geometryArenaPlan,
            geometryUpload,
            this.#indexUploadWorkspace,
          );
          stagedUploadedGeometryKeys.add(key);
        }
        let instanceCount = 0;
        let vertexArray = geometry.vertexArray;
        if (instances !== undefined) {
          if (instanceData === undefined) {
            instanceData = this.#createInstanceData(surface);
            createdInstances.push(instanceData);
          } else if (
            instances.revision !== undefined
            && instances.revision !== instanceData.revision
            && !pendingInstanceUpdates.has(instanceData)
          ) {
            pendingInstanceUpdates.set(instanceData, {
              revision: instances.revision,
              values: this.#prepareInstanceValues(surface),
            });
          }
          if (!nextInstancesByKey.has(instances.key)) {
            nextInstancesByKey.set(instances.key, instanceData);
            nextInstanceResources.push(instanceData);
          }
          const vaoKey = JSON.stringify([key, instances.key]);
          let instanceVao = nextInstanceVaosByKey.get(vaoKey)
            ?? previousInstanceVaosByKey.get(vaoKey);
          if (instanceVao === undefined) {
            instanceVao = this.#createInstanceVertexArray(geometry, instanceData, vaoKey);
            createdInstanceVaos.push(instanceVao);
          }
          if (!nextInstanceVaosByKey.has(vaoKey)) {
            nextInstanceVaosByKey.set(vaoKey, instanceVao);
            nextInstanceVertexArrays.push(instanceVao);
          }
          instanceCount = instanceData.count;
          vertexArray = instanceVao.vertexArray;
        }
        nextSurfaces.push({ geometry, instanceCount, surface, vertexArray });
      }
      const uploadedGeometryCount = stagedUploadedGeometryKeys.size
        + (geometryPlanChanged ? 0 : this.#uploadedGeometryKeys.size);
      const geometryResourceCount = stagedGeometryByKey.size
        + (geometryPlanChanged ? 0 : this.#geometryResourcesByKey.size);
      if (uploadedGeometryCount === geometryResourceCount) {
        this.#indexUploadWorkspace = {};
      }
    } catch (error) {
      for (const resource of createdInstanceVaos) this.#gl.deleteVertexArray(resource.vertexArray);
      for (const resource of createdInstances) {
        this.#gl.deleteBuffer(resource.buffer);
        this.#budget.release(resource.budgetIdentity);
      }
      for (const arena of createdArenas) this.#deleteGeometryArena(arena);
      throw error;
    }

    let settled = false;
    return {
      commit: () => {
        if (settled) return;
        settled = true;
        for (const [resource, update] of pendingInstanceUpdates) {
          this.#gl.bindBuffer(this.#gl.ARRAY_BUFFER, resource.buffer);
          this.#gl.bufferSubData(this.#gl.ARRAY_BUFFER, 0, update.values);
          resource.revision = update.revision;
        }
        for (const resource of this.#instanceVertexArrays) {
          if (nextInstanceVaosByKey.get(resource.key) !== resource) {
            this.#gl.deleteVertexArray(resource.vertexArray);
          }
        }
        for (const resource of this.#instanceResources) {
          if (nextInstancesByKey.get(resource.key) !== resource) {
            this.#gl.deleteBuffer(resource.buffer);
            this.#budget.release(resource.budgetIdentity);
          }
        }
        if (geometryPlanChanged) {
          for (const arena of this.#geometryArenas) {
            if (arena !== undefined) this.#deleteGeometryArena(arena);
          }
          const nextGeometryArenas: (GpuGeometryArena | undefined)[] = Array(
            planned.plans.length,
          );
          for (let index = 0; index < createdArenas.length; index += 1) {
            nextGeometryArenas[createdArenaIndices[index]!] = createdArenas[index]!;
          }
          this.#geometryArenas = nextGeometryArenas;
          this.#geometryResourcesByKey = stagedGeometryByKey;
          this.#uploadedGeometryKeys = stagedUploadedGeometryKeys;
        } else {
          for (let index = 0; index < createdArenas.length; index += 1) {
            this.#geometryArenas[createdArenaIndices[index]!] = createdArenas[index]!;
          }
          for (const [key, resource] of stagedGeometryByKey) {
            this.#geometryResourcesByKey.set(key, resource);
          }
          for (const key of stagedUploadedGeometryKeys) {
            this.#uploadedGeometryKeys.add(key);
          }
        }
        this.#geometryPlanKey = planned.key;
        this.#instanceResources = nextInstanceResources;
        this.#instanceVertexArrays = nextInstanceVertexArrays;
      },
      rollback: () => {
        if (settled) return;
        settled = true;
        for (const resource of createdInstanceVaos) {
          this.#gl.deleteVertexArray(resource.vertexArray);
        }
        for (const resource of createdInstances) {
          this.#gl.deleteBuffer(resource.buffer);
          this.#budget.release(resource.budgetIdentity);
        }
        for (const arena of createdArenas) this.#deleteGeometryArena(arena);
      },
      offset: surfaceOffset,
      surfaces: nextSurfaces,
    };
  }

}

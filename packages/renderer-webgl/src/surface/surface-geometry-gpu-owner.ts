import {
  affineSurfaceNormalTransformInto,
  identityMat4,
} from "../math/mat4";
import type { CanonicalDrawSurface } from "./scene-lowering";
import {
  surfaceGeometryResourceKey,
  surfaceUsesTextureCoordinateSet,
} from "./gpu-admission";
import {
  planGeometryBatchLayout,
  validateGeometryIndices,
  writeRebasedGeometryIndices,
  type GeometryIndexArray,
  type GeometryBatchLayoutPlan,
  type GeometryBatchRange,
} from "./geometry-batch-plan";
import { PersistentGpuBudgetOwner } from "../resource/persistent-gpu-budget";

type GpuGeometryArena = Readonly<{
  budgetIdentity: object;
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
  return layout;
};

type PendingGeometry = Readonly<{
  key: string;
  surface: CanonicalDrawSurface;
}>;

type PlannedGeometry = PendingGeometry & Readonly<{
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
): Readonly<{ key: string; plans: readonly PlannedGeometryArena[] }> => {
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
    const batch = planGeometryBatchLayout(entries.map(({ surface }) => ({
      indices: surface.geometry.indices,
      vertexCount: surface.geometry.positions.length / 3,
    })));
    plans.push({
      batch,
      entries: entries.map((entry, index) => ({
        ...entry,
        range: batch.ranges[index]!,
      })),
      layout,
    });
    identity.push(layout, entries.map(({ key, surface }) => [
      key,
      surface.geometry.positions.length,
      surface.geometry.indices.length,
    ]));
  }
  return { key: JSON.stringify(identity), plans };
};

/** Owns geometry buffers and vertex arrays for one context generation. */
export class SurfaceGeometryGpuOwner {
  readonly #budget: PersistentGpuBudgetOwner;
  readonly #gl: WebGL2RenderingContext;
  #geometryArenas: readonly GpuGeometryArena[] = [];
  #geometryPlanKey = "";
  #geometryResources: readonly GpuGeometry[] = [];
  #indexUploadWorkspace: GeometryIndexUploadWorkspace = {};
  #uploadedGeometryKeys = new Set<string>();
  #plannedGeometry: ReturnType<typeof planGeometryArenas> | null = null;
  #plannedSurfaces: readonly CanonicalDrawSurface[] | null = null;
  #instanceResources: readonly GpuInstanceData[] = [];
  #instanceVertexArrays: readonly GpuInstanceVertexArray[] = [];

  constructor(gl: WebGL2RenderingContext, budget = new PersistentGpuBudgetOwner()) {
    this.#gl = gl;
    this.#budget = budget;
  }

  dispose(): void {
    this.#deleteResources();
    this.#indexUploadWorkspace = {};
    this.#plannedGeometry = null;
    this.#plannedSurfaces = null;
  }

  invalidate(): void {
    for (const resource of this.#instanceResources) this.#budget.release(resource.budgetIdentity);
    for (const arena of this.#geometryArenas) this.#budget.release(arena.budgetIdentity);
    this.#geometryArenas = [];
    this.#geometryPlanKey = "";
    this.#geometryResources = [];
    this.#indexUploadWorkspace = {};
    this.#uploadedGeometryKeys.clear();
    this.#instanceResources = [];
    this.#instanceVertexArrays = [];
  }

  #deleteGeometryArena(arena: GpuGeometryArena): void {
    this.#gl.deleteBuffer(arena.indexBuffer);
    if (arena.normalBuffer !== null) this.#gl.deleteBuffer(arena.normalBuffer);
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
    for (const arena of this.#geometryArenas) this.#deleteGeometryArena(arena);
    this.#geometryArenas = [];
    this.#geometryPlanKey = "";
    this.#geometryResources = [];
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
    const byteLength = batch.indexCount * batch.indexBytes + batch.vertexCount * (
      3 * 4
      + (hasNormals ? 3 * 4 : 0)
      + (hasTangents ? 4 * 4 : 0)
      + (hasTextureCoordinates ? 2 * 4 : 0)
      + (hasTextureCoordinates1 ? 2 * 4 : 0)
    );
    const budgetIdentity = {};
    if (!this.#budget.tryClaim(budgetIdentity, byteLength)) {
      throw new Error("Royal persistent GPU budget denied surface geometry");
    }
    const vertexArray = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const normalBuffer = hasNormals ? gl.createBuffer() : null;
    const tangentBuffer = hasTangents ? gl.createBuffer() : null;
    const textureCoordinateBuffer = hasTextureCoordinates ? gl.createBuffer() : null;
    const textureCoordinate1Buffer = hasTextureCoordinates1 ? gl.createBuffer() : null;
    if (
      vertexArray === null
      || vertexBuffer === null
      || indexBuffer === null
      || (hasNormals && normalBuffer === null)
      || (hasTangents && tangentBuffer === null)
      || (hasTextureCoordinates && textureCoordinateBuffer === null)
      || (hasTextureCoordinates1 && textureCoordinate1Buffer === null)
    ) {
      if (vertexArray !== null) gl.deleteVertexArray(vertexArray);
      if (vertexBuffer !== null) gl.deleteBuffer(vertexBuffer);
      if (indexBuffer !== null) gl.deleteBuffer(indexBuffer);
      if (normalBuffer !== null) gl.deleteBuffer(normalBuffer);
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
    const vertexCount = geometry.positions.length / 3;
    if (
      vertexOffset === 0
      && geometry.indices.BYTES_PER_ELEMENT === plan.batch.indexBytes
    ) {
      validateGeometryIndices(geometry.indices, vertexCount);
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
      writeRebasedGeometryIndices(
        rebasedIndices,
        geometry.indices,
        vertexOffset,
        vertexCount,
      );
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
  ): SurfaceGeometryPlan {
    let planned = this.#plannedGeometry;
    if (this.#plannedSurfaces !== surfaces || planned === null) {
      planned = planGeometryArenas(surfaces);
      this.#plannedGeometry = planned;
      this.#plannedSurfaces = surfaces;
    }
    const geometryPlanChanged = planned.key !== this.#geometryPlanKey;
    if (geometryPlanChanged) this.#indexUploadWorkspace = {};
    const previousInstancesByKey = new Map(
      this.#instanceResources.map((resource) => [resource.key, resource] as const),
    );
    const previousInstanceVaosByKey = geometryPlanChanged
      ? new Map<string, GpuInstanceVertexArray>()
      : new Map(
        this.#instanceVertexArrays.map((resource) => [resource.key, resource] as const),
      );
    const nextInstancesByKey = new Map<string, GpuInstanceData>();
    const nextInstanceVaosByKey = new Map<string, GpuInstanceVertexArray>();
    const nextGeometryResources: GpuGeometry[] = geometryPlanChanged
      ? []
      : [...this.#geometryResources];
    const nextGeometryArenas: GpuGeometryArena[] = geometryPlanChanged
      ? []
      : [...this.#geometryArenas];
    const nextUploadedGeometryKeys = new Set(
      geometryPlanChanged ? [] : this.#uploadedGeometryKeys,
    );
    const nextInstanceResources: GpuInstanceData[] = [];
    const nextInstanceVertexArrays: GpuInstanceVertexArray[] = [];
    const nextSurfaces: GpuGeometrySurface[] = [];
    const geometryByKey = new Map<string, GpuGeometry>();
    const uploadByKey = new Map<string, Readonly<{
      arena: GpuGeometryArena;
      entry: PlannedGeometry;
      plan: PlannedGeometryArena;
    }>>();
    const createdArenas: GpuGeometryArena[] = [];
    const createdInstances: GpuInstanceData[] = [];
    const createdInstanceVaos: GpuInstanceVertexArray[] = [];
    const pendingInstanceUpdates = new Map<GpuInstanceData, Readonly<{
      revision: string;
      values: Float32Array;
    }>>();
    try {
      if (
        !geometryPlanChanged
        && nextGeometryArenas.length !== planned.plans.length
      ) throw new Error("Royal retained an inconsistent geometry arena plan");
      for (let planIndex = 0; planIndex < planned.plans.length; planIndex += 1) {
        const plan = planned.plans[planIndex]!;
        let arena = nextGeometryArenas[planIndex];
        if (arena === undefined) {
          const created = this.#createGeometryArena(plan);
          arena = created.arena;
          createdArenas.push(arena);
          nextGeometryArenas.push(arena);
          nextGeometryResources.push(...created.geometries);
        }
        for (const entry of plan.entries) {
          uploadByKey.set(entry.key, { arena, entry, plan });
        }
      }
      for (const geometry of nextGeometryResources) geometryByKey.set(geometry.key, geometry);
      for (let surfaceIndex = 0; surfaceIndex < admittedCount; surfaceIndex += 1) {
        const surface = surfaces[surfaceIndex]!;
        const key = surfaceGeometryResourceKey(surface);
        const geometry = geometryByKey.get(key);
        if (geometry === undefined) throw new Error("Royal geometry arena omitted a resource");
        if (!nextUploadedGeometryKeys.has(key)) {
          const upload = uploadByKey.get(key);
          if (upload === undefined) throw new Error("Royal geometry arena omitted an upload range");
          this.#uploadGeometry(
            upload.arena,
            upload.plan,
            upload.entry,
            this.#indexUploadWorkspace,
          );
          nextUploadedGeometryKeys.add(key);
        }
        let instanceCount = 0;
        let vertexArray = geometry.vertexArray;
        const instances = surface.instances;
        if (instances !== undefined) {
          let instanceData = nextInstancesByKey.get(instances.key)
            ?? previousInstancesByKey.get(instances.key);
          if (instanceData === undefined) {
            instanceData = this.#createInstanceData(surface);
            createdInstances.push(instanceData);
          } else if (
            instances.revision !== undefined
            && instances.revision !== instanceData.revision
            && !pendingInstanceUpdates.has(instanceData)
          ) {
            if (instances.count !== instanceData.count) {
              throw new Error("Royal retained instance count changed without a new resource key");
            }
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
      if (nextUploadedGeometryKeys.size === nextGeometryResources.length) {
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
          for (const arena of this.#geometryArenas) this.#deleteGeometryArena(arena);
        }
        this.#geometryArenas = nextGeometryArenas;
        this.#geometryPlanKey = planned.key;
        this.#geometryResources = nextGeometryResources;
        this.#uploadedGeometryKeys = nextUploadedGeometryKeys;
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
      surfaces: nextSurfaces,
    };
  }

}

import type { CpuGeometry } from "./geometry-recipes";
import { claimMonotonicId, MAX_RESOURCE_ID } from "./resource-id";
import {
  findVerifiedGeometry,
  GEOMETRY_BUCKET_COMPARISON_LIMIT,
  sameGeometryBytes,
} from "./webgl/geometry-identity";
import { VERTEX_ATTRIBUTE } from "./webgl/vertex-attribute-abi";

export interface VertexInputSemanticRow {
  readonly geometryId: number;
  readonly recipe: CpuGeometry;
}

export interface VertexInputInstanceBuffers {
  readonly localModelBuffer: WebGLBuffer;
  readonly rootPoseBuffer: WebGLBuffer;
  readonly rootScaleBuffer: WebGLBuffer;
}

export interface VertexInputGeometry {
  readonly arrayBuffer: WebGLBuffer;
  readonly colorBuffer?: WebGLBuffer;
  readonly drawCount: number;
  readonly indexBuffer?: WebGLBuffer;
  readonly indexType?: number;
  readonly mode: CpuGeometry["mode"];
  readonly normalBuffer?: WebGLBuffer;
  readonly source: CpuGeometry;
  /** Generation-local physical identity; never a semantic or frame-packet resource ID. */
  readonly staticIdentityId: number;
  readonly tangentBuffer?: WebGLBuffer;
  readonly texCoord0Buffer?: WebGLBuffer;
  readonly texCoord1Buffer?: WebGLBuffer;
  readonly vertexCount: number;
}

export interface VertexInputArenaSnapshot {
  readonly baseVertexArrayCount: number;
  readonly compositeVertexArrayCount: number;
  readonly contextGeneration?: number;
  readonly instanceGeometryEdges: ReadonlyMap<number, ReadonlySet<number>>;
  readonly identityBucketSizes: ReadonlyMap<string, number>;
  readonly semanticGeometryIds: ReadonlySet<number>;
  readonly semanticGeometryCount: number;
  readonly staticGeometryCount: number;
}

type CompositeVertexArray = {
  readonly buffers: VertexInputInstanceBuffers;
  geometryReferenceCount: number;
  readonly vertexArray: WebGLVertexArrayObject;
};

type StaticGeometry = VertexInputGeometry & {
  baseVertexArray?: WebGLVertexArrayObject;
  readonly bucketKey: string;
  readonly compositeVertexArrays: Map<number, CompositeVertexArray>;
  readonly geometryIds: Set<number>;
  joinedIdentityBucket: boolean;
};

type SemanticGeometry = {
  readonly geometryId: number;
  readonly instanceKeys: Set<number>;
  readonly recipe: CpuGeometry;
  staticGeometry?: StaticGeometry;
};

declare const vertexInputArenaAuthority: unique symbol;

/** Explicit authority token; only this module can inspect or mutate its state. */
export interface VertexInputArena {
  readonly [vertexInputArenaAuthority]: "VertexInputArena";
}

interface VertexInputArenaState {
  contextDropped: boolean;
  contextGeneration?: number;
  readonly geometryBuckets: Map<string, StaticGeometry[]>;
  readonly instanceBuffers: Map<number, VertexInputInstanceBuffers>;
  readonly instanceGeometryIds: Map<number, Set<number>>;
  nextStaticIdentityId: number;
  readonly semantics: Map<number, SemanticGeometry>;
  readonly staticGeometries: Set<StaticGeometry>;
}

export const createVertexInputArena = (): VertexInputArena => ({
  contextDropped: false,
  geometryBuckets: new Map(),
  instanceBuffers: new Map(),
  instanceGeometryIds: new Map(),
  nextStaticIdentityId: 1,
  semantics: new Map(),
  staticGeometries: new Set(),
} as unknown as VertexInputArena);

const validSerial = (value: number, label: string): void => {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label} ${value}`);
};

const validGeometryId = (value: number): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_RESOURCE_ID) {
    throw new Error(`Invalid geometry ID ${value}; expected an unsigned 32-bit resource ID`);
  }
};

export const retainVertexInputGeometry = (
  arena: VertexInputArena,
  row: VertexInputSemanticRow,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validGeometryId(row.geometryId);
  const current = state.semantics.get(row.geometryId);
  if (current !== undefined) {
    if (!sameGeometryBytes(current.recipe, row.recipe)) {
      throw new Error(`Vertex-input geometry ID ${row.geometryId} changed recipe bytes`);
    }
    return;
  }
  state.semantics.set(row.geometryId, {
    geometryId: row.geometryId,
    instanceKeys: new Set(),
    recipe: row.recipe,
  });
};

const createBuffer = (gl: WebGL2RenderingContext): WebGLBuffer => {
  const buffer = gl.createBuffer();
  if (buffer === null) throw new Error("WebGL vertex buffer creation failed");
  return buffer;
};

const createVertexArray = (gl: WebGL2RenderingContext): WebGLVertexArrayObject => {
  const vertexArray = gl.createVertexArray();
  if (vertexArray === null) throw new Error("WebGL vertex array creation failed");
  return vertexArray;
};

const unbindVertexInput = (gl: WebGL2RenderingContext): void => {
  gl.bindVertexArray(null);
  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
};

const uploadStaticGeometry = (
  gl: WebGL2RenderingContext,
  recipe: CpuGeometry,
  staticIdentityId: number,
): StaticGeometry => {
  const owned: WebGLBuffer[] = [];
  const upload = (target: number, value: ArrayBufferView): WebGLBuffer => {
    const buffer = createBuffer(gl);
    owned.push(buffer);
    gl.bindBuffer(target, buffer);
    gl.bufferData(target, value, gl.STATIC_DRAW);
    return buffer;
  };
  try {
    gl.bindVertexArray(null);
    const arrayBuffer = upload(gl.ARRAY_BUFFER, recipe.positions);
    const normalBuffer = recipe.normals === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.normals);
    const tangentBuffer = recipe.tangents === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.tangents);
    const colorBuffer = recipe.colors === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.colors);
    const texCoord0Buffer = recipe.texCoords0 === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.texCoords0);
    const texCoord1Buffer = recipe.texCoords1 === undefined ? undefined : upload(gl.ARRAY_BUFFER, recipe.texCoords1);
    const indexBuffer = recipe.indices === undefined
      ? undefined
      : upload(gl.ELEMENT_ARRAY_BUFFER, recipe.indices);
    const indexType = recipe.indices === undefined
      ? undefined
      : recipe.indices instanceof Uint32Array
        ? gl.UNSIGNED_INT
        : recipe.indices instanceof Uint8Array ? gl.UNSIGNED_BYTE : gl.UNSIGNED_SHORT;
    return {
      arrayBuffer,
      bucketKey: recipe.bucketKey,
      ...(colorBuffer === undefined ? {} : { colorBuffer }),
      compositeVertexArrays: new Map(),
      drawCount: recipe.indices?.length ?? recipe.positions.length / 3,
      geometryIds: new Set(),
      ...(indexBuffer === undefined ? {} : { indexBuffer }),
      ...(indexType === undefined ? {} : { indexType }),
      mode: recipe.mode,
      joinedIdentityBucket: false,
      ...(normalBuffer === undefined ? {} : { normalBuffer }),
      source: recipe,
      staticIdentityId,
      ...(tangentBuffer === undefined ? {} : { tangentBuffer }),
      ...(texCoord0Buffer === undefined ? {} : { texCoord0Buffer }),
      ...(texCoord1Buffer === undefined ? {} : { texCoord1Buffer }),
      vertexCount: recipe.positions.length / 3,
    };
  } catch (error) {
    for (const buffer of owned) gl.deleteBuffer(buffer);
    throw error;
  } finally {
    unbindVertexInput(gl);
  }
};

const forgetContextHandles = (state: VertexInputArenaState, dropped: boolean): void => {
  for (const semantic of state.semantics.values()) {
    semantic.instanceKeys.clear();
    delete semantic.staticGeometry;
  }
  state.geometryBuckets.clear();
  state.instanceBuffers.clear();
  state.instanceGeometryIds.clear();
  state.nextStaticIdentityId = 1;
  state.staticGeometries.clear();
  delete state.contextGeneration;
  state.contextDropped = dropped;
};

const requireContextGeneration = (state: VertexInputArenaState, contextGeneration: number): void => {
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) {
    if (state.contextDropped) {
      throw new Error("Vertex-input context was dropped; restore it explicitly before resolving GPU handles");
    }
    state.contextGeneration = contextGeneration;
    return;
  }
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
};

export const restoreVertexInputArenaContext = (
  arena: VertexInputArena,
  contextGeneration: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === contextGeneration) return;
  if (state.contextGeneration !== undefined) {
    throw new Error(
      `Cannot restore vertex-input generation ${contextGeneration} while generation ${state.contextGeneration} is active`,
    );
  }
  state.contextDropped = false;
  state.contextGeneration = contextGeneration;
};

const resolveStaticGeometry = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  semantic: SemanticGeometry,
): StaticGeometry => {
  requireContextGeneration(state, contextGeneration);
  if (semantic.staticGeometry !== undefined) return semantic.staticGeometry;
  const bucket = state.geometryBuckets.get(semantic.recipe.bucketKey);
  let resource = bucket === undefined
    ? undefined
    : findVerifiedGeometry(bucket, semantic.recipe, GEOMETRY_BUCKET_COMPARISON_LIMIT);
  if (resource === undefined) {
    const id = claimMonotonicId(
      state.nextStaticIdentityId,
      Number.MAX_SAFE_INTEGER,
      "Vertex-input static identity",
    );
    resource = uploadStaticGeometry(gl, semantic.recipe, id);
    state.nextStaticIdentityId = id + 1;
    state.staticGeometries.add(resource);
    if ((bucket?.length ?? 0) < GEOMETRY_BUCKET_COMPARISON_LIMIT) {
      resource.joinedIdentityBucket = true;
      if (bucket === undefined) state.geometryBuckets.set(semantic.recipe.bucketKey, [resource]);
      else bucket.push(resource);
    }
  }
  resource.geometryIds.add(semantic.geometryId);
  semantic.staticGeometry = resource;
  return resource;
};

export const vertexInputGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): VertexInputGeometry => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  return resolveStaticGeometry(state, gl, contextGeneration, semantic);
};

const configureStaticAttributes = (gl: WebGL2RenderingContext, geometry: StaticGeometry): void => {
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry.arrayBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.position);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.position, 3, gl.FLOAT, false, 0, 0);
  for (const [location, buffer, size] of [
    [VERTEX_ATTRIBUTE.normal, geometry.normalBuffer, 3],
    [VERTEX_ATTRIBUTE.tangent, geometry.tangentBuffer, 4],
    [VERTEX_ATTRIBUTE.color, geometry.colorBuffer, 4],
    [VERTEX_ATTRIBUTE.texCoord0, geometry.texCoord0Buffer, 2],
    [VERTEX_ATTRIBUTE.texCoord1, geometry.texCoord1Buffer, 2],
  ] as const) {
    if (buffer === undefined) {
      gl.disableVertexAttribArray(location);
    } else {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    }
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.indexBuffer ?? null);
};

export const vertexInputBaseVertexArray = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): WebGLVertexArrayObject => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(state, gl, contextGeneration, semantic);
  if (geometry.baseVertexArray !== undefined) return geometry.baseVertexArray;
  const vertexArray = createVertexArray(gl);
  try {
    gl.bindVertexArray(vertexArray);
    configureStaticAttributes(gl, geometry);
    geometry.baseVertexArray = vertexArray;
    return vertexArray;
  } catch (error) {
    gl.deleteVertexArray(vertexArray);
    throw error;
  } finally {
    unbindVertexInput(gl);
  }
};

const sameInstanceBuffers = (left: VertexInputInstanceBuffers, right: VertexInputInstanceBuffers): boolean =>
  left.localModelBuffer === right.localModelBuffer
  && left.rootPoseBuffer === right.rootPoseBuffer
  && left.rootScaleBuffer === right.rootScaleBuffer;

const configureInstanceAttributes = (gl: WebGL2RenderingContext, buffers: VertexInputInstanceBuffers): void => {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.localModelBuffer);
  for (let column = 0; column < 4; column += 1) {
    const location = VERTEX_ATTRIBUTE.instanceLocalModelFirstColumn + column;
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 4, gl.FLOAT, false, 64, column * 16);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.rootPoseBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instancePosition);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instancePosition, 3, gl.FLOAT, false, 24, 0);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instancePosition, 1);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instanceRotation);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instanceRotation, 3, gl.FLOAT, false, 24, 12);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instanceRotation, 1);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffers.rootScaleBuffer);
  gl.enableVertexAttribArray(VERTEX_ATTRIBUTE.instanceScale);
  gl.vertexAttribPointer(VERTEX_ATTRIBUTE.instanceScale, 3, gl.FLOAT, false, 12, 0);
  gl.vertexAttribDivisor(VERTEX_ATTRIBUTE.instanceScale, 1);
};

export const vertexInputCompositeVertexArray = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
  instanceKey: number,
  buffers: VertexInputInstanceBuffers,
): WebGLVertexArrayObject => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(instanceKey, "instance key");
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(state, gl, contextGeneration, semantic);
  const retainedBuffers = state.instanceBuffers.get(instanceKey);
  if (retainedBuffers !== undefined && !sameInstanceBuffers(retainedBuffers, buffers)) {
    throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
  }
  const cached = geometry.compositeVertexArrays.get(instanceKey);
  if (cached !== undefined) {
    if (!sameInstanceBuffers(cached.buffers, buffers)) {
      throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
    }
    let ids = state.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      state.instanceGeometryIds.set(instanceKey, ids);
    }
    if (!ids.has(geometryId)) {
      ids.add(geometryId);
      cached.geometryReferenceCount += 1;
    }
    semantic.instanceKeys.add(instanceKey);
    return cached.vertexArray;
  }
  const vertexArray = createVertexArray(gl);
  try {
    gl.bindVertexArray(vertexArray);
    configureStaticAttributes(gl, geometry);
    configureInstanceAttributes(gl, buffers);
    geometry.compositeVertexArrays.set(instanceKey, { buffers, geometryReferenceCount: 1, vertexArray });
    state.instanceBuffers.set(instanceKey, buffers);
    let ids = state.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      state.instanceGeometryIds.set(instanceKey, ids);
    }
    ids.add(geometryId);
    semantic.instanceKeys.add(instanceKey);
    return vertexArray;
  } catch (error) {
    gl.deleteVertexArray(vertexArray);
    throw error;
  } finally {
    unbindVertexInput(gl);
  }
};

const deleteStaticBuffers = (gl: WebGL2RenderingContext, geometry: StaticGeometry): void => {
  const buffers = new Set<WebGLBuffer>([
    geometry.arrayBuffer,
    ...(geometry.normalBuffer === undefined ? [] : [geometry.normalBuffer]),
    ...(geometry.tangentBuffer === undefined ? [] : [geometry.tangentBuffer]),
    ...(geometry.colorBuffer === undefined ? [] : [geometry.colorBuffer]),
    ...(geometry.texCoord0Buffer === undefined ? [] : [geometry.texCoord0Buffer]),
    ...(geometry.texCoord1Buffer === undefined ? [] : [geometry.texCoord1Buffer]),
    ...(geometry.indexBuffer === undefined ? [] : [geometry.indexBuffer]),
  ]);
  for (const buffer of buffers) gl.deleteBuffer(buffer);
};

const removeStaticGeometry = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  geometry: StaticGeometry,
): void => {
  for (const composite of geometry.compositeVertexArrays.values()) gl.deleteVertexArray(composite.vertexArray);
  geometry.compositeVertexArrays.clear();
  if (geometry.baseVertexArray !== undefined) {
    gl.deleteVertexArray(geometry.baseVertexArray);
    delete geometry.baseVertexArray;
  }
  deleteStaticBuffers(gl, geometry);
  const bucket = geometry.joinedIdentityBucket ? state.geometryBuckets.get(geometry.bucketKey) : undefined;
  if (bucket !== undefined) {
    const index = bucket.indexOf(geometry);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) state.geometryBuckets.delete(geometry.bucketKey);
  }
  state.staticGeometries.delete(geometry);
};

export const releaseVertexInputInstance = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  instanceKey: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) return;
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const ids = state.instanceGeometryIds.get(instanceKey);
  if (ids === undefined) return;
  const geometries = new Set<StaticGeometry>();
  for (const id of ids) {
    const semantic = state.semantics.get(id);
    semantic?.instanceKeys.delete(instanceKey);
    const geometry = semantic?.staticGeometry;
    if (geometry !== undefined) geometries.add(geometry);
  }
  for (const geometry of geometries) {
    const composite = geometry.compositeVertexArrays.get(instanceKey);
    if (composite !== undefined) gl.deleteVertexArray(composite.vertexArray);
    geometry.compositeVertexArrays.delete(instanceKey);
  }
  state.instanceGeometryIds.delete(instanceKey);
  state.instanceBuffers.delete(instanceKey);
  unbindVertexInput(gl);
};

export const releaseVertexInputGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  const semantic = state.semantics.get(geometryId);
  if (semantic === undefined) return;
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) {
    throw new Error("Lost-context geometry release must use releaseLostVertexInputGeometry");
  }
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const geometry = semantic.staticGeometry;
  if (geometry !== undefined) {
    geometry.geometryIds.delete(geometryId);
    for (const instanceKey of semantic.instanceKeys) {
      const ids = state.instanceGeometryIds.get(instanceKey);
      if (ids === undefined || !ids.delete(geometryId)) continue;
      if (ids.size === 0) {
        state.instanceGeometryIds.delete(instanceKey);
        state.instanceBuffers.delete(instanceKey);
      }
      const composite = geometry.compositeVertexArrays.get(instanceKey);
      if (composite !== undefined) {
        composite.geometryReferenceCount -= 1;
        if (composite.geometryReferenceCount < 0) {
          throw new Error(`Vertex-input composite ${instanceKey} has negative semantic references`);
        }
        if (composite.geometryReferenceCount === 0) {
          gl.deleteVertexArray(composite.vertexArray);
          geometry.compositeVertexArrays.delete(instanceKey);
        }
      }
    }
    if (geometry.geometryIds.size === 0) removeStaticGeometry(state, gl, geometry);
    unbindVertexInput(gl);
  }
  state.semantics.delete(geometryId);
};

export const releaseLostVertexInputGeometry = (
  arena: VertexInputArena,
  geometryId: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  validGeometryId(geometryId);
  if (state.contextGeneration !== undefined) {
    throw new Error("GL-free geometry release requires a dropped vertex-input context");
  }
  state.semantics.delete(geometryId);
};

const releaseContextHandles = (
  state: VertexInputArenaState,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  validSerial(contextGeneration, "context generation");
  if (state.contextGeneration === undefined) return;
  if (state.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${state.contextGeneration}, received ${contextGeneration}`,
    );
  }
  // Global ordering is deliberate: no static buffer is deleted while any VAO
  // owned by this arena can still retain it as ELEMENT_ARRAY_BUFFER state.
  for (const geometry of state.staticGeometries) {
    for (const composite of geometry.compositeVertexArrays.values()) gl.deleteVertexArray(composite.vertexArray);
    geometry.compositeVertexArrays.clear();
    if (geometry.baseVertexArray !== undefined) {
      gl.deleteVertexArray(geometry.baseVertexArray);
      delete geometry.baseVertexArray;
    }
  }
  for (const geometry of state.staticGeometries) deleteStaticBuffers(gl, geometry);
  unbindVertexInput(gl);
  forgetContextHandles(state, false);
};

export const releaseVertexInputContextHandles = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  releaseContextHandles(state, gl, contextGeneration);
};

export const dropVertexInputArenaContext = (arena: VertexInputArena): void => {
  const state = arena as unknown as VertexInputArenaState;
  forgetContextHandles(state, true);
};

export const disposeVertexInputArena = (
  arena: VertexInputArena,
  gl?: WebGL2RenderingContext,
  contextGeneration?: number,
): void => {
  const state = arena as unknown as VertexInputArenaState;
  if ((gl === undefined) !== (contextGeneration === undefined)) {
    throw new Error("Vertex-input disposal requires both gl and contextGeneration, or neither");
  }
  if (gl !== undefined && contextGeneration !== undefined) {
    releaseContextHandles(state, gl, contextGeneration);
  } else {
    if (state.contextGeneration !== undefined) {
      throw new Error("Active vertex-input disposal requires gl and contextGeneration");
    }
    forgetContextHandles(state, true);
  }
  state.semantics.clear();
};

export const vertexInputArenaSnapshot = (arena: VertexInputArena): VertexInputArenaSnapshot => {
  const state = arena as unknown as VertexInputArenaState;
  let bases = 0;
  let composites = 0;
  for (const geometry of state.staticGeometries) {
    if (geometry.baseVertexArray !== undefined) bases += 1;
    composites += geometry.compositeVertexArrays.size;
  }
  return {
    baseVertexArrayCount: bases,
    compositeVertexArrayCount: composites,
    ...(state.contextGeneration === undefined ? {} : { contextGeneration: state.contextGeneration }),
    identityBucketSizes: new Map(
      [...state.geometryBuckets].map(([key, geometries]) => [key, geometries.length]),
    ),
    instanceGeometryEdges: new Map(
      [...state.instanceGeometryIds].map(([key, ids]) => [key, new Set(ids)]),
    ),
    semanticGeometryCount: state.semantics.size,
    semanticGeometryIds: new Set(state.semantics.keys()),
    staticGeometryCount: state.staticGeometries.size,
  };
};

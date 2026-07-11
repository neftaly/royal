import type { CpuGeometry } from "./geometry-recipes";
import { MAX_RESOURCE_ID } from "./resource-id";
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

export interface VertexInputArena {
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
});

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
  validGeometryId(row.geometryId);
  const current = arena.semantics.get(row.geometryId);
  if (current !== undefined) {
    if (!sameGeometryBytes(current.recipe, row.recipe)) {
      throw new Error(`Vertex-input geometry ID ${row.geometryId} changed recipe bytes`);
    }
    return;
  }
  arena.semantics.set(row.geometryId, {
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

const forgetContextHandles = (arena: VertexInputArena, dropped: boolean): void => {
  for (const semantic of arena.semantics.values()) {
    semantic.instanceKeys.clear();
    delete semantic.staticGeometry;
  }
  arena.geometryBuckets.clear();
  arena.instanceBuffers.clear();
  arena.instanceGeometryIds.clear();
  arena.nextStaticIdentityId = 1;
  arena.staticGeometries.clear();
  delete arena.contextGeneration;
  arena.contextDropped = dropped;
};

const requireContextGeneration = (arena: VertexInputArena, contextGeneration: number): void => {
  validSerial(contextGeneration, "context generation");
  if (arena.contextGeneration === undefined) {
    if (arena.contextDropped) {
      throw new Error("Vertex-input context was dropped; restore it explicitly before resolving GPU handles");
    }
    arena.contextGeneration = contextGeneration;
    return;
  }
  if (arena.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${arena.contextGeneration}, received ${contextGeneration}`,
    );
  }
};

export const restoreVertexInputArenaContext = (
  arena: VertexInputArena,
  contextGeneration: number,
): void => {
  validSerial(contextGeneration, "context generation");
  if (arena.contextGeneration === contextGeneration) return;
  if (arena.contextGeneration !== undefined) {
    throw new Error(
      `Cannot restore vertex-input generation ${contextGeneration} while generation ${arena.contextGeneration} is active`,
    );
  }
  arena.contextDropped = false;
  arena.contextGeneration = contextGeneration;
};

const resolveStaticGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  semantic: SemanticGeometry,
): StaticGeometry => {
  requireContextGeneration(arena, contextGeneration);
  if (semantic.staticGeometry !== undefined) return semantic.staticGeometry;
  const bucket = arena.geometryBuckets.get(semantic.recipe.bucketKey);
  let resource = bucket === undefined
    ? undefined
    : findVerifiedGeometry(bucket, semantic.recipe, GEOMETRY_BUCKET_COMPARISON_LIMIT);
  if (resource === undefined) {
    if (arena.nextStaticIdentityId > Number.MAX_SAFE_INTEGER) {
      throw new Error("Vertex-input static identity ID space is exhausted");
    }
    resource = uploadStaticGeometry(gl, semantic.recipe, arena.nextStaticIdentityId);
    arena.nextStaticIdentityId += 1;
    arena.staticGeometries.add(resource);
    if ((bucket?.length ?? 0) < GEOMETRY_BUCKET_COMPARISON_LIMIT) {
      resource.joinedIdentityBucket = true;
      if (bucket === undefined) arena.geometryBuckets.set(semantic.recipe.bucketKey, [resource]);
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
  const semantic = arena.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  return resolveStaticGeometry(arena, gl, contextGeneration, semantic);
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
  const semantic = arena.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(arena, gl, contextGeneration, semantic);
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
  validSerial(instanceKey, "instance key");
  const semantic = arena.semantics.get(geometryId);
  if (semantic === undefined) throw new Error(`Vertex-input geometry ID ${geometryId} is not retained`);
  const geometry = resolveStaticGeometry(arena, gl, contextGeneration, semantic);
  const retainedBuffers = arena.instanceBuffers.get(instanceKey);
  if (retainedBuffers !== undefined && !sameInstanceBuffers(retainedBuffers, buffers)) {
    throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
  }
  const cached = geometry.compositeVertexArrays.get(instanceKey);
  if (cached !== undefined) {
    if (!sameInstanceBuffers(cached.buffers, buffers)) {
      throw new Error(`Vertex-input instance key ${instanceKey} changed fixed ABI buffers`);
    }
    let ids = arena.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      arena.instanceGeometryIds.set(instanceKey, ids);
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
    arena.instanceBuffers.set(instanceKey, buffers);
    let ids = arena.instanceGeometryIds.get(instanceKey);
    if (ids === undefined) {
      ids = new Set();
      arena.instanceGeometryIds.set(instanceKey, ids);
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
  arena: VertexInputArena,
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
  const bucket = geometry.joinedIdentityBucket ? arena.geometryBuckets.get(geometry.bucketKey) : undefined;
  if (bucket !== undefined) {
    const index = bucket.indexOf(geometry);
    if (index >= 0) bucket.splice(index, 1);
    if (bucket.length === 0) arena.geometryBuckets.delete(geometry.bucketKey);
  }
  arena.staticGeometries.delete(geometry);
};

export const releaseVertexInputInstance = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  instanceKey: number,
): void => {
  validSerial(contextGeneration, "context generation");
  if (arena.contextGeneration === undefined) return;
  if (arena.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${arena.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const ids = arena.instanceGeometryIds.get(instanceKey);
  if (ids === undefined) return;
  const geometries = new Set<StaticGeometry>();
  for (const id of ids) {
    const semantic = arena.semantics.get(id);
    semantic?.instanceKeys.delete(instanceKey);
    const geometry = semantic?.staticGeometry;
    if (geometry !== undefined) geometries.add(geometry);
  }
  for (const geometry of geometries) {
    const composite = geometry.compositeVertexArrays.get(instanceKey);
    if (composite !== undefined) gl.deleteVertexArray(composite.vertexArray);
    geometry.compositeVertexArrays.delete(instanceKey);
  }
  arena.instanceGeometryIds.delete(instanceKey);
  arena.instanceBuffers.delete(instanceKey);
  unbindVertexInput(gl);
};

export const releaseVertexInputGeometry = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
  geometryId: number,
): void => {
  const semantic = arena.semantics.get(geometryId);
  if (semantic === undefined) return;
  validSerial(contextGeneration, "context generation");
  if (arena.contextGeneration === undefined) {
    throw new Error("Lost-context geometry release must use releaseLostVertexInputGeometry");
  }
  if (arena.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${arena.contextGeneration}, received ${contextGeneration}`,
    );
  }
  const geometry = semantic.staticGeometry;
  if (geometry !== undefined) {
    geometry.geometryIds.delete(geometryId);
    for (const instanceKey of semantic.instanceKeys) {
      const ids = arena.instanceGeometryIds.get(instanceKey);
      if (ids === undefined || !ids.delete(geometryId)) continue;
      if (ids.size === 0) {
        arena.instanceGeometryIds.delete(instanceKey);
        arena.instanceBuffers.delete(instanceKey);
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
    if (geometry.geometryIds.size === 0) removeStaticGeometry(arena, gl, geometry);
    unbindVertexInput(gl);
  }
  arena.semantics.delete(geometryId);
};

export const releaseLostVertexInputGeometry = (
  arena: VertexInputArena,
  geometryId: number,
): void => {
  validGeometryId(geometryId);
  if (arena.contextGeneration !== undefined) {
    throw new Error("GL-free geometry release requires a dropped vertex-input context");
  }
  arena.semantics.delete(geometryId);
};

export const releaseVertexInputContextHandles = (
  arena: VertexInputArena,
  gl: WebGL2RenderingContext,
  contextGeneration: number,
): void => {
  validSerial(contextGeneration, "context generation");
  if (arena.contextGeneration === undefined) return;
  if (arena.contextGeneration !== contextGeneration) {
    throw new Error(
      `Vertex-input context generation mismatch: active ${arena.contextGeneration}, received ${contextGeneration}`,
    );
  }
  // Global ordering is deliberate: no static buffer is deleted while any VAO
  // owned by this arena can still retain it as ELEMENT_ARRAY_BUFFER state.
  for (const geometry of arena.staticGeometries) {
    for (const composite of geometry.compositeVertexArrays.values()) gl.deleteVertexArray(composite.vertexArray);
    geometry.compositeVertexArrays.clear();
    if (geometry.baseVertexArray !== undefined) {
      gl.deleteVertexArray(geometry.baseVertexArray);
      delete geometry.baseVertexArray;
    }
  }
  for (const geometry of arena.staticGeometries) deleteStaticBuffers(gl, geometry);
  unbindVertexInput(gl);
  forgetContextHandles(arena, false);
};

export const dropVertexInputArenaContext = (arena: VertexInputArena): void => {
  forgetContextHandles(arena, true);
};

export const disposeVertexInputArena = (
  arena: VertexInputArena,
  gl?: WebGL2RenderingContext,
  contextGeneration?: number,
): void => {
  if ((gl === undefined) !== (contextGeneration === undefined)) {
    throw new Error("Vertex-input disposal requires both gl and contextGeneration, or neither");
  }
  if (gl !== undefined && contextGeneration !== undefined) {
    releaseVertexInputContextHandles(arena, gl, contextGeneration);
  } else {
    if (arena.contextGeneration !== undefined) {
      throw new Error("Active vertex-input disposal requires gl and contextGeneration");
    }
    dropVertexInputArenaContext(arena);
  }
  arena.semantics.clear();
};

export const vertexInputArenaSnapshot = (arena: VertexInputArena): VertexInputArenaSnapshot => {
  let bases = 0;
  let composites = 0;
  for (const geometry of arena.staticGeometries) {
    if (geometry.baseVertexArray !== undefined) bases += 1;
    composites += geometry.compositeVertexArrays.size;
  }
  return {
    baseVertexArrayCount: bases,
    compositeVertexArrayCount: composites,
    ...(arena.contextGeneration === undefined ? {} : { contextGeneration: arena.contextGeneration }),
    instanceGeometryEdges: new Map(
      [...arena.instanceGeometryIds].map(([key, ids]) => [key, new Set(ids)]),
    ),
    semanticGeometryCount: arena.semantics.size,
    staticGeometryCount: arena.staticGeometries.size,
  };
};

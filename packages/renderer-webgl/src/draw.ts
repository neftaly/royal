import {
  type BoxGeometry,
  type DirectionalLightNode,
  type GltfNode,
  type Material,
  type MeshNode,
  type PlaneGeometry,
  type TextNode,
  type WireframeMaterial,
} from "@royal/renderer-core";
import type { GeometryCache } from "./geometry-cache";
import type { GltfAsset } from "./gltf-cache";
import { bindFloatAttribute, createIndexBuffer, type RendererWebGlContext } from "./gl";
import {
  bindMaterialBaseColor,
  lowerMaterialBaseColorBinding,
  type MaterialBaseColorBindOptions,
  type MaterialVirtualTextureRuntimeStats,
  type VirtualTextureDemand,
} from "./material-texture-binding";
import { composeTransform, multiply, type Mat4 } from "./matrix";
import type { GltfProgram, MeshProgram, TextProgram, WireframeProgram } from "./programs";
import {
  asMaterial,
} from "./render-graph";
import type { TextRenderAsset } from "./text-cache";
import { TextureCache } from "./texture-cache";
import { VirtualTextureCache } from "./virtual-texture-cache";

type MeshSurfaceMaterial = Exclude<Material, WireframeMaterial>;
type PlaneUvFootprint = {
  readonly uMax: number;
  readonly uMin: number;
  readonly vMax: number;
  readonly vMin: number;
};
type DrawVirtualTextureDemand = VirtualTextureDemand & {
  readonly uvFootprint?: PlaneUvFootprint | undefined;
};
type PlaneClipVertex = PlaneUvPoint & {
  readonly clipW: number;
  readonly clipX: number;
  readonly clipY: number;
};
type PlaneUvPoint = {
  readonly u: number;
  readonly v: number;
};

const boxWireframeEdgeIndices = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
  4, 5, 5, 6, 6, 7, 7, 4,
  0, 5, 1, 4, 2, 7, 3, 6,
]);
const planeWireframeEdgeIndices = new Uint16Array([
  0, 1, 1, 2, 2, 3, 3, 0,
]);
const boxWireframeEdgeIndexBuffers = new WeakMap<RendererWebGlContext, WebGLBuffer>();
const planeWireframeEdgeIndexBuffers = new WeakMap<RendererWebGlContext, WebGLBuffer>();

export interface MeshDrawContext {
  readonly directionalLight: DirectionalLightNode | undefined;
  readonly frame?: number;
  readonly geometryCache: GeometryCache;
  readonly onTextureSettled?: () => void;
  readonly onVirtualTextureRuntimeStats?: ((stats: MaterialVirtualTextureRuntimeStats) => void) | undefined;
  readonly textureCache?: TextureCache;
  readonly viewport?: { readonly height: number; readonly width: number };
  readonly virtualTextureCache?: VirtualTextureCache;
  readonly viewProjectionMatrix: Mat4;
}

export interface GltfDrawContext {
  readonly directionalLight: DirectionalLightNode | undefined;
  readonly viewProjectionMatrix: Mat4;
}

export interface TextDrawContext {
  readonly viewProjectionMatrix: Mat4;
}

export const drawMesh = (
  gl: RendererWebGlContext,
  programs: {
    readonly mesh: MeshProgram;
    readonly wireframe?: WireframeProgram;
  },
  mesh: MeshNode,
  context: MeshDrawContext,
): void => {
  if (mesh.geometry.kind === "box" || mesh.geometry.kind === "plane") {
    const material = asMaterial(mesh);
    if (material.kind === "wireframe") {
      if (programs.wireframe === undefined) {
        throw new Error("WebGL wireframe mesh drawing requires a wireframe program");
      }

      drawWireframeMesh(gl, programs.wireframe, mesh, material, context);
      return;
    }

    drawSurfaceMesh(gl, programs.mesh, mesh, material, context);
    return;
  }

  throw new Error(
    `Unsupported mesh geometry kind: ${String(mesh.geometry.kind)}`,
  );
};

const textureCaches = new WeakMap<RendererWebGlContext, TextureCache>();
const virtualTextureCaches = new WeakMap<RendererWebGlContext, VirtualTextureCache>();

const meshTextureCache = (gl: RendererWebGlContext): TextureCache => {
  const cached = textureCaches.get(gl);
  if (cached !== undefined) return cached;

  const cache = new TextureCache(gl);
  textureCaches.set(gl, cache);
  return cache;
};

const meshVirtualTextureCache = (gl: RendererWebGlContext): VirtualTextureCache => {
  const cached = virtualTextureCaches.get(gl);
  if (cached !== undefined) return cached;

  const cache = new VirtualTextureCache(gl);
  virtualTextureCaches.set(gl, cache);
  return cache;
};

const boxWireframeEdgeIndexBuffer = (gl: RendererWebGlContext): WebGLBuffer => {
  const cached = boxWireframeEdgeIndexBuffers.get(gl);
  if (cached !== undefined) return cached;

  const buffer = createIndexBuffer(gl, boxWireframeEdgeIndices);
  boxWireframeEdgeIndexBuffers.set(gl, buffer);
  return buffer;
};

const planeWireframeEdgeIndexBuffer = (gl: RendererWebGlContext): WebGLBuffer => {
  const cached = planeWireframeEdgeIndexBuffers.get(gl);
  if (cached !== undefined) return cached;

  const buffer = createIndexBuffer(gl, planeWireframeEdgeIndices);
  planeWireframeEdgeIndexBuffers.set(gl, buffer);
  return buffer;
};

const solidWireframeColor = (
  material: WireframeMaterial,
): readonly [number, number, number, number] => {
  if (material.baseColor.kind !== "solid") {
    throw new Error("WebGL wireframe material requires a solid baseColor");
  }

  return material.baseColor.color;
};

export const drawGltf = (
  gl: RendererWebGlContext,
  programs: {
    readonly gltf: GltfProgram;
  },
  node: GltfNode,
  asset: GltfAsset,
  context: GltfDrawContext,
): void => {
  const light = context.directionalLight;
  if (light === undefined)
    throw new Error("glTF mesh requires a directionalLight");

  gl.useProgram(programs.gltf.program);
  gl.uniform4fv(programs.gltf.uniforms.lightColor, light.color);
  gl.uniform3fv(programs.gltf.uniforms.lightDirection, light.direction);
  gl.uniformMatrix4fv(
    programs.gltf.uniforms.viewProjection,
    false,
    context.viewProjectionMatrix,
  );
  gl.uniform1i(programs.gltf.uniforms.baseColor, 0);

  const rootModel = composeTransform(node.transform);

  for (const primitive of asset.primitives) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, primitive.texture);
    gl.uniformMatrix4fv(
      programs.gltf.uniforms.model,
      false,
      multiply(rootModel, primitive.model),
    );
    bindFloatAttribute(
      gl,
      programs.gltf.attributes.position,
      primitive.position,
      3,
    );
    bindFloatAttribute(
      gl,
      programs.gltf.attributes.normal,
      primitive.normal,
      3,
    );
    bindFloatAttribute(
      gl,
      programs.gltf.attributes.texCoord,
      primitive.texCoord,
      2,
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, primitive.index);
    gl.drawElements(gl.TRIANGLES, primitive.indexCount, gl.UNSIGNED_SHORT, 0);
  }
};

export const drawVectorText = (
  gl: RendererWebGlContext,
  programs: {
    readonly text: TextProgram;
  },
  node: TextNode,
  asset: TextRenderAsset,
  context: TextDrawContext,
): void => {
  gl.useProgram(programs.text.program);
  gl.uniformMatrix4fv(
    programs.text.uniforms.viewProjection,
    false,
    context.viewProjectionMatrix,
  );
  gl.uniform4fv(programs.text.uniforms.color, node.color);

  bindFloatAttribute(gl, programs.text.attributes.position, asset.position, 3);
  bindFloatAttribute(gl, programs.text.attributes.glyphCoord, asset.glyphCoord, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, asset.index);
  gl.drawElements(gl.TRIANGLES, asset.indexCount, gl.UNSIGNED_SHORT, 0);
};

const drawSurfaceMesh = (
  gl: RendererWebGlContext,
  program: MeshProgram,
  mesh: MeshNode,
  material: MeshSurfaceMaterial,
  context: MeshDrawContext,
): void => {
  const light = context.directionalLight;
  const unlit = material.kind === "unlit";
  if (!unlit && light === undefined)
    throw new Error("StandardMaterial mesh requires a directionalLight");
  const geometry = indexedGeometryBuffers(mesh.geometry, context.geometryCache);
  const modelMatrix = composeTransform(mesh.transform);
  const size = surfaceSize(mesh.geometry);
  const baseColor = lowerMaterialBaseColorBinding(material.baseColor, {
    onTextureSettled: context.onTextureSettled,
    textureCache: context.textureCache ?? meshTextureCache(gl),
    virtualTextureCache: context.virtualTextureCache ?? meshVirtualTextureCache(gl),
  });
  const virtualTextureDemand = material.baseColor.kind === "virtual-asset"
    ? virtualTextureDemandForSurface(
      mesh.geometry,
      modelMatrix,
      context.viewProjectionMatrix,
      context.viewport,
      size,
    )
    : undefined;

  gl.useProgram(program.program);
  gl.uniformMatrix4fv(
    program.uniforms.model,
    false,
    modelMatrix,
  );
  gl.uniformMatrix4fv(
    program.uniforms.viewProjection,
    false,
    context.viewProjectionMatrix,
  );
  gl.uniform3fv(program.uniforms.boxSize, size);
  const baseColorOptions: MaterialBaseColorBindOptions = {
    ...(context.frame === undefined ? {} : { frame: context.frame }),
    ...(context.onVirtualTextureRuntimeStats === undefined
      ? {}
      : { onVirtualTextureRuntimeStats: context.onVirtualTextureRuntimeStats }),
    ...(context.onTextureSettled === undefined
      ? {}
      : { onVirtualTextureSettled: context.onTextureSettled }),
    ...(virtualTextureDemand === undefined ? {} : { virtualTextureDemand }),
  };
  bindMaterialBaseColor(gl, program.uniforms, baseColor, 0, baseColorOptions);
  gl.uniform1i(program.uniforms.unlit, unlit ? 1 : 0);
  gl.uniform4fv(program.uniforms.lightColor, light?.color ?? [0, 0, 0, 0]);
  gl.uniform3fv(program.uniforms.lightDirection, light?.direction ?? [0, 0, -1]);

  bindFloatAttribute(
    gl,
    program.attributes.position,
    geometry.position,
    3,
  );
  bindFloatAttribute(
    gl,
    program.attributes.normal,
    geometry.normal,
    3,
  );
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geometry.index);
  gl.drawElements(gl.TRIANGLES, geometry.indexCount, gl.UNSIGNED_SHORT, 0);
};

const drawWireframeMesh = (
  gl: RendererWebGlContext,
  program: WireframeProgram,
  mesh: MeshNode,
  material: WireframeMaterial,
  context: MeshDrawContext,
): void => {
  const geometry = indexedGeometryBuffers(mesh.geometry, context.geometryCache);
  const wireframeIndices = mesh.geometry.kind === "box"
    ? {
      buffer: boxWireframeEdgeIndexBuffer(gl),
      count: boxWireframeEdgeIndices.length,
    }
    : {
      buffer: planeWireframeEdgeIndexBuffer(gl),
      count: planeWireframeEdgeIndices.length,
    };

  gl.useProgram(program.program);
  gl.uniformMatrix4fv(
    program.uniforms.model,
    false,
    composeTransform(mesh.transform),
  );
  gl.uniformMatrix4fv(
    program.uniforms.viewProjection,
    false,
    context.viewProjectionMatrix,
  );
  gl.uniform4fv(program.uniforms.color, solidWireframeColor(material));
  gl.uniform1f(program.uniforms.width, material.width);

  bindFloatAttribute(
    gl,
    program.attributes.position,
    geometry.position,
    3,
  );
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wireframeIndices.buffer);
  gl.lineWidth(material.width);
  gl.drawElements(gl.LINES, wireframeIndices.count, gl.UNSIGNED_SHORT, 0);
};

const indexedGeometryBuffers = (
  geometry: MeshNode["geometry"],
  cache: GeometryCache,
) => {
  if (geometry.kind === "box") return cache.box(geometry as BoxGeometry);
  if (geometry.kind === "plane") return cache.plane(geometry as PlaneGeometry);
  throw new Error(`Unsupported mesh geometry kind: ${String(geometry.kind)}`);
};

const surfaceSize = (geometry: MeshNode["geometry"]): readonly [number, number, number] => {
  if (geometry.kind === "box") return (geometry as BoxGeometry).size;
  if (geometry.kind === "plane") {
    const [width, height] = (geometry as PlaneGeometry).size;
    return [width, height, 1];
  }
  throw new Error(`Unsupported mesh geometry kind: ${String(geometry.kind)}`);
};

const virtualTextureDemandForSurface = (
  geometry: MeshNode["geometry"],
  modelMatrix: Mat4,
  viewProjectionMatrix: Mat4,
  viewport: MeshDrawContext["viewport"],
  size: readonly [number, number, number],
): DrawVirtualTextureDemand | undefined => {
  if (viewport === undefined) return undefined;

  const footprint = projectedSurfaceFootprintPx(
    geometry.kind === "plane" ? [size[0], size[1], 0] : size,
    modelMatrix,
    viewProjectionMatrix,
    viewport,
  );
  if (footprint === undefined) return undefined;

  const uvFootprint = geometry.kind === "plane"
    ? projectedPlaneUvFootprint(size, modelMatrix, viewProjectionMatrix)
    : undefined;
  return uvFootprint === undefined
    ? { screenFootprintPx: footprint }
    : { screenFootprintPx: footprint, uvFootprint };
};

const projectedSurfaceFootprintPx = (
  size: readonly [number, number, number],
  modelMatrix: Mat4,
  viewProjectionMatrix: Mat4,
  viewport: { readonly height: number; readonly width: number },
): readonly [number, number] | undefined => {
  if (
    !Number.isFinite(viewport.width) ||
    !Number.isFinite(viewport.height) ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    size.some((value) => !Number.isFinite(value) || value < 0)
  ) {
    return undefined;
  }

  const modelViewProjection = multiply(viewProjectionMatrix, modelMatrix);
  const halfX = size[0] / 2;
  const halfY = size[1] / 2;
  const halfZ = size[2] / 2;
  const zValues = size[2] === 0 ? [0] : [-halfZ, halfZ];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const x of [-halfX, halfX]) {
    for (const y of [-halfY, halfY]) {
      for (const z of zValues) {
        const projected = projectSurfaceCorner(modelViewProjection, x, y, z);
        if (projected === undefined) return undefined;
        minX = Math.min(minX, projected.x);
        maxX = Math.max(maxX, projected.x);
        minY = Math.min(minY, projected.y);
        maxY = Math.max(maxY, projected.y);
      }
    }
  }

  const width = (clampNdc(maxX) - clampNdc(minX)) * viewport.width * 0.5;
  const height = (clampNdc(maxY) - clampNdc(minY)) * viewport.height * 0.5;
  return Number.isFinite(width) && Number.isFinite(height) && width >= 0 && height >= 0
    ? [width, height]
    : undefined;
};

const clampNdc = (value: number): number =>
  Math.min(1, Math.max(-1, value));

const projectSurfaceCorner = (
  matrix: Mat4,
  x: number,
  y: number,
  z: number,
): { readonly x: number; readonly y: number } | undefined => {
  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
  if (!Number.isFinite(clipX) || !Number.isFinite(clipY) || !Number.isFinite(clipW) || clipW <= 0) {
    return undefined;
  }

  const xNdc = clipX / clipW;
  const yNdc = clipY / clipW;
  return Number.isFinite(xNdc) && Number.isFinite(yNdc)
    ? { x: xNdc, y: yNdc }
    : undefined;
};

const projectedPlaneUvFootprint = (
  size: readonly [number, number, number],
  modelMatrix: Mat4,
  viewProjectionMatrix: Mat4,
): PlaneUvFootprint | undefined => {
  const [width, height] = size;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return undefined;
  }

  const modelViewProjection = multiply(viewProjectionMatrix, modelMatrix);
  const halfX = width / 2;
  const halfY = height / 2;
  const corners = [
    planeClipVertex(modelViewProjection, -halfX, -halfY, { u: 0, v: 0 }),
    planeClipVertex(modelViewProjection, halfX, -halfY, { u: 1, v: 0 }),
    planeClipVertex(modelViewProjection, halfX, halfY, { u: 1, v: 1 }),
    planeClipVertex(modelViewProjection, -halfX, halfY, { u: 0, v: 1 }),
  ];
  const polygon: PlaneClipVertex[] = [];
  for (const corner of corners) {
    if (corner === undefined) return undefined;
    polygon.push(corner);
  }

  for (const distance of planeViewportClipDistances) {
    const clipped = clipPlanePolygon(polygon, distance);
    if (clipped === undefined || clipped.length === 0) return undefined;
    polygon.splice(0, polygon.length, ...clipped);
  }

  let uMin = Number.POSITIVE_INFINITY;
  let uMax = Number.NEGATIVE_INFINITY;
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const vertex of polygon) {
    uMin = Math.min(uMin, vertex.u);
    uMax = Math.max(uMax, vertex.u);
    vMin = Math.min(vMin, vertex.v);
    vMax = Math.max(vMax, vertex.v);
  }

  if (
    !Number.isFinite(uMin) ||
    !Number.isFinite(uMax) ||
    !Number.isFinite(vMin) ||
    !Number.isFinite(vMax) ||
    uMin > uMax ||
    vMin > vMax
  ) {
    return undefined;
  }

  const padding = 1e-6;
  return {
    uMax: clamp01(uMax + padding),
    uMin: clamp01(uMin - padding),
    vMax: clamp01(vMax + padding),
    vMin: clamp01(vMin - padding),
  };
};

const planeViewportClipDistances = [
  (vertex: PlaneClipVertex): number => vertex.clipX + vertex.clipW,
  (vertex: PlaneClipVertex): number => vertex.clipW - vertex.clipX,
  (vertex: PlaneClipVertex): number => vertex.clipY + vertex.clipW,
  (vertex: PlaneClipVertex): number => vertex.clipW - vertex.clipY,
] as const;

const planeClipVertex = (
  matrix: Mat4,
  x: number,
  y: number,
  uv: PlaneUvPoint,
): PlaneClipVertex | undefined => {
  const clipX = matrix[0] * x + matrix[4] * y + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[15];
  if (
    !Number.isFinite(clipX) ||
    !Number.isFinite(clipY) ||
    !Number.isFinite(clipW) ||
    clipW <= 0
  ) {
    return undefined;
  }

  return { clipW, clipX, clipY, ...uv };
};

const clipPlanePolygon = (
  polygon: readonly PlaneClipVertex[],
  distance: (vertex: PlaneClipVertex) => number,
): PlaneClipVertex[] | undefined => {
  const clipped: PlaneClipVertex[] = [];
  let previous = polygon.at(-1);
  if (previous === undefined) return clipped;
  let previousDistance = distance(previous);
  if (!Number.isFinite(previousDistance)) return undefined;

  for (const current of polygon) {
    const currentDistance = distance(current);
    if (!Number.isFinite(currentDistance)) return undefined;
    const previousInside = previousDistance >= 0;
    const currentInside = currentDistance >= 0;

    if (previousInside !== currentInside) {
      const intersection = interpolatePlaneClipVertex(
        previous,
        current,
        previousDistance,
        currentDistance,
      );
      if (intersection === undefined) return undefined;
      clipped.push(intersection);
    }
    if (currentInside) clipped.push(current);

    previous = current;
    previousDistance = currentDistance;
  }

  return clipped;
};

const interpolatePlaneClipVertex = (
  from: PlaneClipVertex,
  to: PlaneClipVertex,
  fromDistance: number,
  toDistance: number,
): PlaneClipVertex | undefined => {
  const denominator = fromDistance - toDistance;
  if (!Number.isFinite(denominator) || denominator === 0) return undefined;
  const t = fromDistance / denominator;
  if (!Number.isFinite(t) || t < 0 || t > 1) return undefined;

  return {
    clipW: lerp(from.clipW, to.clipW, t),
    clipX: lerp(from.clipX, to.clipX, t),
    clipY: lerp(from.clipY, to.clipY, t),
    u: lerp(from.u, to.u, t),
    v: lerp(from.v, to.v, t),
  };
};

const lerp = (from: number, to: number, t: number): number =>
  from + (to - from) * t;

const clamp01 = (value: number): number =>
  Math.min(1, Math.max(0, value));

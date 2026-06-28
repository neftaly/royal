import {
  type DirectionalLightNode,
  type GltfNode,
  type MeshNode,
  type TextNode,
  type TextureRef,
} from "@royal/renderer-core";
import type { GeometryCache } from "./geometry-cache";
import type { GltfAsset } from "./gltf-cache";
import { bindFloatAttribute } from "./gl";
import { composeTransform, multiply, type Mat4 } from "./matrix";
import type { GltfProgram, MeshProgram, TextProgram } from "./programs";
import {
  asBoxGeometry,
  asMaterial,
} from "./render-graph";
import type { TextRenderAsset } from "./text-cache";
import { TextureCache } from "./texture-cache";

export interface MeshDrawContext {
  readonly directionalLight: DirectionalLightNode | undefined;
  readonly geometryCache: GeometryCache;
  readonly onTextureSettled?: () => void;
  readonly textureCache?: TextureCache;
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
  gl: WebGLRenderingContext,
  programs: {
    readonly mesh: MeshProgram;
  },
  mesh: MeshNode,
  context: MeshDrawContext,
): void => {
  if (mesh.geometry.kind === "box") {
    drawBoxMesh(gl, programs.mesh, mesh, context);
    return;
  }

  throw new Error(
    `Unsupported mesh geometry kind: ${String(mesh.geometry.kind)}`,
  );
};

type MeshBaseColor =
  | {
    readonly color: readonly [number, number, number, number];
    readonly kind: "solid";
  }
  | {
    readonly color: readonly [number, number, number, number];
    readonly kind: "texture-fallback";
    readonly reason: "error" | "loading";
  }
  | {
    readonly kind: "texture";
    readonly texture: WebGLTexture;
  };

const defaultAssetFallback = [1, 1, 1, 1] as const;
const textureCaches = new WeakMap<WebGLRenderingContext, TextureCache>();

const meshTextureCache = (gl: WebGLRenderingContext): TextureCache => {
  const cached = textureCaches.get(gl);
  if (cached !== undefined) return cached;

  const cache = new TextureCache(gl);
  textureCaches.set(gl, cache);
  return cache;
};

const fallbackBaseColor = (baseColor: TextureRef): readonly [number, number, number, number] =>
  baseColor.kind === "asset" && baseColor.fallback !== undefined
    ? baseColor.fallback.color
    : defaultAssetFallback;

const meshBaseColor = (
  gl: WebGLRenderingContext,
  baseColor: TextureRef,
  context: MeshDrawContext,
): MeshBaseColor => {
  if (baseColor.kind === "solid") return { kind: "solid", color: baseColor.color };

  const cache = context.textureCache ?? meshTextureCache(gl);
  const texture = cache.loadTextureAssetBaseColor(baseColor, context.onTextureSettled);
  if (texture.kind === "ready") return { kind: "texture", texture: texture.texture };
  return {
    kind: "texture-fallback",
    color: fallbackBaseColor(baseColor),
    reason: texture.kind,
  };
};

export const drawGltf = (
  gl: WebGLRenderingContext,
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
  gl: WebGLRenderingContext,
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

const drawBoxMesh = (
  gl: WebGLRenderingContext,
  program: MeshProgram,
  mesh: MeshNode,
  context: MeshDrawContext,
): void => {
  const light = context.directionalLight;
  const material = asMaterial(mesh);
  const unlit = material.kind === "unlit";
  if (!unlit && light === undefined)
    throw new Error("StandardMaterial box mesh requires a directionalLight");
  const box = asBoxGeometry(mesh);
  const geometry = context.geometryCache.box(box);
  const baseColor = meshBaseColor(gl, material.baseColor, context);

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
  gl.uniform3fv(program.uniforms.boxSize, box.size);
  if (baseColor.kind === "texture") {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, baseColor.texture);
    gl.uniform1i(program.uniforms.baseColor, 0);
    gl.uniform1i(program.uniforms.useBaseColorTexture, 1);
  } else {
    gl.uniform4fv(program.uniforms.color, baseColor.color);
    gl.uniform1i(program.uniforms.useBaseColorTexture, 0);
  }
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

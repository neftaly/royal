import gltfFragmentSource from "./shaders/gltf.frag";
import gltfVertexSource from "./shaders/gltf.vert";
import meshFragmentSource from "./shaders/mesh.frag";
import meshVertexSource from "./shaders/mesh.vert";
import textFragmentSource from "./shaders/text.frag";
import textVertexSource from "./shaders/text.vert";
import wireframeFragmentSource from "./shaders/wireframe.frag";
import wireframeVertexSource from "./shaders/wireframe.vert";
import { attributeLocation, createProgram, uniformLocation, type RendererWebGlContext } from "./gl";

export interface MeshProgram {
  readonly attributes: {
    readonly normal: number;
    readonly position: number;
  };
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly baseColor: WebGLUniformLocation;
    readonly boxSize: WebGLUniformLocation;
    readonly color: WebGLUniformLocation;
    readonly lightColor: WebGLUniformLocation;
    readonly lightDirection: WebGLUniformLocation;
    readonly model: WebGLUniformLocation;
    readonly unlit: WebGLUniformLocation;
    readonly useVirtualTexture: WebGLUniformLocation;
    readonly useBaseColorTexture: WebGLUniformLocation;
    readonly viewProjection: WebGLUniformLocation;
    readonly virtualAtlas: WebGLUniformLocation;
    readonly virtualBorderTexels: WebGLUniformLocation;
    readonly virtualMip: WebGLUniformLocation;
    readonly virtualPaddedPageSize: WebGLUniformLocation;
    readonly virtualPageSize: WebGLUniformLocation;
    readonly virtualPageTable: WebGLUniformLocation;
    readonly virtualPageTableSize: WebGLUniformLocation;
    readonly virtualPhysicalAtlasSize: WebGLUniformLocation;
  };
}

export interface GltfProgram {
  readonly attributes: {
    readonly normal: number;
    readonly position: number;
    readonly texCoord: number;
  };
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly baseColor: WebGLUniformLocation;
    readonly lightColor: WebGLUniformLocation;
    readonly lightDirection: WebGLUniformLocation;
    readonly model: WebGLUniformLocation;
    readonly viewProjection: WebGLUniformLocation;
  };
}

export interface TextProgram {
  readonly attributes: {
    readonly glyphCoord: number;
    readonly position: number;
  };
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly color: WebGLUniformLocation;
    readonly viewProjection: WebGLUniformLocation;
  };
}

export interface WireframeProgram {
  readonly attributes: {
    readonly position: number;
  };
  readonly program: WebGLProgram;
  readonly uniforms: {
    readonly color: WebGLUniformLocation;
    readonly model: WebGLUniformLocation;
    readonly viewProjection: WebGLUniformLocation;
    readonly width: WebGLUniformLocation;
  };
}

export const createMeshProgram = (gl: RendererWebGlContext): MeshProgram => {
  const program = createProgram(gl, meshVertexSource, meshFragmentSource);

  return {
    program,
    attributes: {
      normal: attributeLocation(gl, program, "a_normal"),
      position: attributeLocation(gl, program, "a_position"),
    },
    uniforms: {
      baseColor: uniformLocation(gl, program, "u_baseColor"),
      boxSize: uniformLocation(gl, program, "u_boxSize"),
      color: uniformLocation(gl, program, "u_color"),
      lightColor: uniformLocation(gl, program, "u_lightColor"),
      lightDirection: uniformLocation(gl, program, "u_lightDirection"),
      model: uniformLocation(gl, program, "u_model"),
      unlit: uniformLocation(gl, program, "u_unlit"),
      useVirtualTexture: uniformLocation(gl, program, "u_useVirtualTexture"),
      useBaseColorTexture: uniformLocation(gl, program, "u_useBaseColorTexture"),
      viewProjection: uniformLocation(gl, program, "u_viewProjection"),
      virtualAtlas: uniformLocation(gl, program, "u_virtualAtlas"),
      virtualBorderTexels: uniformLocation(gl, program, "u_virtualBorderTexels"),
      virtualMip: uniformLocation(gl, program, "u_virtualMip"),
      virtualPaddedPageSize: uniformLocation(gl, program, "u_virtualPaddedPageSize"),
      virtualPageSize: uniformLocation(gl, program, "u_virtualPageSize"),
      virtualPageTable: uniformLocation(gl, program, "u_virtualPageTable"),
      virtualPageTableSize: uniformLocation(gl, program, "u_virtualPageTableSize"),
      virtualPhysicalAtlasSize: uniformLocation(gl, program, "u_virtualPhysicalAtlasSize"),
    },
  };
};

export const createGltfProgram = (gl: RendererWebGlContext): GltfProgram => {
  const program = createProgram(gl, gltfVertexSource, gltfFragmentSource);

  return {
    program,
    attributes: {
      normal: attributeLocation(gl, program, "a_normal"),
      position: attributeLocation(gl, program, "a_position"),
      texCoord: attributeLocation(gl, program, "a_texCoord"),
    },
    uniforms: {
      baseColor: uniformLocation(gl, program, "u_baseColor"),
      lightColor: uniformLocation(gl, program, "u_lightColor"),
      lightDirection: uniformLocation(gl, program, "u_lightDirection"),
      model: uniformLocation(gl, program, "u_model"),
      viewProjection: uniformLocation(gl, program, "u_viewProjection"),
    },
  };
};

export const createTextProgram = (gl: RendererWebGlContext): TextProgram => {
  const program = createProgram(gl, textVertexSource, textFragmentSource);

  return {
    program,
    attributes: {
      glyphCoord: attributeLocation(gl, program, "a_glyphCoord"),
      position: attributeLocation(gl, program, "a_position"),
    },
    uniforms: {
      color: uniformLocation(gl, program, "u_color"),
      viewProjection: uniformLocation(gl, program, "u_viewProjection"),
    },
  };
};

export const createWireframeProgram = (gl: RendererWebGlContext): WireframeProgram => {
  const program = createProgram(gl, wireframeVertexSource, wireframeFragmentSource);

  return {
    program,
    attributes: {
      position: attributeLocation(gl, program, "a_position"),
    },
    uniforms: {
      color: uniformLocation(gl, program, "u_color"),
      model: uniformLocation(gl, program, "u_model"),
      viewProjection: uniformLocation(gl, program, "u_viewProjection"),
      width: uniformLocation(gl, program, "u_width"),
    },
  };
};

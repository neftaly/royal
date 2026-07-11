import type { Vec3 } from "@royal/renderer-core";
import { dotVec3 } from "../math/mat4";
import { prepareTextureUpload } from "./imperative-state";

export type StudioEnvironmentSpecularResource = {
  readonly key: string;
  readonly mipCount: number;
  readonly texture: WebGLTexture;
};

export const STUDIO_ENVIRONMENT_IRRADIANCE: readonly Vec3[] = [
  [0.78, 0.78, 0.82],
  [0.05, 0.06, 0.08],
  [0.34, 0.35, 0.38],
  [-0.08, -0.08, -0.07],
  [0.02, 0.02, 0.02],
  [0.05, 0.05, 0.06],
  [-0.18, -0.17, -0.16],
  [-0.03, -0.03, -0.02],
  [0.04, 0.04, 0.04],
];

export const STUDIO_ENVIRONMENT_SPECULAR_KEY = "environment:studio:specular";

const STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES = [32, 16, 8, 4, 2, 1] as const;

const normalizedStudioDirection = (x: number, y: number, z: number): Vec3 => {
  const inverseLength = 1 / Math.hypot(x, y, z);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
};

const STUDIO_KEY_DIRECTION = normalizedStudioDirection(-0.34, 0.62, 0.71);
const STUDIO_STRIP_DIRECTION = normalizedStudioDirection(0.76, 0.18, 0.62);

const studioEnvironmentFaceDirection = (
  faceIndex: number,
  x: number,
  y: number,
  size: number,
): Vec3 => {
  const u = 2 * ((x + 0.5) / size) - 1;
  const v = 2 * ((y + 0.5) / size) - 1;

  switch (faceIndex) {
    case 0:
      return normalizedStudioDirection(1, -v, -u);
    case 1:
      return normalizedStudioDirection(-1, -v, u);
    case 2:
      return normalizedStudioDirection(u, 1, v);
    case 3:
      return normalizedStudioDirection(u, -1, -v);
    case 4:
      return normalizedStudioDirection(u, -v, 1);
    default:
      return normalizedStudioDirection(-u, -v, -1);
  }
};

const studioEnvironmentRadiance = (direction: Vec3, mipIndex: number): Vec3 => {
  const roughness = mipIndex / Math.max(STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES.length - 1, 1);
  const sky = Math.min(Math.max(direction[1] * 0.5 + 0.5, 0), 1);
  const base: Vec3 = [
    0.16 + sky * 0.18,
    0.18 + sky * 0.20,
    0.21 + sky * 0.24,
  ];
  const key = Math.pow(Math.max(0, dotVec3(direction, STUDIO_KEY_DIRECTION)), 42);
  const strip = Math.pow(Math.max(0, dotVec3(direction, STUDIO_STRIP_DIRECTION)), 30);
  const ceiling = Math.pow(Math.max(0, direction[1]), 6);
  const raw: Vec3 = [
    base[0] + key * 1.95 + strip * 0.62 + ceiling * 0.22,
    base[1] + key * 1.84 + strip * 0.68 + ceiling * 0.24,
    base[2] + key * 1.58 + strip * 0.78 + ceiling * 0.28,
  ];
  const roughAverage: Vec3 = [0.36, 0.39, 0.44];
  const roughMix = roughness * 0.82;

  return [
    raw[0] * (1 - roughMix) + roughAverage[0] * roughMix,
    raw[1] * (1 - roughMix) + roughAverage[1] * roughMix,
    raw[2] * (1 - roughMix) + roughAverage[2] * roughMix,
  ];
};

const studioEnvironmentSpecularMipData = (mipIndex: number, faceIndex: number): Float32Array => {
  const size = STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES[mipIndex] ?? 1;
  const data = new Float32Array(size * size * 3);
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const radiance = studioEnvironmentRadiance(
        studioEnvironmentFaceDirection(faceIndex, x, y, size),
        mipIndex,
      );
      data[offset] = Math.max(radiance[0], 0);
      data[offset + 1] = Math.max(radiance[1], 0);
      data[offset + 2] = Math.max(radiance[2], 0);
      offset += 3;
    }
  }

  return data;
};

export const createStudioEnvironmentSpecularTexture = (
  context: {
    readonly createTexture: () => WebGLTexture;
    readonly gl: WebGL2RenderingContext;
  },
): StudioEnvironmentSpecularResource => {
  const gl = context.gl;
  const texture = context.createTexture();
  prepareTextureUpload(gl, false);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);

  for (const [mipIndex, mipSize] of STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES.entries()) {
    for (let faceIndex = 0; faceIndex < 6; faceIndex += 1) {
      const data = studioEnvironmentSpecularMipData(mipIndex, faceIndex);
      gl.texImage2D(
        gl.TEXTURE_CUBE_MAP_POSITIVE_X + faceIndex,
        mipIndex,
        gl.RGB9_E5,
        mipSize,
        mipSize,
        0,
        gl.RGB,
        gl.FLOAT,
        data,
      );
    }
  }

  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAX_LEVEL, STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES.length - 1);

  return {
    key: STUDIO_ENVIRONMENT_SPECULAR_KEY,
    mipCount: STUDIO_ENVIRONMENT_SPECULAR_MIP_SIZES.length,
    texture,
  };
};

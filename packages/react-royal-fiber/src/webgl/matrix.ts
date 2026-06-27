import { mat4 } from "gl-matrix";
import type { EulerRads, Transform, Vec3 } from "@royal/renderer-core";
import type { mat4 as GlMat4 } from "gl-matrix";

export type Mat4 = GlMat4;

export const identity = (): Mat4 => mat4.create();

export const multiply = (left: Mat4, right: Mat4): Mat4 =>
  mat4.multiply(mat4.create(), left, right);

export const perspective = (
  fovY: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 => mat4.perspectiveNO(mat4.create(), fovY, aspect, near, far);

export const orthographic = (
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 => mat4.orthoNO(mat4.create(), left, right, bottom, top, near, far);

export const translation = (position: Vec3): Mat4 =>
  mat4.fromTranslation(mat4.create(), position);

export const rotation = ([x, y, z]: EulerRads): Mat4 => {
  const out = mat4.create();
  mat4.rotateZ(out, out, z);
  mat4.rotateY(out, out, y);
  mat4.rotateX(out, out, x);
  return out;
};

export const scale = (value: Vec3): Mat4 =>
  mat4.fromScaling(mat4.create(), value);

export const composeTransform = (transform: Transform | undefined): Mat4 => {
  if (transform === undefined) return identity();

  const out = mat4.create();
  mat4.translate(out, out, transform.position);
  mat4.rotateZ(out, out, transform.rotation[2]);
  mat4.rotateY(out, out, transform.rotation[1]);
  mat4.rotateX(out, out, transform.rotation[0]);
  mat4.scale(out, out, transform.scale);
  return out;
};

export const invert = (matrix: Mat4): Mat4 => {
  const out = mat4.invert(mat4.create(), matrix);
  if (out === null) throw new Error("Matrix is not invertible");
  return out;
};

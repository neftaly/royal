import type {
  Camera,
  CameraViewReadTarget,
  Transform,
  Vec3,
} from "@royal/renderer-core";
import { mat4 as glMatrixMat4 } from "gl-matrix";

export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type MutableMat4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export type Vec4 = readonly [x: number, y: number, z: number, w: number];

const IDENTITY_TRANSFORM: Transform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
};

export const identityMat4 = (): MutableMat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const multiplyMat4Into = (
  out: MutableMat4,
  left: Mat4,
  right: Mat4,
): MutableMat4 => {
  glMatrixMat4.multiply(out, left as MutableMat4, right as MutableMat4);
  return out;
};

export const multiplyMat4 = (left: Mat4, right: Mat4): Mat4 =>
  multiplyMat4Into([
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ], left, right);

export const inverseMat4Into = (
  out: MutableMat4,
  matrix: Mat4,
): MutableMat4 | undefined =>
  glMatrixMat4.invert(out, matrix as MutableMat4) === null ? undefined : out;

export const inverseMat4 = (matrix: Mat4): Mat4 | undefined =>
  inverseMat4Into(identityMat4(), matrix);

export const transformVec4 = (matrix: Mat4, [x, y, z, w]: Vec4): Vec4 => [
  matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
  matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
  matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
  matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
];

export const transformPoint = (matrix: Mat4, point: Vec3): Vec3 => {
  const [x, y, z, w] = transformVec4(matrix, [point[0], point[1], point[2], 1]);
  const divisor = w === 0 ? 1 : w;
  return [x / divisor, y / divisor, z / divisor];
};

export const transformDirection = (matrix: Mat4, direction: Vec3): Vec3 => {
  const x = matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2];
  const y = matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2];
  const z = matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2];
  const length = Math.hypot(x, y, z);
  if (length === 0) return [0, 0, -1];

  return [x / length, y / length, z / length];
};

export const subtractVec3 = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0],
  left[1] - right[1],
  left[2] - right[2],
];

export const crossVec3 = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

export const dotVec3 = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

export const orientationPreservingMat4 = (matrix: Mat4): boolean => {
  const determinant =
    matrix[0] * (matrix[5] * matrix[10] - matrix[9] * matrix[6])
    - matrix[4] * (matrix[1] * matrix[10] - matrix[9] * matrix[2])
    + matrix[8] * (matrix[1] * matrix[6] - matrix[5] * matrix[2]);

  return determinant >= 0;
};

export const translationMat4 = ([x, y, z]: Vec3): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  x, y, z, 1,
];

export const scaleMat4 = ([x, y, z]: Vec3): Mat4 => [
  x, 0, 0, 0,
  0, y, 0, 0,
  0, 0, z, 0,
  0, 0, 0, 1,
];

export const rotationXMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ];
};

export const rotationYMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ];
};

export const rotationZMat4 = (radians: number): Mat4 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return [
    c, s, 0, 0,
    -s, c, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
};

export const transformMat4Into = (
  out: MutableMat4,
  transform: Transform | undefined,
): MutableMat4 => {
  const actual = transform ?? IDENTITY_TRANSFORM;
  const [rotationX, rotationY, rotationZ] = actual.rotation;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosZ = Math.cos(rotationZ);
  const sinZ = Math.sin(rotationZ);
  const [scaleX, scaleY, scaleZ] = actual.scale;

  out[0] = cosZ * cosY * scaleX;
  out[1] = sinZ * cosY * scaleX;
  out[2] = -sinY * scaleX;
  out[3] = 0;
  out[4] = (cosZ * sinY * sinX - sinZ * cosX) * scaleY;
  out[5] = (sinZ * sinY * sinX + cosZ * cosX) * scaleY;
  out[6] = cosY * sinX * scaleY;
  out[7] = 0;
  out[8] = (cosZ * sinY * cosX + sinZ * sinX) * scaleZ;
  out[9] = (sinZ * sinY * cosX - cosZ * sinX) * scaleZ;
  out[10] = cosY * cosX * scaleZ;
  out[11] = 0;
  out[12] = actual.position[0];
  out[13] = actual.position[1];
  out[14] = actual.position[2];
  out[15] = 1;
  return out;
};

export const transformMat4 = (transform: Transform | undefined): Mat4 =>
  transformMat4Into(identityMat4(), transform);

export const quaternionMat4 = (rotation: readonly number[] | undefined): Mat4 => {
  const x = rotation?.[0] ?? 0;
  const y = rotation?.[1] ?? 0;
  const z = rotation?.[2] ?? 0;
  const w = rotation?.[3] ?? 1;
  const length = Math.hypot(x, y, z, w) || 1;
  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  const nw = w / length;
  const xx = nx * nx;
  const xy = nx * ny;
  const xz = nx * nz;
  const xw = nx * nw;
  const yy = ny * ny;
  const yz = ny * nz;
  const yw = ny * nw;
  const zz = nz * nz;
  const zw = nz * nw;

  return [
    1 - 2 * (yy + zz), 2 * (xy + zw), 2 * (xz - yw), 0,
    2 * (xy - zw), 1 - 2 * (xx + zz), 2 * (yz + xw), 0,
    2 * (xz + yw), 2 * (yz - xw), 1 - 2 * (xx + yy), 0,
    0, 0, 0, 1,
  ];
};

type ReadableCamera = Camera | CameraViewReadTarget;

export const viewMat4 = (camera: ReadableCamera): Mat4 => multiplyMat4(
  multiplyMat4(
    multiplyMat4(
      rotationXMat4(-camera.rotation[0]),
      rotationYMat4(-camera.rotation[1]),
    ),
    rotationZMat4(-camera.rotation[2]),
  ),
  translationMat4([-camera.position[0], -camera.position[1], -camera.position[2]]),
);

export const viewMat4Into = (out: MutableMat4, camera: ReadableCamera): MutableMat4 => {
  glMatrixMat4.identity(out);
  glMatrixMat4.rotateX(out, out, -camera.rotation[0]!);
  glMatrixMat4.rotateY(out, out, -camera.rotation[1]!);
  glMatrixMat4.rotateZ(out, out, -camera.rotation[2]!);
  const x = -camera.position[0]!;
  const y = -camera.position[1]!;
  const z = -camera.position[2]!;
  out[12] = out[0] * x + out[4] * y + out[8] * z;
  out[13] = out[1] * x + out[5] * y + out[9] * z;
  out[14] = out[2] * x + out[6] * y + out[10] * z;
  out[15] = 1;
  return out;
};

export const projectionMat4Into = (
  out: MutableMat4,
  camera: ReadableCamera,
  width: number,
  height: number,
): MutableMat4 => {
  if (camera.kind === "orthographic-camera") {
    const { bottom, far, left, near, right, top } = camera;
    out[0] = 2 / (right - left); out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0; out[5] = 2 / (top - bottom); out[6] = 0; out[7] = 0;
    out[8] = 0; out[9] = 0; out[10] = -2 / (far - near); out[11] = 0;
    out[12] = -(right + left) / (right - left);
    out[13] = -(top + bottom) / (top - bottom);
    out[14] = -(far + near) / (far - near); out[15] = 1;
    return out;
  }

  const aspect = width / Math.max(1, height);
  const f = 1 / Math.tan(camera.fovY / 2);
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0; out[10] = (camera.far + camera.near) / (camera.near - camera.far); out[11] = -1;
  out[12] = 0; out[13] = 0; out[14] = (2 * camera.far * camera.near) / (camera.near - camera.far); out[15] = 0;
  return out;
};

export const projectionMat4 = (camera: ReadableCamera, width: number, height: number): Mat4 =>
  projectionMat4Into(identityMat4(), camera, width, height);

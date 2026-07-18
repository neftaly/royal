import type {
  Camera,
  CameraViewReadTarget,
  Transform,
  Vec3,
} from "@royal/renderer-core";
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

export type MutableVec3 = [x: number, y: number, z: number];

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

/** Exact retained-value comparison for matrix snapshot caches. */
export const mat4ValuesEqual = (left: ArrayLike<number>, right: Mat4): boolean => {
  for (let index = 0; index < 16; index += 1) {
    if (!Object.is(left[index], right[index])) return false;
  }
  return true;
};

/** Copies a matrix into caller-owned numeric storage without allocating. */
export const copyMat4ValuesInto = <Target extends { [index: number]: number }>(
  target: Target,
  source: Mat4,
): Target => {
  for (let index = 0; index < 16; index += 1) target[index] = source[index]!;
  return target;
};

export const multiplyMat4Into = (
  out: MutableMat4,
  left: Mat4,
  right: Mat4,
): MutableMat4 => {
  const a00 = left[0]; const a01 = left[1]; const a02 = left[2]; const a03 = left[3];
  const a10 = left[4]; const a11 = left[5]; const a12 = left[6]; const a13 = left[7];
  const a20 = left[8]; const a21 = left[9]; const a22 = left[10]; const a23 = left[11];
  const a30 = left[12]; const a31 = left[13]; const a32 = left[14]; const a33 = left[15];
  let b0 = right[0]; let b1 = right[1]; let b2 = right[2]; let b3 = right[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = right[4]; b1 = right[5]; b2 = right[6]; b3 = right[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = right[8]; b1 = right[9]; b2 = right[10]; b3 = right[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  b0 = right[12]; b1 = right[13]; b2 = right[14]; b3 = right[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
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
): MutableMat4 | undefined => {
  const a00 = matrix[0]; const a01 = matrix[1]; const a02 = matrix[2]; const a03 = matrix[3];
  const a10 = matrix[4]; const a11 = matrix[5]; const a12 = matrix[6]; const a13 = matrix[7];
  const a20 = matrix[8]; const a21 = matrix[9]; const a22 = matrix[10]; const a23 = matrix[11];
  const a30 = matrix[12]; const a31 = matrix[13]; const a32 = matrix[14]; const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  const determinant = b00 * b11 - b01 * b10 + b02 * b09
    + b03 * b08 - b04 * b07 + b05 * b06;
  if (determinant === 0 || !Number.isFinite(determinant)) return undefined;
  const inverseDeterminant = 1 / determinant;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inverseDeterminant;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inverseDeterminant;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inverseDeterminant;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inverseDeterminant;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inverseDeterminant;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inverseDeterminant;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inverseDeterminant;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inverseDeterminant;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inverseDeterminant;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inverseDeterminant;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inverseDeterminant;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inverseDeterminant;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inverseDeterminant;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inverseDeterminant;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inverseDeterminant;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inverseDeterminant;
  return out;
};

export const inverseMat4 = (matrix: Mat4): Mat4 | undefined =>
  inverseMat4Into(identityMat4(), matrix);

/** Writes the world-space origin of an orthonormal world-to-view matrix. */
export const cameraWorldPositionFromViewInto = <Target extends { [index: number]: number }>(
  out: Target,
  view: Mat4,
): Target => {
  const translationX = view[12];
  const translationY = view[13];
  const translationZ = view[14];
  out[0] = -(view[0] * translationX + view[1] * translationY + view[2] * translationZ);
  out[1] = -(view[4] * translationX + view[5] * translationY + view[6] * translationZ);
  out[2] = -(view[8] * translationX + view[9] * translationY + view[10] * translationZ);
  return out;
};

/**
 * Writes the signed cofactor transform used for affine surface normals.
 * The upper-left mat3 transforms normals; slot 15 carries basis handedness.
 * Keeping both in one mat4 gives the vertex shell a single cached uniform.
 */
export const affineSurfaceNormalTransformInto = (
  out: MutableMat4,
  model: Mat4,
): MutableMat4 => {
  const cofactor0X = model[5] * model[10] - model[6] * model[9];
  const cofactor0Y = model[6] * model[8] - model[4] * model[10];
  const cofactor0Z = model[4] * model[9] - model[5] * model[8];
  const determinant = model[0] * cofactor0X + model[1] * cofactor0Y + model[2] * cofactor0Z;
  const handedness = determinant < 0 ? -1 : 1;
  out[0] = cofactor0X * handedness;
  out[1] = cofactor0Y * handedness;
  out[2] = cofactor0Z * handedness;
  out[3] = 0;
  out[4] = (model[2] * model[9] - model[1] * model[10]) * handedness;
  out[5] = (model[0] * model[10] - model[2] * model[8]) * handedness;
  out[6] = (model[1] * model[8] - model[0] * model[9]) * handedness;
  out[7] = 0;
  out[8] = (model[1] * model[6] - model[2] * model[5]) * handedness;
  out[9] = (model[2] * model[4] - model[0] * model[6]) * handedness;
  out[10] = (model[0] * model[5] - model[1] * model[4]) * handedness;
  out[11] = 0;
  out[12] = 0;
  out[13] = 0;
  out[14] = 0;
  out[15] = handedness;
  return out;
};

export const transformPointInto = (
  out: MutableVec3,
  matrix: Mat4,
  point: Vec3,
): MutableVec3 => {
  const pointX = point[0];
  const pointY = point[1];
  const pointZ = point[2];
  const x = matrix[0] * pointX + matrix[4] * pointY + matrix[8] * pointZ + matrix[12];
  const y = matrix[1] * pointX + matrix[5] * pointY + matrix[9] * pointZ + matrix[13];
  const z = matrix[2] * pointX + matrix[6] * pointY + matrix[10] * pointZ + matrix[14];
  const w = matrix[3] * pointX + matrix[7] * pointY + matrix[11] * pointZ + matrix[15];
  const divisor = w === 0 ? 1 : w;
  out[0] = x / divisor;
  out[1] = y / divisor;
  out[2] = z / divisor;
  return out;
};

export const transformPoint = (matrix: Mat4, point: Vec3): Vec3 =>
  transformPointInto([0, 0, 0], matrix, point);

export const transformDirectionInto = (
  out: MutableVec3,
  matrix: Mat4,
  direction: Vec3,
): MutableVec3 => {
  const x = matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2];
  const y = matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2];
  const z = matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2];
  const length = Math.hypot(x, y, z);
  if (length === 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = -1;
    return out;
  }
  out[0] = x / length;
  out[1] = y / length;
  out[2] = z / length;
  return out;
};

export const transformDirection = (matrix: Mat4, direction: Vec3): Vec3 =>
  transformDirectionInto([0, 0, 0], matrix, direction);

export const dotVec3 = (left: Vec3, right: Vec3): number =>
  left[0] * right[0] + left[1] * right[1] + left[2] * right[2];

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

export const composeEulerMat4Into = (
  out: MutableMat4,
  position: ArrayLike<number>,
  scale: ArrayLike<number>,
  offset: number,
  cosX: number,
  sinX: number,
  cosY: number,
  sinY: number,
  cosZ: number,
  sinZ: number,
): MutableMat4 => {
  const scaleX = scale[offset]!;
  const scaleY = scale[offset + 1]!;
  const scaleZ = scale[offset + 2]!;

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
  out[12] = position[offset]!;
  out[13] = position[offset + 1]!;
  out[14] = position[offset + 2]!;
  out[15] = 1;
  return out;
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
  return composeEulerMat4Into(
    out,
    actual.position,
    actual.scale,
    0,
    cosX,
    sinX,
    cosY,
    sinY,
    cosZ,
    sinZ,
  );
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
  const xRotation = -camera.rotation[0]!;
  const yRotation = -camera.rotation[1]!;
  const zRotation = -camera.rotation[2]!;
  const cx = Math.cos(xRotation); const sx = Math.sin(xRotation);
  const cy = Math.cos(yRotation); const sy = Math.sin(yRotation);
  const cz = Math.cos(zRotation); const sz = Math.sin(zRotation);
  out[0] = cy * cz;
  out[1] = cx * sz + sx * sy * cz;
  out[2] = sx * sz - cx * sy * cz;
  out[3] = 0;
  out[4] = -cy * sz;
  out[5] = cx * cz - sx * sy * sz;
  out[6] = sx * cz + cx * sy * sz;
  out[7] = 0;
  out[8] = sy;
  out[9] = -sx * cy;
  out[10] = cx * cy;
  out[11] = 0;
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

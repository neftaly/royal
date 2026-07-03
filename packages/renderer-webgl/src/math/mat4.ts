import type {
  Camera,
  Transform,
  Vec3,
} from "@royal/renderer-core";

export type Mat4 = readonly [
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

export const identityMat4 = (): Mat4 => [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export const multiplyMat4 = (left: Mat4, right: Mat4): Mat4 => {
  const out: [
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
    number, number, number, number,
  ] = [
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
    0, 0, 0, 0,
  ];
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row]! * right[column * 4]!
        + left[4 + row]! * right[column * 4 + 1]!
        + left[8 + row]! * right[column * 4 + 2]!
        + left[12 + row]! * right[column * 4 + 3]!;
    }
  }

  return out;
};

export const inverseMat4 = (matrix: Mat4): Mat4 | undefined => {
  const [
    a00, a01, a02, a03,
    a10, a11, a12, a13,
    a20, a21, a22, a23,
    a30, a31, a32, a33,
  ] = matrix;

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

  const determinant = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (Math.abs(determinant) < 1e-12) return undefined;
  const invDeterminant = 1 / determinant;

  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * invDeterminant,
    (a02 * b10 - a01 * b11 - a03 * b09) * invDeterminant,
    (a31 * b05 - a32 * b04 + a33 * b03) * invDeterminant,
    (a22 * b04 - a21 * b05 - a23 * b03) * invDeterminant,
    (a12 * b08 - a10 * b11 - a13 * b07) * invDeterminant,
    (a00 * b11 - a02 * b08 + a03 * b07) * invDeterminant,
    (a32 * b02 - a30 * b05 - a33 * b01) * invDeterminant,
    (a20 * b05 - a22 * b02 + a23 * b01) * invDeterminant,
    (a10 * b10 - a11 * b08 + a13 * b06) * invDeterminant,
    (a01 * b08 - a00 * b10 - a03 * b06) * invDeterminant,
    (a30 * b04 - a31 * b02 + a33 * b00) * invDeterminant,
    (a21 * b02 - a20 * b04 - a23 * b00) * invDeterminant,
    (a11 * b07 - a10 * b09 - a12 * b06) * invDeterminant,
    (a00 * b09 - a01 * b07 + a02 * b06) * invDeterminant,
    (a31 * b01 - a30 * b03 - a32 * b00) * invDeterminant,
    (a20 * b03 - a21 * b01 + a22 * b00) * invDeterminant,
  ];
};

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
  const [x, y, z] = transformVec4(matrix, [direction[0], direction[1], direction[2], 0]);
  return normalizeVec3([x, y, z]);
};

export const normalizeVec3 = ([x, y, z]: Vec3): Vec3 => {
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

export const transformMat4 = (transform: Transform | undefined): Mat4 => {
  const actual = transform ?? IDENTITY_TRANSFORM;
  return multiplyMat4(
    translationMat4(actual.position),
    multiplyMat4(
      rotationZMat4(actual.rotation[2]),
      multiplyMat4(
        rotationYMat4(actual.rotation[1]),
        multiplyMat4(rotationXMat4(actual.rotation[0]), scaleMat4(actual.scale)),
      ),
    ),
  );
};

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

export const viewMat4 = (camera: Camera): Mat4 => multiplyMat4(
  multiplyMat4(
    multiplyMat4(
      rotationXMat4(-camera.rotation[0]),
      rotationYMat4(-camera.rotation[1]),
    ),
    rotationZMat4(-camera.rotation[2]),
  ),
  translationMat4([-camera.position[0], -camera.position[1], -camera.position[2]]),
);

export const projectionMat4 = (camera: Camera, width: number, height: number): Mat4 => {
  if (camera.kind === "orthographic-camera") {
    const { bottom, far, left, near, right, top } = camera;
    return [
      2 / (right - left), 0, 0, 0,
      0, 2 / (top - bottom), 0, 0,
      0, 0, -2 / (far - near), 0,
      -(right + left) / (right - left), -(top + bottom) / (top - bottom), -(far + near) / (far - near), 1,
    ];
  }

  const aspect = width / Math.max(1, height);
  const f = 1 / Math.tan(camera.fovY / 2);
  return [
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (camera.far + camera.near) / (camera.near - camera.far), -1,
    0, 0, (2 * camera.far * camera.near) / (camera.near - camera.far), 0,
  ];
};

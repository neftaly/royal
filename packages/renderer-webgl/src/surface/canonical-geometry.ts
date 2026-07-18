import type { Geometry } from "@royal/renderer-core";

export type CanonicalTriangleGeometry = Readonly<{
  bounds: Readonly<{
    max: readonly [number, number, number];
    min: readonly [number, number, number];
  }>;
  indices: Uint8Array | Uint16Array | Uint32Array;
  key: string;
  normals?: Float32Array;
  positions: Float32Array;
  textureCoordinates0?: Float32Array;
}>;

const planeGeometry = (
  width: number,
  height: number,
  textureCoordinates: boolean,
): CanonicalTriangleGeometry => {
  const x = width * 0.5;
  const y = height * 0.5;
  return {
    bounds: {
      max: [x, y, 0],
      min: [-x, -y, 0],
    },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    key: `plane:${width}:${height}${textureCoordinates ? ":uv0" : ""}`,
    positions: new Float32Array([
      -x, -y, 0,
      x, -y, 0,
      x, y, 0,
      -x, y, 0,
    ]),
    ...(textureCoordinates ? {
      textureCoordinates0: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
    } : {}),
  };
};

const boxGeometry = (
  width: number,
  height: number,
  depth: number,
  textureCoordinates: boolean,
): CanonicalTriangleGeometry => {
  const x = width * 0.5;
  const y = height * 0.5;
  const z = depth * 0.5;
  if (!textureCoordinates) return {
    bounds: {
      max: [x, y, z],
      min: [-x, -y, -z],
    },
    indices: new Uint16Array([
      0, 1, 2, 0, 2, 3,
      5, 4, 7, 5, 7, 6,
      4, 0, 3, 4, 3, 7,
      1, 5, 6, 1, 6, 2,
      3, 2, 6, 3, 6, 7,
      4, 5, 1, 4, 1, 0,
    ]),
    key: `box:${width}:${height}:${depth}`,
    positions: new Float32Array([
      -x, -y, z,
      x, -y, z,
      x, y, z,
      -x, y, z,
      -x, -y, -z,
      x, -y, -z,
      x, y, -z,
      -x, y, -z,
    ]),
  };
  const positions = new Float32Array([
    -x, -y, z, x, -y, z, x, y, z, -x, y, z,
    x, -y, -z, -x, -y, -z, -x, y, -z, x, y, -z,
    -x, -y, -z, -x, -y, z, -x, y, z, -x, y, -z,
    x, -y, z, x, -y, -z, x, y, -z, x, y, z,
    -x, y, z, x, y, z, x, y, -z, -x, y, -z,
    -x, -y, -z, x, -y, -z, x, -y, z, -x, -y, z,
  ]);
  const indices = new Uint16Array(36);
  const textureCoordinates0 = new Float32Array(48);
  for (let face = 0; face < 6; face += 1) {
    const vertex = face * 4;
    const indexOffset = face * 6;
    indices.set([vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3], indexOffset);
    textureCoordinates0.set([0, 1, 1, 1, 1, 0, 0, 0], face * 8);
  }
  return {
    bounds: { max: [x, y, z], min: [-x, -y, -z] },
    indices,
    key: `box:${width}:${height}:${depth}:uv0`,
    positions,
    textureCoordinates0,
  };
};

/** Lowers one validated direct descriptor to the shared triangle ABI. */
export const prepareCanonicalGeometry = (
  geometry: Geometry,
  textureCoordinates = false,
): CanonicalTriangleGeometry => {
  switch (geometry.kind) {
    case "plane":
      return planeGeometry(geometry.size[0], geometry.size[1], textureCoordinates);
    case "box":
      return boxGeometry(geometry.size[0], geometry.size[1], geometry.size[2], textureCoordinates);
  }
};

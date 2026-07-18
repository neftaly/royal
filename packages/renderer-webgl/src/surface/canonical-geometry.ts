import type { Geometry } from "@royal/renderer-core";

export type CanonicalTriangleGeometry = Readonly<{
  bounds: Readonly<{
    max: readonly [number, number, number];
    min: readonly [number, number, number];
  }>;
  indices: Uint8Array | Uint16Array | Uint32Array;
  key: string;
  positions: Float32Array;
}>;

const planeGeometry = (width: number, height: number): CanonicalTriangleGeometry => {
  const x = width * 0.5;
  const y = height * 0.5;
  return {
    bounds: {
      max: [x, y, 0],
      min: [-x, -y, 0],
    },
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
    key: `plane:${width}:${height}`,
    positions: new Float32Array([
      -x, -y, 0,
      x, -y, 0,
      x, y, 0,
      -x, y, 0,
    ]),
  };
};

const boxGeometry = (width: number, height: number, depth: number): CanonicalTriangleGeometry => {
  const x = width * 0.5;
  const y = height * 0.5;
  const z = depth * 0.5;
  return {
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
};

/** Lowers one validated direct descriptor to the shared triangle ABI. */
export const prepareCanonicalGeometry = (geometry: Geometry): CanonicalTriangleGeometry => {
  switch (geometry.kind) {
    case "plane":
      return planeGeometry(geometry.size[0], geometry.size[1]);
    case "box":
      return boxGeometry(geometry.size[0], geometry.size[1], geometry.size[2]);
  }
};

import type { BoxGeometry } from "@royal/renderer-core";

export interface IndexedGeometryData {
  readonly indices: Uint16Array;
  readonly normals: Float32Array;
  readonly positions: Float32Array;
}

export const boxGeometryData = (geometry: BoxGeometry): IndexedGeometryData => {
  const [width, height, depth] = geometry.size;
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;

  return {
    positions: new Float32Array([
      -x,
      -y,
      z,
      x,
      -y,
      z,
      x,
      y,
      z,
      -x,
      y,
      z,
      x,
      -y,
      -z,
      -x,
      -y,
      -z,
      -x,
      y,
      -z,
      x,
      y,
      -z,
      -x,
      y,
      z,
      x,
      y,
      z,
      x,
      y,
      -z,
      -x,
      y,
      -z,
      -x,
      -y,
      -z,
      x,
      -y,
      -z,
      x,
      -y,
      z,
      -x,
      -y,
      z,
      x,
      -y,
      z,
      x,
      -y,
      -z,
      x,
      y,
      -z,
      x,
      y,
      z,
      -x,
      -y,
      -z,
      -x,
      -y,
      z,
      -x,
      y,
      z,
      -x,
      y,
      -z,
    ]),
    normals: new Float32Array([
      0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
      -1, 0, 0,
    ]),
    indices: new Uint16Array([
      0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 8, 9, 10, 8, 10, 11, 12, 13, 14, 12,
      14, 15, 16, 17, 18, 16, 18, 19, 20, 21, 22, 20, 22, 23,
    ]),
  };
};

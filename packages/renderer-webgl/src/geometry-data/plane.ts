import type { PlaneGeometry } from "@royal/renderer-core";
import type { IndexedGeometryData } from "./box";

export const planeGeometryData = (geometry: PlaneGeometry): IndexedGeometryData => {
  const [width, height] = geometry.size;
  const x = width / 2;
  const y = height / 2;

  return {
    positions: new Float32Array([
      -x, -y, 0,
      x, -y, 0,
      x, y, 0,
      -x, y, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    indices: new Uint16Array([
      0, 1, 2,
      0, 2, 3,
    ]),
  };
};

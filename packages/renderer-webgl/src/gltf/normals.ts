import type { GltfIndexArray } from "./accessors";

const addGeneratedNormal = (
  normals: Float32Array,
  positions: Float32Array,
  first: number,
  second: number,
  third: number,
): void => {
  const firstOffset = first * 3;
  const secondOffset = second * 3;
  const thirdOffset = third * 3;
  if (
    firstOffset + 2 >= positions.length
    || secondOffset + 2 >= positions.length
    || thirdOffset + 2 >= positions.length
  ) return;

  const ax = positions[firstOffset]!;
  const ay = positions[firstOffset + 1]!;
  const az = positions[firstOffset + 2]!;
  const bx = positions[secondOffset]!;
  const by = positions[secondOffset + 1]!;
  const bz = positions[secondOffset + 2]!;
  const cx = positions[thirdOffset]!;
  const cy = positions[thirdOffset + 1]!;
  const cz = positions[thirdOffset + 2]!;
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz);
  if (length <= 0.000001) return;

  const normalX = nx / length;
  const normalY = ny / length;
  const normalZ = nz / length;
  for (const offset of [firstOffset, secondOffset, thirdOffset]) {
    normals[offset]! += normalX;
    normals[offset + 1]! += normalY;
    normals[offset + 2]! += normalZ;
  }
};

const normalizeGeneratedNormals = (normals: Float32Array): void => {
  for (let offset = 0; offset + 2 < normals.length; offset += 3) {
    const x = normals[offset]!;
    const y = normals[offset + 1]!;
    const z = normals[offset + 2]!;
    const length = Math.hypot(x, y, z);
    if (length <= 0.000001) {
      normals[offset] = 0;
      normals[offset + 1] = 0;
      normals[offset + 2] = 1;
    } else {
      normals[offset] = x / length;
      normals[offset + 1] = y / length;
      normals[offset + 2] = z / length;
    }
  }
};

export const generateGltfPrimitiveNormals = (
  positions: Float32Array,
  indices: GltfIndexArray | undefined,
  mode: string,
): Float32Array | undefined => {
  if (mode !== "triangles" && mode !== "triangle-strip" && mode !== "triangle-fan") return undefined;

  const vertexCount = Math.floor(positions.length / 3);
  if (vertexCount === 0) return undefined;

  const normals = new Float32Array(vertexCount * 3);
  const drawVertexCount = indices?.length ?? vertexCount;
  const vertexIndex = (drawIndex: number): number | undefined => {
    const index = indices?.[drawIndex] ?? drawIndex;
    return index >= 0 && index < vertexCount ? index : undefined;
  };
  const addTriangle = (firstDraw: number, secondDraw: number, thirdDraw: number): void => {
    const first = vertexIndex(firstDraw);
    const second = vertexIndex(secondDraw);
    const third = vertexIndex(thirdDraw);
    if (first === undefined || second === undefined || third === undefined) return;

    addGeneratedNormal(normals, positions, first, second, third);
  };

  if (mode === "triangles") {
    for (let index = 0; index + 2 < drawVertexCount; index += 3) {
      addTriangle(index, index + 1, index + 2);
    }
  } else if (mode === "triangle-strip") {
    for (let index = 0; index + 2 < drawVertexCount; index += 1) {
      if (index % 2 === 0) addTriangle(index, index + 1, index + 2);
      else addTriangle(index + 1, index, index + 2);
    }
  } else {
    for (let index = 1; index + 1 < drawVertexCount; index += 1) {
      addTriangle(0, index, index + 1);
    }
  }

  normalizeGeneratedNormals(normals);
  return normals;
};

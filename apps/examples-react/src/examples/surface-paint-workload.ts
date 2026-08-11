import {
  boxGeometry,
  linearRgbaFromSrgb,
  mesh,
  triangleGeometry,
  unlitMaterial,
  type MeshNode,
  type TriangleGeometry,
  type WorldPosition3,
} from '@royal/react/scene';

type Vec3 = readonly [number, number, number];

type SurfaceSample = Readonly<{
  normal: Vec3;
  point: Vec3;
  width: number;
}>;

export type SurfacePaintWorkloadOptions = Readonly<{
  kind: 'cards' | 'minis' | 'mixed';
  ownership: 'piece' | 'world';
  pieces: number;
  pointsPerStroke: number;
  strokesPerPiece: number;
  surfaceLift: number;
}>;

export type SurfacePaintWorkload = Readonly<{
  inkMeshes: number;
  nodes: readonly MeshNode[];
  paintTriangles: number;
  paintVertices: number;
  pieces: number;
}>;

const palette = [
  unlitMaterial({ color: linearRgbaFromSrgb([0.05, 0.09, 0.16, 1]) }),
  unlitMaterial({ color: linearRgbaFromSrgb([0.86, 0.12, 0.14, 1]) }),
  unlitMaterial({ color: linearRgbaFromSrgb([0.04, 0.35, 0.76, 1]) }),
  unlitMaterial({ color: linearRgbaFromSrgb([0.94, 0.64, 0.08, 1]) }),
] as const;
const cardGeometry = boxGeometry({ size: [0.063, 0.088, 0.00035] });
const cardMaterial = unlitMaterial({ color: linearRgbaFromSrgb([0.91, 0.88, 0.8, 1]) });
const miniMaterial = unlitMaterial({ color: linearRgbaFromSrgb([0.34, 0.38, 0.42, 1]) });

const add = (left: Vec3, right: Vec3): Vec3 => [
  left[0] + right[0], left[1] + right[1], left[2] + right[2],
];
const subtract = (left: Vec3, right: Vec3): Vec3 => [
  left[0] - right[0], left[1] - right[1], left[2] - right[2],
];
const scale = (value: Vec3, factor: number): Vec3 => [
  value[0] * factor, value[1] * factor, value[2] * factor,
];
const cross = (left: Vec3, right: Vec3): Vec3 => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
const normalize = (value: Vec3): Vec3 => {
  const length = Math.hypot(value[0], value[1], value[2]);
  return length > 1e-9 ? scale(value, 1 / length) : [1, 0, 0];
};

const push3 = (target: number[], value: Vec3): void => {
  target.push(value[0], value[1], value[2]);
};

type MutableGeometry = {
  readonly indices: number[];
  readonly normals: number[];
  readonly positions: number[];
};

const appendRibbon = (
  target: MutableGeometry,
  samples: readonly SurfaceSample[],
  translation: Vec3 = [0, 0, 0],
  surfaceLift = 0,
): void => {
  if (samples.length < 2) return;
  const firstVertex = target.positions.length / 3;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const previous = samples[Math.max(0, index - 1)]!;
    const next = samples[Math.min(samples.length - 1, index + 1)]!;
    const tangent = normalize(subtract(next.point, previous.point));
    const side = scale(normalize(cross(sample.normal, tangent)), sample.width / 2);
    const lifted = add(add(sample.point, scale(sample.normal, surfaceLift)), translation);
    push3(target.positions, subtract(lifted, side));
    push3(target.positions, add(lifted, side));
    push3(target.normals, sample.normal);
    push3(target.normals, sample.normal);
  }
  for (let index = 1; index < samples.length; index += 1) {
    const previous = firstVertex + (index - 1) * 2;
    const current = firstVertex + index * 2;
    target.indices.push(previous, current, previous + 1, current, current + 1, previous + 1);
  }
};

const finishGeometry = (geometry: MutableGeometry): TriangleGeometry => triangleGeometry({
  indices: geometry.indices,
  normals: geometry.normals,
  positions: geometry.positions,
});

const emptyGeometry = (): MutableGeometry => ({ indices: [], normals: [], positions: [] });

const cardStroke = (
  pieceIndex: number,
  strokeIndex: number,
  pointCount: number,
): readonly SurfaceSample[] => Array.from({ length: pointCount }, (_, pointIndex) => {
  const progress = pointIndex / (pointCount - 1);
  const line = strokeIndex;
  const phase = pieceIndex * 0.37 + strokeIndex * 0.83;
  return {
    normal: [0, 0, 1],
    point: [
      -0.025 + progress * 0.05,
      0.032 - line * 0.0058 + Math.sin(progress * Math.PI * 3 + phase) * 0.001,
      0.000175,
    ],
    width: 0.0006 + (Math.sin(progress * Math.PI + phase) * 0.5 + 0.5) * 0.0005,
  };
});

const miniatureStroke = (
  pieceIndex: number,
  strokeIndex: number,
  pointCount: number,
): readonly SurfaceSample[] => Array.from({ length: pointCount }, (_, pointIndex) => {
  const progress = pointIndex / (pointCount - 1);
  const phase = pieceIndex * 0.31 + strokeIndex * 0.71;
  const longitude = -1.25 + progress * 2.5 + Math.sin(phase) * 0.22;
  const latitude = -0.85 + strokeIndex * 0.155
    + Math.sin(progress * Math.PI * 2 + phase) * 0.1;
  const cosLatitude = Math.cos(latitude);
  const normal: Vec3 = [
    Math.sin(longitude) * cosLatitude,
    Math.sin(latitude),
    Math.cos(longitude) * cosLatitude,
  ];
  return {
    normal,
    point: scale(normal, 0.018),
    width: 0.0007 + (Math.sin(progress * Math.PI + phase) * 0.5 + 0.5) * 0.0007,
  };
});

const sphereGeometry = (radius: number, rings = 14, segments = 18): TriangleGeometry => {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const latitude = -Math.PI / 2 + ring / rings * Math.PI;
    const cosLatitude = Math.cos(latitude);
    for (let segment = 0; segment <= segments; segment += 1) {
      const longitude = segment / segments * Math.PI * 2;
      const normal: Vec3 = [
        Math.sin(longitude) * cosLatitude,
        Math.sin(latitude),
        Math.cos(longitude) * cosLatitude,
      ];
      push3(normals, normal);
      push3(positions, scale(normal, radius));
    }
  }
  const row = segments + 1;
  for (let ring = 0; ring < rings; ring += 1) {
    for (let segment = 0; segment < segments; segment += 1) {
      const topLeft = ring * row + segment;
      const bottomLeft = topLeft + row;
      indices.push(topLeft, bottomLeft, topLeft + 1, topLeft + 1, bottomLeft, bottomLeft + 1);
    }
  }
  return triangleGeometry({ indices, normals, positions });
};

const miniGeometry = sphereGeometry(0.018);

const piecePosition = (index: number, count: number): WorldPosition3 => {
  const columns = Math.ceil(Math.sqrt(count * 1.4));
  const row = Math.floor(index / columns);
  const column = index % columns;
  const rows = Math.ceil(count / columns);
  return [(column - (columns - 1) / 2) * 0.085, ((rows - 1) / 2 - row) * 0.105, 0];
};

export const createSurfacePaintWorkload = (
  options: SurfacePaintWorkloadOptions,
): SurfacePaintWorkload => {
  const baseNodes: MeshNode[] = [];
  const inkNodes: MeshNode[] = [];
  const worldInk = palette.map(emptyGeometry);
  let paintVertices = 0;
  let paintTriangles = 0;
  for (let index = 0; index < options.pieces; index += 1) {
    const position = piecePosition(index, options.pieces);
    const mini = options.kind === 'minis'
      || (options.kind === 'mixed' && index % 2 === 1);
    baseNodes.push(mesh({
      geometry: mini ? miniGeometry : cardGeometry,
      material: mini ? miniMaterial : cardMaterial,
      transform: { position },
    }));
    const pieceInk = palette.map(emptyGeometry);
    for (let strokeIndex = 0; strokeIndex < options.strokesPerPiece; strokeIndex += 1) {
      const samples = mini
        ? miniatureStroke(index, strokeIndex, options.pointsPerStroke)
        : cardStroke(index, strokeIndex, options.pointsPerStroke);
      const geometry = options.ownership === 'world'
        ? worldInk[strokeIndex % palette.length]!
        : pieceInk[strokeIndex % palette.length]!;
      appendRibbon(
        geometry,
        samples,
        options.ownership === 'world' ? position : [0, 0, 0],
        options.surfaceLift,
      );
      paintVertices += samples.length * 2;
      paintTriangles += (samples.length - 1) * 2;
    }
    if (options.ownership === 'piece') {
      for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
        const geometry = pieceInk[paletteIndex]!;
        if (geometry.positions.length === 0) continue;
        inkNodes.push(mesh({
          geometry: finishGeometry(geometry),
          material: palette[paletteIndex]!,
          transform: { position },
        }));
      }
    }
  }
  if (options.ownership === 'world') {
    for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
      const geometry = worldInk[paletteIndex]!;
      if (geometry.positions.length === 0) continue;
      inkNodes.push(mesh({ geometry: finishGeometry(geometry), material: palette[paletteIndex]! }));
    }
  }
  return {
    inkMeshes: inkNodes.length,
    nodes: [...baseNodes, ...inkNodes],
    paintTriangles,
    paintVertices,
    pieces: options.pieces,
  };
};

/** Current immutable-geometry control for one actively growing ink stroke. */
export const createLiveSurfacePaintNode = (
  pointCount: number,
  pieceCount: number,
  surfaceLift: number,
): MeshNode => {
  const samples: SurfaceSample[] = Array.from({ length: pointCount }, (_, pointIndex) => {
    const progress = pointIndex / 127;
    return {
      normal: [0, 0, 1],
      point: [
        -0.025 + progress * 0.05,
        0.034 + Math.sin(progress * Math.PI * 5) * 0.004,
        0.000175,
      ],
      width: 0.0008,
    };
  });
  const geometry = emptyGeometry();
  appendRibbon(geometry, samples, [0, 0, 0], surfaceLift);
  return mesh({
    geometry: finishGeometry(geometry),
    material: palette[1],
    transform: { position: piecePosition(0, pieceCount) },
  });
};

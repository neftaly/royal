import {
  boxGeometry,
  imageTexture,
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
  brush: 'marker' | 'mixed' | 'solid' | 'stamp';
  colors: number;
  kind: 'cards' | 'minis' | 'mixed';
  ownership: 'piece' | 'world';
  pickTriangles: number;
  presentation: 'geometry' | 'svg-vt';
  pieces: number;
  pointsPerStroke: number;
  strokesPerPiece: number;
  surfaceLift: number;
  textureVariants: number;
}>;

export type SurfacePaintWorkload = Readonly<{
  inkMeshes: number;
  nodes: readonly MeshNode[];
  paintTriangles: number;
  paintVertices: number;
  pieces: number;
}>;

type BrushKind = Exclude<SurfacePaintWorkloadOptions['brush'], 'mixed'>;

const stampTexture = imageTexture({
  src: `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <circle cx="16" cy="16" r="14" fill="white"/>
      <circle cx="10" cy="11" r="3" fill="black" fill-opacity=".28"/>
      <circle cx="22" cy="19" r="2" fill="black" fill-opacity=".2"/>
    </svg>
  `)}`,
});

const srgbColor = (index: number, count: number): readonly [number, number, number, number] => {
  const phase = index / count * Math.PI * 2;
  return [
    0.48 + Math.sin(phase) * 0.42,
    0.48 + Math.sin(phase + Math.PI * 2 / 3) * 0.42,
    0.48 + Math.sin(phase + Math.PI * 4 / 3) * 0.42,
    1,
  ];
};

const brushMaterial = (kind: BrushKind, index: number, count: number) => {
  const color = linearRgbaFromSrgb(srgbColor(index, count));
  if (kind === 'marker') {
    return unlitMaterial({ color: [color[0], color[1], color[2], 0.36] });
  }
  if (kind === 'stamp') {
    return unlitMaterial({ texture: stampTexture, tint: [color[0], color[1], color[2], 0.999] });
  }
  return unlitMaterial({ color });
};
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
  readonly textureCoordinates: number[];
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
  ...(geometry.textureCoordinates.length === 0
    ? {}
    : { textureCoordinates: geometry.textureCoordinates }),
});

const emptyGeometry = (): MutableGeometry => ({
  indices: [],
  normals: [],
  positions: [],
  textureCoordinates: [],
});

const appendStamps = (
  target: MutableGeometry,
  samples: readonly SurfaceSample[],
  translation: Vec3 = [0, 0, 0],
  surfaceLift = 0,
): void => {
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index]!;
    const previous = samples[Math.max(0, index - 1)]!;
    const next = samples[Math.min(samples.length - 1, index + 1)]!;
    const tangent = scale(normalize(subtract(next.point, previous.point)), sample.width * 0.42);
    const side = scale(normalize(cross(sample.normal, tangent)), sample.width / 2);
    const center = add(add(sample.point, scale(sample.normal, surfaceLift)), translation);
    const firstVertex = target.positions.length / 3;
    push3(target.positions, subtract(subtract(center, tangent), side));
    push3(target.positions, add(subtract(center, tangent), side));
    push3(target.positions, add(add(center, tangent), side));
    push3(target.positions, subtract(add(center, tangent), side));
    for (let vertex = 0; vertex < 4; vertex += 1) push3(target.normals, sample.normal);
    target.textureCoordinates.push(0, 0, 1, 0, 1, 1, 0, 1);
    target.indices.push(
      firstVertex, firstVertex + 1, firstVertex + 2,
      firstVertex, firstVertex + 2, firstVertex + 3,
    );
  }
};

const cardStroke = (
  pieceIndex: number,
  strokeIndex: number,
  pointCount: number,
): readonly SurfaceSample[] => Array.from({ length: pointCount }, (_, pointIndex) => {
  const progress = pointIndex / (pointCount - 1);
  const line = strokeIndex % 12;
  const layer = Math.floor(strokeIndex / 12);
  const phase = pieceIndex * 0.37 + strokeIndex * 0.83;
  return {
    normal: [0, 0, 1],
    point: [
      -0.025 + progress * 0.05,
      0.032 - line * 0.0058
        + Math.sin(progress * Math.PI * (3 + layer % 3) + phase) * 0.001,
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
  const lane = strokeIndex % 12;
  const layer = Math.floor(strokeIndex / 12);
  const reverse = layer % 2 === 0 ? progress : 1 - progress;
  const longitude = -1.25 + reverse * 2.5 + Math.sin(phase) * 0.22;
  const latitude = -0.85 + lane * 0.155
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
  const textureCoordinates: number[] = [];
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
      textureCoordinates.push(segment / segments, 1 - ring / rings);
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
  return triangleGeometry({ indices, normals, positions, textureCoordinates });
};

const miniGeometry = sphereGeometry(0.018);

const svgNumber = (value: number): string => value.toFixed(2);

const svgColor = (index: number, count: number): string => {
  const [red, green, blue] = srgbColor(index, count);
  return `rgb(${Math.round(red * 255)} ${Math.round(green * 255)} ${Math.round(blue * 255)})`;
};

const surfaceSampleUv = (sample: SurfaceSample, mini: boolean): readonly [number, number] => {
  if (!mini) {
    return [sample.point[0] / 0.063 + 0.5, 0.5 - sample.point[1] / 0.088];
  }
  return [
    Math.atan2(sample.normal[0], sample.normal[2]) / (Math.PI * 2) + 0.5,
    0.5 - Math.asin(sample.normal[1]) / Math.PI,
  ];
};

const surfacePaintSvg = (
  pieceIndex: number,
  options: SurfacePaintWorkloadOptions,
  mini: boolean,
): string => {
  const brushKinds: readonly BrushKind[] = options.brush === 'mixed'
    ? ['solid', 'marker', 'stamp']
    : [options.brush];
  const strokes = Array.from({ length: options.strokesPerPiece }, (_stroke, strokeIndex) => {
    const samples = mini
      ? miniatureStroke(pieceIndex, strokeIndex, options.pointsPerStroke)
      : cardStroke(pieceIndex, strokeIndex, options.pointsPerStroke);
    const kind = brushKinds[strokeIndex % brushKinds.length]!;
    const colorIndex = Math.floor(strokeIndex / brushKinds.length) % options.colors;
    const path = samples.map((sample, index) => {
      const [u, v] = surfaceSampleUv(sample, mini);
      return `${index === 0 ? 'M' : 'L'}${svgNumber(u * 2048)} ${svgNumber(v * 2048)}`;
    }).join('');
    const width = samples.reduce((sum, sample) => sum + sample.width, 0)
      / samples.length / (mini ? 0.036 : 0.063) * 2048;
    const opacity = kind === 'marker' ? 0.36 : 1;
    const dash = kind === 'stamp'
      ? ` stroke-dasharray="${svgNumber(width * 0.3)} ${svgNumber(width * 0.65)}"`
      : '';
    return `<path d="${path}" fill="none" stroke="${svgColor(colorIndex, options.colors)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${opacity}" stroke-width="${svgNumber(width)}"${dash}/>`;
  }).join('');
  const background = mini ? '#575f69' : '#e8e0cc';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 2048 2048"><rect width="2048" height="2048" fill="${background}"/>${strokes}</svg>`;
};

const paintedMaterial = (
  pieceIndex: number,
  options: SurfacePaintWorkloadOptions,
  mini: boolean,
) => unlitMaterial({
  texture: imageTexture({
    src: `data:image/svg+xml,${encodeURIComponent(surfacePaintSvg(pieceIndex, options, mini))}`,
  }),
});

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
  const brushKinds: readonly BrushKind[] = options.brush === 'mixed'
    ? ['solid', 'marker', 'stamp']
    : [options.brush];
  const styles = brushKinds.flatMap((kind) => Array.from(
    { length: options.colors },
    (_color, colorIndex) => ({ kind, material: brushMaterial(kind, colorIndex, options.colors) }),
  ));
  const baseNodes: MeshNode[] = [];
  const inkNodes: MeshNode[] = [];
  const worldInk = styles.map(emptyGeometry);
  let paintVertices = 0;
  let paintTriangles = 0;
  const pickSegments = Math.max(3, Math.ceil(Math.sqrt(options.pickTriangles / 2)));
  const pickRings = Math.max(2, Math.ceil(options.pickTriangles / (pickSegments * 2)));
  const miniatureGeometry = options.pickTriangles === 0
    ? miniGeometry
    : sphereGeometry(0.018, pickRings, pickSegments);
  for (let index = 0; index < options.pieces; index += 1) {
    const position = piecePosition(index, options.pieces);
    const mini = options.kind === 'minis'
      || (options.kind === 'mixed' && index % 2 === 1);
    baseNodes.push(mesh({
      geometry: mini ? miniatureGeometry : cardGeometry,
      material: options.presentation === 'svg-vt'
        ? paintedMaterial(index % options.textureVariants, options, mini)
        : mini ? miniMaterial : cardMaterial,
      transform: { position },
    }));
    if (options.presentation === 'svg-vt') continue;
    const pieceInk = styles.map(emptyGeometry);
    for (let strokeIndex = 0; strokeIndex < options.strokesPerPiece; strokeIndex += 1) {
      const samples = mini
        ? miniatureStroke(index, strokeIndex, options.pointsPerStroke)
        : cardStroke(index, strokeIndex, options.pointsPerStroke);
      const brushIndex = options.brush === 'mixed' ? strokeIndex % brushKinds.length : 0;
      const colorIndex = Math.floor(strokeIndex / brushKinds.length) % options.colors;
      const styleIndex = brushIndex * options.colors + colorIndex;
      const style = styles[styleIndex]!;
      const geometry = options.ownership === 'world'
        ? worldInk[styleIndex]!
        : pieceInk[styleIndex]!;
      const append = style.kind === 'stamp' ? appendStamps : appendRibbon;
      append(
        geometry,
        samples,
        options.ownership === 'world' ? position : [0, 0, 0],
        options.surfaceLift,
      );
      paintVertices += style.kind === 'stamp' ? samples.length * 4 : samples.length * 2;
      paintTriangles += style.kind === 'stamp' ? samples.length * 2 : (samples.length - 1) * 2;
    }
    if (options.ownership === 'piece') {
      for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
        const geometry = pieceInk[styleIndex]!;
        if (geometry.positions.length === 0) continue;
        inkNodes.push(mesh({
          geometry: finishGeometry(geometry),
          material: styles[styleIndex]!.material,
          transform: { position },
        }));
      }
    }
  }
  if (options.ownership === 'world') {
    for (let styleIndex = 0; styleIndex < styles.length; styleIndex += 1) {
      const geometry = worldInk[styleIndex]!;
      if (geometry.positions.length === 0) continue;
      inkNodes.push(mesh({
        geometry: finishGeometry(geometry),
        material: styles[styleIndex]!.material,
      }));
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
    material: brushMaterial('solid', 1, 4),
    transform: { position: piecePosition(0, pieceCount) },
  });
};

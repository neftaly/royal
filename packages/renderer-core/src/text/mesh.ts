import earcut from 'earcut';
import type { Font as OpenTypeFont, Glyph as OpenTypeGlyph } from 'opentype.js';
import { fontForFace, missingTextFontMessage } from './font';
import type { TextFontFace } from './font';
import {
  defaultOutlineFlattenTolerance,
  minimumTextUnit,
  textBounds,
  unionBounds,
  whitespaceGlyphs
} from './shared';
import type {
  TextBounds,
  TextGlyphLayout,
  TextLayout,
  TextMesh,
  TextMeshContour,
  TextMeshVertex,
  TextNode
} from './types';
import type { Vec3 } from '../primitives';

export type {
  TextMesh,
  TextMeshContour,
  TextMeshContourRole,
  TextMeshVertex
} from './types';

const glyphCoord = (glyphBounds: TextBounds, x: number, y: number): readonly [number, number] => {
  const width = Math.max(minimumTextUnit, glyphBounds.xMax - glyphBounds.xMin);
  const height = Math.max(minimumTextUnit, glyphBounds.yMax - glyphBounds.yMin);
  return [
    (x - glyphBounds.xMin) / width,
    (y - glyphBounds.yMin) / height
  ];
};

type OutlinePoint = {
  readonly x: number;
  readonly y: number;
};

type OutlineContour = {
  readonly area: number;
  readonly bounds: TextBounds;
  readonly points: readonly OutlinePoint[];
};

const transformFontPoint = (origin: Vec3, scale: number, x: number, y: number): OutlinePoint => ({
  x: origin[0] + x * scale,
  y: origin[1] + y * scale
});

const sameOutlinePoint = (left: OutlinePoint | undefined, right: OutlinePoint | undefined): boolean =>
  left !== undefined && right !== undefined && left.x === right.x && left.y === right.y;

const pushOutlinePoint = (points: OutlinePoint[], point: OutlinePoint): void => {
  if (!sameOutlinePoint(points.at(-1), point)) points.push(point);
};

const midpoint = (left: OutlinePoint, right: OutlinePoint): OutlinePoint => ({
  x: (left.x + right.x) / 2,
  y: (left.y + right.y) / 2
});

const pointLineDistance = (point: OutlinePoint, start: OutlinePoint, end: OutlinePoint): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / length;
};

const flattenQuadratic = (
  points: OutlinePoint[],
  start: OutlinePoint,
  control: OutlinePoint,
  end: OutlinePoint,
  tolerance: number
): void => {
  if (pointLineDistance(control, start, end) <= tolerance) {
    pushOutlinePoint(points, end);
    return;
  }

  const startControl = midpoint(start, control);
  const controlEnd = midpoint(control, end);
  const middle = midpoint(startControl, controlEnd);
  flattenQuadratic(points, start, startControl, middle, tolerance);
  flattenQuadratic(points, middle, controlEnd, end, tolerance);
};

const flattenCubic = (
  points: OutlinePoint[],
  start: OutlinePoint,
  controlA: OutlinePoint,
  controlB: OutlinePoint,
  end: OutlinePoint,
  tolerance: number
): void => {
  if (
    Math.max(
      pointLineDistance(controlA, start, end),
      pointLineDistance(controlB, start, end)
    ) <= tolerance
  ) {
    pushOutlinePoint(points, end);
    return;
  }

  const startA = midpoint(start, controlA);
  const ab = midpoint(controlA, controlB);
  const bEnd = midpoint(controlB, end);
  const leftControl = midpoint(startA, ab);
  const rightControl = midpoint(ab, bEnd);
  const middle = midpoint(leftControl, rightControl);
  flattenCubic(points, start, startA, leftControl, middle, tolerance);
  flattenCubic(points, middle, rightControl, bEnd, end, tolerance);
};

const signedOutlineArea = (points: readonly OutlinePoint[]): number => {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    const next = points[(index + 1) % points.length];
    if (point === undefined || next === undefined) continue;
    area += point.x * next.y - next.x * point.y;
  }
  return area / 2;
};

const outlineBounds = (points: readonly OutlinePoint[]): TextBounds =>
  unionBounds(points.map((point) => textBounds(point.x, point.y, point.x, point.y)));

const pushContour = (contours: OutlineContour[], points: OutlinePoint[]): void => {
  if (points.length > 1 && sameOutlinePoint(points[0], points.at(-1))) points.pop();
  if (points.length < 3) return;

  const area = signedOutlineArea(points);
  if (Math.abs(area) < minimumTextUnit * minimumTextUnit) return;
  contours.push({
    area,
    bounds: outlineBounds(points),
    points: [...points]
  });
};

const fontGlyphContours = (
  glyph: OpenTypeGlyph,
  origin: Vec3,
  scale: number,
  tolerance: number
): readonly OutlineContour[] => {
  const commands = glyph.path?.commands;
  if (commands === undefined || commands.length === 0) return [];

  const contours: OutlineContour[] = [];
  let points: OutlinePoint[] = [];
  let current: OutlinePoint | undefined;
  let start: OutlinePoint | undefined;

  const closeContour = (): void => {
    pushContour(contours, points);
    points = [];
    current = undefined;
    start = undefined;
  };

  for (const command of commands) {
    if (command.type === 'M') {
      closeContour();
      current = transformFontPoint(origin, scale, command.x, command.y);
      start = current;
      pushOutlinePoint(points, current);
      continue;
    }

    if (current === undefined) continue;

    if (command.type === 'L') {
      current = transformFontPoint(origin, scale, command.x, command.y);
      pushOutlinePoint(points, current);
      continue;
    }

    if (command.type === 'Q') {
      const end = transformFontPoint(origin, scale, command.x, command.y);
      flattenQuadratic(
        points,
        current,
        transformFontPoint(origin, scale, command.x1, command.y1),
        end,
        tolerance
      );
      current = end;
      continue;
    }

    if (command.type === 'C') {
      const end = transformFontPoint(origin, scale, command.x, command.y);
      flattenCubic(
        points,
        current,
        transformFontPoint(origin, scale, command.x1, command.y1),
        transformFontPoint(origin, scale, command.x2, command.y2),
        end,
        tolerance
      );
      current = end;
      continue;
    }

    if (command.type === 'Z') {
      if (start !== undefined) pushOutlinePoint(points, start);
      closeContour();
    }
  }

  closeContour();
  return contours;
};

const boundsContainPoint = (bounds: TextBounds, point: OutlinePoint): boolean =>
  point.x >= bounds.xMin &&
  point.x <= bounds.xMax &&
  point.y >= bounds.yMin &&
  point.y <= bounds.yMax;

const pointInPolygon = (point: OutlinePoint, polygon: readonly OutlinePoint[]): boolean => {
  let inside = false;

  for (let index = 0, previousIndex = polygon.length - 1; index < polygon.length; previousIndex = index, index += 1) {
    const current = polygon[index];
    const previous = polygon[previousIndex];
    if (current === undefined || previous === undefined) continue;

    const crossesY = current.y > point.y !== previous.y > point.y;
    if (!crossesY) continue;

    const x = ((previous.x - current.x) * (point.y - current.y)) / (previous.y - current.y) + current.x;
    if (point.x < x) inside = !inside;
  }

  return inside;
};

const contourParents = (contours: readonly OutlineContour[]): readonly (number | undefined)[] =>
  contours.map((contour, contourIndex) => {
    const probe = contour.points[0];
    if (probe === undefined) return undefined;

    let parent: number | undefined;
    let parentArea = Infinity;
    for (const [candidateIndex, candidate] of contours.entries()) {
      if (candidateIndex === contourIndex) continue;
      const candidateArea = Math.abs(candidate.area);
      if (candidateArea >= parentArea || candidateArea <= Math.abs(contour.area)) continue;
      if (!boundsContainPoint(candidate.bounds, probe) || !pointInPolygon(probe, candidate.points)) continue;
      parent = candidateIndex;
      parentArea = candidateArea;
    }
    return parent;
  });

const contourDepth = (
  parents: readonly (number | undefined)[],
  contourIndex: number,
  seen: ReadonlySet<number> = new Set()
): number => {
  const parent = parents[contourIndex];
  if (parent === undefined || seen.has(parent)) return 0;
  return 1 + contourDepth(parents, parent, new Set([...seen, contourIndex]));
};

const triangulateOutlineComponent = (
  vertices: TextMeshVertex[],
  indices: number[],
  contours: TextMeshContour[],
  glyphBounds: TextBounds,
  glyphIndex: number,
  z: number,
  outer: OutlineContour,
  holes: readonly OutlineContour[]
): void => {
  const points = [outer.points, ...holes.map((hole) => hole.points)];
  const data: number[] = [];
  const holeIndices: number[] = [];
  const flatPoints: OutlinePoint[] = [];

  for (const [contourIndex, contourPoints] of points.entries()) {
    if (contourIndex > 0) holeIndices.push(flatPoints.length);
    for (const point of contourPoints) {
      flatPoints.push(point);
      data.push(point.x, point.y);
    }
  }

  const triangles = earcut(data, holeIndices, 2);
  if (triangles.length === 0) return;

  const vertexOffset = vertices.length;
  for (const point of flatPoints) {
    vertices.push({
      glyphCoord: glyphCoord(glyphBounds, point.x, point.y),
      glyphIndex,
      position: [point.x, point.y, z]
    });
  }

  for (const index of triangles) indices.push(vertexOffset + index);
  contours.push({
    bounds: unionBounds([outer.bounds, ...holes.map((hole) => hole.bounds)]),
    glyphIndex,
    role: 'outline'
  });
};

const appendOutlineGlyph = (
  vertices: TextMeshVertex[],
  indices: number[],
  contours: TextMeshContour[],
  face: TextFontFace,
  font: OpenTypeFont,
  placement: TextGlyphLayout,
  glyphIndex: number,
  fontSize: number
): void => {
  const fontGlyphIndex = placement.glyph.fontGlyphIndex;
  if (fontGlyphIndex === undefined) return;

  const glyph = font.glyphs.get(fontGlyphIndex);
  if (glyph === undefined || whitespaceGlyphs.has(placement.glyph.text)) return;

  const scale = fontSize / face.unitsPerEm;
  const outlineContours = fontGlyphContours(
    glyph,
    placement.origin,
    scale,
    defaultOutlineFlattenTolerance * fontSize
  );
  const parents = contourParents(outlineContours);
  const depths = outlineContours.map((_contour, index) => contourDepth(parents, index));

  for (const [index, contour] of outlineContours.entries()) {
    if ((depths[index] ?? 0) % 2 !== 0) continue;
    const holes = outlineContours.filter((_candidate, candidateIndex) =>
      parents[candidateIndex] === index && (depths[candidateIndex] ?? 0) === (depths[index] ?? 0) + 1
    );
    triangulateOutlineComponent(
      vertices,
      indices,
      contours,
      placement.bounds,
      glyphIndex,
      placement.origin[2],
      contour,
      holes
    );
  }
};

const textMeshFromLayout = (layout: TextLayout): TextMesh => {
  const contours: TextMeshContour[] = [];
  const vertices: TextMeshVertex[] = [];
  const indices: number[] = [];
  let glyphIndex = 0;
  const face = layout.fontFace;
  if (face === undefined) throw new Error(missingTextFontMessage);
  const font = fontForFace(face);

  for (const line of layout.lines) {
    for (const placement of line.glyphs) {
      appendOutlineGlyph(vertices, indices, contours, face, font, placement, glyphIndex, layout.font.metrics.size);
      glyphIndex += 1;
    }
  }

  return {
    bounds: layout.bounds,
    contours,
    indices,
    vertices
  };
};

export const textMesh = (input: TextNode | TextLayout): TextMesh =>
  'kind' in input ? textMeshFromLayout(input.layout) : textMeshFromLayout(input);

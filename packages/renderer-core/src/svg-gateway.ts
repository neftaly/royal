import earcut from 'earcut';

export type SvgGatewayFillRule = 'evenodd' | 'nonzero';
export type SvgGatewayBoundaryMode = 'inside' | 'outside';
export type SvgGatewayContourRole = 'solid' | 'hole';

export type SvgGatewayPoint = {
  readonly x: number;
  readonly y: number;
};

export type SvgGatewayPointLike = SvgGatewayPoint | readonly [x: number, y: number];

export type SvgGatewayBounds = {
  readonly height: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly minX: number;
  readonly minY: number;
  readonly width: number;
};

export type SvgGatewayContour = {
  readonly closed: true;
  readonly id: string;
  readonly points: readonly SvgGatewayPoint[];
  readonly role: SvgGatewayContourRole;
};

export type SvgGatewayContourInput = {
  readonly id?: string;
  readonly points: readonly SvgGatewayPointLike[];
  readonly role?: SvgGatewayContourRole;
};

export type SvgGatewayPathInput = {
  readonly d: string;
  readonly fillRule?: SvgGatewayFillRule;
  readonly id?: string;
  readonly kind: 'path';
  readonly role?: SvgGatewayContourRole;
};

export type SvgGatewayPolygonInput = {
  readonly fillRule?: SvgGatewayFillRule;
  readonly id?: string;
  readonly kind: 'polygon';
  readonly points: readonly SvgGatewayPointLike[];
  readonly role?: SvgGatewayContourRole;
};

export type SvgGatewayRectInput = {
  readonly fillRule?: SvgGatewayFillRule;
  readonly height: number;
  readonly id?: string;
  readonly kind: 'rect';
  readonly role?: SvgGatewayContourRole;
  readonly rx?: number;
  readonly ry?: number;
  readonly width: number;
  readonly x?: number;
  readonly y?: number;
};

export type SvgGatewaySvgInput = {
  readonly fillRule?: SvgGatewayFillRule;
  readonly kind: 'svg';
  readonly svg: string;
};

export type SvgGatewayContoursInput = {
  readonly contours: readonly SvgGatewayContourInput[];
  readonly fillRule?: SvgGatewayFillRule;
  readonly kind: 'contours';
};

export type SvgGatewayInput =
  | string
  | SvgGatewayContoursInput
  | SvgGatewayPathInput
  | SvgGatewayPolygonInput
  | SvgGatewayRectInput
  | SvgGatewaySvgInput;

export type SvgGatewayOptions = {
  readonly boundaryMode?: SvgGatewayBoundaryMode;
  readonly epsilon?: number;
  readonly fillRule?: SvgGatewayFillRule;
  readonly flattenTolerance?: number;
  readonly id?: string;
};

export type SvgGatewayMeshContourRange = {
  readonly count: number;
  readonly id: string;
  readonly role: SvgGatewayContourRole;
  readonly start: number;
};

export type SvgGatewayMesh = {
  readonly bounds: SvgGatewayBounds;
  readonly contourRanges: readonly SvgGatewayMeshContourRange[];
  readonly indices: Uint32Array;
  readonly positions: Float32Array;
  readonly uvs: Float32Array;
};

export type SvgGatewayPickRegion = {
  readonly boundaryMode: SvgGatewayBoundaryMode;
  readonly bounds: SvgGatewayBounds;
  readonly contours: readonly SvgGatewayContour[];
  readonly epsilon: number;
  readonly fillRule: SvgGatewayFillRule;
  readonly kind: 'svg-gateway-pick-region';
  contains(point: SvgGatewayPointLike, options?: { readonly boundaryMode?: SvgGatewayBoundaryMode }): boolean;
};

export type SvgGatewayGeometry = {
  readonly bounds: SvgGatewayBounds;
  readonly contours: readonly SvgGatewayContour[];
  readonly diagnostics: readonly string[];
  readonly fillRule: SvgGatewayFillRule;
  readonly hitRegion: SvgGatewayPickRegion;
  readonly id: string;
  readonly kind: 'svg-gateway-geometry';
  readonly mesh: SvgGatewayMesh;
  readonly rasterization: {
    readonly boundary: 'browser-canvas';
    readonly note: string;
  };
};

export type SvgRasterTextureSource = {
  readonly cacheKey: string;
  readonly height: number;
  readonly id: string;
  readonly kind: 'svg-raster-texture';
  readonly width: number;
  renderToCanvas(): Promise<{ readonly canvas: HTMLCanvasElement | OffscreenCanvas; readonly height: number; readonly width: number }>;
  toImageData(): Promise<{
    readonly canvas: HTMLCanvasElement | OffscreenCanvas;
    readonly height: number;
    readonly imageData: ImageData;
    readonly width: number;
  }>;
};

type MutablePoint = { x: number; y: number };
type ExtractedContours = {
  readonly contours: readonly SvgGatewayContourInput[];
  readonly diagnostics: readonly string[];
  readonly fillRule?: SvgGatewayFillRule;
};
type TagAttributes = Readonly<Record<string, string>>;

const defaultBoundaryMode: SvgGatewayBoundaryMode = 'inside';
const defaultEpsilon = 1e-9;
const defaultFlattenTolerance = 0.5;
const kRasterBoundaryNote = 'SVG contents rasterize through browser canvas/ImageBitmap; picking uses flattened path geometry.';
const numberTokenPattern = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;
const pathTokenPattern = /[AaCcHhLlMmQqVvZz]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export const createSvgGatewayGeometry = (input: SvgGatewayInput, options: SvgGatewayOptions = {}): SvgGatewayGeometry => {
  const extracted = extractContours(input, options);
  const fillRule = options.fillRule ?? fillRuleFromInput(input) ?? extracted.fillRule ?? 'nonzero';
  const contours = normalizeContours(extracted.contours);
  const hitRegion = createSvgGatewayPickRegion({
    contours,
    fillRule,
    ...(options.boundaryMode === undefined ? {} : { boundaryMode: options.boundaryMode }),
    ...(options.epsilon === undefined ? {} : { epsilon: options.epsilon })
  });
  const mesh = triangulateSvgGatewayContours(contours);

  return Object.freeze({
    bounds: hitRegion.bounds,
    contours,
    diagnostics: extracted.diagnostics,
    fillRule,
    hitRegion,
    id: options.id ?? idFromInput(input) ?? 'svg-gateway-geometry',
    kind: 'svg-gateway-geometry',
    mesh,
    rasterization: {
      boundary: 'browser-canvas' as const,
      note: kRasterBoundaryNote
    }
  });
};

export const createSvgGatewayPickRegion = ({
  boundaryMode = defaultBoundaryMode,
  contours,
  epsilon = defaultEpsilon,
  fillRule = 'nonzero'
}: {
  readonly boundaryMode?: SvgGatewayBoundaryMode;
  readonly contours: readonly SvgGatewayContourInput[] | readonly SvgGatewayContour[];
  readonly epsilon?: number;
  readonly fillRule?: SvgGatewayFillRule;
}): SvgGatewayPickRegion => {
  const normalizedContours = normalizeContours(contours);
  const bounds = boundsFromContours(normalizedContours);
  const expandedBounds = expandBounds(bounds, epsilon);

  return Object.freeze({
    boundaryMode,
    bounds,
    contours: normalizedContours,
    epsilon,
    fillRule,
    kind: 'svg-gateway-pick-region',
    contains: (pointLike, pointOptions = {}) => {
      const point = normalizePoint(pointLike, 'point');
      const mode = pointOptions.boundaryMode ?? boundaryMode;
      if (!pointInBounds(point, expandedBounds)) return false;

      if (fillRule === 'evenodd') {
        return containsEvenOdd(point, normalizedContours, mode, epsilon);
      }

      return containsNonZero(point, normalizedContours, mode, epsilon);
    }
  });
};

export const triangulateSvgGatewayContours = (
  contours: readonly SvgGatewayContourInput[] | readonly SvgGatewayContour[]
): SvgGatewayMesh => {
  const normalizedContours = normalizeContours(contours);
  const bounds = boundsFromContours(normalizedContours);
  const contourRanges: SvgGatewayMeshContourRange[] = [];
  const points: SvgGatewayPoint[] = [];
  const indices: number[] = [];

  for (const group of groupContoursForTriangulation(normalizedContours)) {
    const localData: number[] = [];
    const localHoles: number[] = [];
    const vertexOffset = points.length;
    let localPointCount = 0;

    for (const [contourIndex, contour] of group.entries()) {
      if (contourIndex > 0) localHoles.push(localPointCount);
      for (const point of contour.points) {
        localData.push(point.x, point.y);
        localPointCount += 1;
      }
    }

    for (const index of earcut(localData, localHoles, 2)) {
      indices.push(index + vertexOffset);
    }

    for (const contour of group) {
      contourRanges.push({
        count: contour.points.length,
        id: contour.id,
        role: contour.role,
        start: points.length
      });
      points.push(...contour.points);
    }
  }

  const positions = new Float32Array(points.length * 2);
  const uvs = new Float32Array(points.length * 2);
  const width = bounds.width === 0 ? 1 : bounds.width;
  const height = bounds.height === 0 ? 1 : bounds.height;

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (point === undefined) throw new Error('Unexpected missing triangulation point.');
    positions[index * 2] = point.x;
    positions[index * 2 + 1] = point.y;
    uvs[index * 2] = (point.x - bounds.minX) / width;
    uvs[index * 2 + 1] = (point.y - bounds.minY) / height;
  }

  return Object.freeze({
    bounds,
    contourRanges,
    indices: Uint32Array.from(indices),
    positions,
    uvs
  });
};

export const svgPathToContours = (pathData: string, options: SvgGatewayOptions = {}): readonly SvgGatewayContour[] =>
  normalizeContours(parsePathContours(pathData, {
    flattenTolerance: options.flattenTolerance ?? defaultFlattenTolerance,
    id: options.id ?? 'path',
    role: 'solid'
  }));

export const roundedRectToContour = (
  input: SvgGatewayRectInput,
  options: { readonly flattenTolerance?: number } = {}
): SvgGatewayContour => normalizeContour(rectToContourInput(input, options.flattenTolerance ?? defaultFlattenTolerance), 0);

export const createSvgRasterTextureSource = ({
  height,
  id = 'svg-raster-texture',
  imageSmoothingEnabled = true,
  svg,
  width
}: {
  readonly height: number;
  readonly id?: string;
  readonly imageSmoothingEnabled?: boolean;
  readonly svg: Blob | SVGElement | string;
  readonly width: number;
}): SvgRasterTextureSource => {
  const cacheKey = `svg-raster-texture:${id}:${width}x${height}`;

  const renderToCanvas = async () => {
    const canvas = makeCanvas(width, height);
    const context = requireCanvas2d(canvas);
    const { blob } = serializeSvgSource(svg);
    const url = URL.createObjectURL(blob);

    try {
      const image = await loadImageFromUrl(url);
      context.clearRect(0, 0, width, height);
      context.imageSmoothingEnabled = imageSmoothingEnabled;
      context.drawImage(image, 0, 0, width, height);
    } finally {
      URL.revokeObjectURL(url);
    }

    return { canvas, height, width };
  };

  return Object.freeze({
    cacheKey,
    height,
    id,
    kind: 'svg-raster-texture',
    renderToCanvas,
    toImageData: async () => {
      const rendered = await renderToCanvas();
      const context = requireCanvas2d(rendered.canvas);
      return {
        ...rendered,
        imageData: context.getImageData(0, 0, width, height)
      };
    },
    width
  });
};

const extractContours = (input: SvgGatewayInput, options: SvgGatewayOptions): ExtractedContours => {
  if (typeof input === 'string') {
    return looksLikeSvg(input)
      ? extractContoursFromSvg(input, options)
      : {
        contours: parsePathContours(input, {
          flattenTolerance: options.flattenTolerance ?? defaultFlattenTolerance,
          id: options.id ?? 'path',
          role: 'solid'
        }),
        diagnostics: []
      };
  }

  switch (input.kind) {
    case 'contours':
      return withFillRule({ contours: input.contours, diagnostics: [] }, input.fillRule);
    case 'path':
      return withFillRule({
        contours: parsePathContours(input.d, {
          flattenTolerance: options.flattenTolerance ?? defaultFlattenTolerance,
          id: input.id ?? options.id ?? 'path',
          role: input.role ?? 'solid'
        }),
        diagnostics: []
      }, input.fillRule);
    case 'polygon': {
      const id = input.id ?? options.id;
      return withFillRule({
        contours: [{
          ...(id === undefined ? {} : { id }),
          points: input.points,
          role: input.role ?? 'solid'
        }],
        diagnostics: []
      }, input.fillRule);
    }
    case 'rect':
      return withFillRule({
        contours: [rectToContourInput(input, options.flattenTolerance ?? defaultFlattenTolerance)],
        diagnostics: []
      }, input.fillRule);
    case 'svg':
      return extractContoursFromSvg(input.svg, options);
  }
};

const withFillRule = (
  extracted: Omit<ExtractedContours, 'fillRule'>,
  fillRule: SvgGatewayFillRule | undefined
): ExtractedContours => fillRule === undefined ? extracted : { ...extracted, fillRule };

const extractContoursFromSvg = (svg: string, options: SvgGatewayOptions): ExtractedContours => {
  const contours: SvgGatewayContourInput[] = [];
  const diagnostics: string[] = [];
  let fillRule: SvgGatewayFillRule | undefined;
  const tagPattern = /<(path|polygon|polyline|rect)\b([^>]*)>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = tagPattern.exec(svg)) !== null) {
    const tagName = match[1]?.toLowerCase();
    const attributeText = match[2];
    if (tagName === undefined || attributeText === undefined) continue;

    const attributes = parseAttributes(attributeText);
    if (attributes.transform !== undefined) {
      diagnostics.push(`${tagName}${formatId(attributes)} has transform; SVG gateway uses untransformed geometry.`);
    }
    if (!isVisibleFill(attributes)) continue;

    const tagFillRule = parseFillRule(attributes['fill-rule']);
    fillRule ??= tagFillRule;
    const id = attributes.id ?? `${tagName}-${index}`;

    if (tagName === 'path') {
      const pathData = attributes.d;
      if (pathData === undefined) {
        diagnostics.push(`path${formatId(attributes)} skipped: missing d attribute.`);
      } else {
        contours.push(...parsePathContours(pathData, {
          flattenTolerance: options.flattenTolerance ?? defaultFlattenTolerance,
          id,
          role: roleFromAttributes(attributes)
        }));
      }
    } else if (tagName === 'polygon') {
      const points = parsePointList(attributes.points ?? '');
      if (points.length >= 3) {
        contours.push({ id, points, role: roleFromAttributes(attributes) });
      } else {
        diagnostics.push(`polygon${formatId(attributes)} skipped: expected at least three points.`);
      }
    } else if (tagName === 'rect') {
      const rect = rectInputFromAttributes(attributes, id, roleFromAttributes(attributes));
      if (rect === undefined) {
        diagnostics.push(`rect${formatId(attributes)} skipped: missing finite width or height.`);
      } else {
        contours.push(rectToContourInput(rect, options.flattenTolerance ?? defaultFlattenTolerance));
      }
    } else {
      diagnostics.push(`polyline${formatId(attributes)} skipped: open strokes are not SVG gateway fill geometry.`);
    }

    index += 1;
  }

  if (contours.length === 0) diagnostics.push('No filled path, polygon, or rect geometry found in SVG input.');
  return withFillRule({ contours, diagnostics }, fillRule);
};

const parsePathContours = (
  pathData: string,
  options: { readonly flattenTolerance: number; readonly id: string; readonly role: SvgGatewayContourRole }
): readonly SvgGatewayContourInput[] => {
  const tokens = pathData.match(pathTokenPattern) ?? [];
  const contours: SvgGatewayContourInput[] = [];
  let tokenIndex = 0;
  let command = '';
  let current: MutablePoint = { x: 0, y: 0 };
  let subpathStart: MutablePoint = { x: 0, y: 0 };
  let points: MutablePoint[] = [];
  let subpathIndex = 0;

  const finishContour = () => {
    if (points.length >= 3) {
      contours.push({
        id: subpathIndex === 0 ? options.id : `${options.id}-${subpathIndex}`,
        points: points.map((point) => ({ x: point.x, y: point.y })),
        role: options.role
      });
      subpathIndex += 1;
    }
    points = [];
  };

  const readNumber = (label: string): number => {
    const token = tokens[tokenIndex];
    if (token === undefined || isPathCommand(token)) {
      throw new Error(`Expected ${label} in SVG path data.`);
    }
    tokenIndex += 1;
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error(`Expected finite ${label} in SVG path data.`);
    return value;
  };

  const hasMoreNumbers = (): boolean => {
    const token = tokens[tokenIndex];
    return token !== undefined && !isPathCommand(token);
  };

  const pushLine = (point: MutablePoint) => {
    if (points.length === 0) points.push({ x: current.x, y: current.y });
    points.push(point);
    current = point;
  };

  const moveTo = (point: MutablePoint) => {
    finishContour();
    current = point;
    subpathStart = point;
    points = [point];
  };

  while (tokenIndex < tokens.length) {
    const token = tokens[tokenIndex];
    if (token === undefined) break;
    if (isPathCommand(token)) {
      command = token;
      tokenIndex += 1;
    } else if (command === '') {
      throw new Error('SVG path data must start with a command.');
    }

    const absoluteCommand = command.toUpperCase();
    const relative = command !== absoluteCommand;

    if (absoluteCommand === 'Z') {
      if (points.length > 0) current = { x: subpathStart.x, y: subpathStart.y };
      finishContour();
      command = '';
      continue;
    }

    if (absoluteCommand === 'M') {
      const firstPoint = absolutizePoint({
        x: readNumber('move x'),
        y: readNumber('move y')
      }, current, relative);
      moveTo(firstPoint);
      command = relative ? 'l' : 'L';

      while (hasMoreNumbers()) {
        pushLine(absolutizePoint({
          x: readNumber('line x'),
          y: readNumber('line y')
        }, current, relative));
      }
      continue;
    }

    if (absoluteCommand === 'L') {
      while (hasMoreNumbers()) {
        pushLine(absolutizePoint({
          x: readNumber('line x'),
          y: readNumber('line y')
        }, current, relative));
      }
      continue;
    }

    if (absoluteCommand === 'H') {
      while (hasMoreNumbers()) {
        const x = readNumber('horizontal line x');
        pushLine({ x: relative ? current.x + x : x, y: current.y });
      }
      continue;
    }

    if (absoluteCommand === 'V') {
      while (hasMoreNumbers()) {
        const y = readNumber('vertical line y');
        pushLine({ x: current.x, y: relative ? current.y + y : y });
      }
      continue;
    }

    if (absoluteCommand === 'Q') {
      while (hasMoreNumbers()) {
        const start = current;
        const control = absolutizePoint({
          x: readNumber('quadratic control x'),
          y: readNumber('quadratic control y')
        }, start, relative);
        const end = absolutizePoint({
          x: readNumber('quadratic end x'),
          y: readNumber('quadratic end y')
        }, start, relative);
        for (const point of flattenQuadratic(start, control, end, options.flattenTolerance)) pushLine(point);
      }
      continue;
    }

    if (absoluteCommand === 'C') {
      while (hasMoreNumbers()) {
        const start = current;
        const controlA = absolutizePoint({
          x: readNumber('cubic control x1'),
          y: readNumber('cubic control y1')
        }, start, relative);
        const controlB = absolutizePoint({
          x: readNumber('cubic control x2'),
          y: readNumber('cubic control y2')
        }, start, relative);
        const end = absolutizePoint({
          x: readNumber('cubic end x'),
          y: readNumber('cubic end y')
        }, start, relative);
        for (const point of flattenCubic(start, controlA, controlB, end, options.flattenTolerance)) pushLine(point);
      }
      continue;
    }

    if (absoluteCommand === 'A') {
      while (hasMoreNumbers()) {
        const start = current;
        const rx = readNumber('arc rx');
        const ry = readNumber('arc ry');
        const xAxisRotation = readNumber('arc rotation');
        const largeArcFlag = readNumber('arc large-arc flag') !== 0;
        const sweepFlag = readNumber('arc sweep flag') !== 0;
        const end = absolutizePoint({
          x: readNumber('arc end x'),
          y: readNumber('arc end y')
        }, start, relative);
        for (const point of flattenArc(start, end, rx, ry, xAxisRotation, largeArcFlag, sweepFlag, options.flattenTolerance)) {
          pushLine(point);
        }
      }
      continue;
    }

    throw new Error(`Unsupported SVG path command: ${command}`);
  }

  finishContour();
  return contours;
};

const normalizeContours = (
  contours: readonly SvgGatewayContourInput[] | readonly SvgGatewayContour[]
): readonly SvgGatewayContour[] => contours.map((contour, index) => normalizeContour(contour, index));

const normalizeContour = (contour: SvgGatewayContourInput | SvgGatewayContour, index: number): SvgGatewayContour => {
  if ((contour as { readonly closed?: unknown }).closed === false) {
    throw new Error('SVG gateway contours must be closed fill geometry.');
  }

  const normalizedPoints = contour.points.map((point, pointIndex) => normalizePoint(point, `contour ${contour.id ?? index} point ${pointIndex}`));
  const first = normalizedPoints[0];
  const last = normalizedPoints.at(-1);
  if (first === undefined || last === undefined) throw new Error(`Contour ${contour.id ?? index} must contain points.`);

  const points = samePoint(first, last) ? normalizedPoints.slice(0, -1) : normalizedPoints;
  if (points.length < 3) throw new Error(`Contour ${contour.id ?? index} must contain at least three unique points.`);

  return Object.freeze({
    closed: true,
    id: contour.id ?? `contour-${index}`,
    points: Object.freeze(points),
    role: contour.role ?? 'solid'
  });
};

const normalizePoint = (point: SvgGatewayPointLike, label: string): SvgGatewayPoint => {
  const x = isPointTuple(point) ? point[0] : point.x;
  const y = isPointTuple(point) ? point[1] : point.y;
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`${label} must contain finite x and y coordinates.`);
  return Object.freeze({ x, y });
};

const isPointTuple = (point: SvgGatewayPointLike): point is readonly [x: number, y: number] => Array.isArray(point);

const boundsFromContours = (contours: readonly SvgGatewayContour[]): SvgGatewayBounds => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const contour of contours) {
    for (const point of contour.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    throw new Error('Cannot compute bounds for empty SVG geometry.');
  }

  return Object.freeze({ height: maxY - minY, maxX, maxY, minX, minY, width: maxX - minX });
};

const expandBounds = (bounds: SvgGatewayBounds, epsilon: number): SvgGatewayBounds => ({
  height: bounds.height + epsilon * 2,
  maxX: bounds.maxX + epsilon,
  maxY: bounds.maxY + epsilon,
  minX: bounds.minX - epsilon,
  minY: bounds.minY - epsilon,
  width: bounds.width + epsilon * 2
});

const pointInBounds = (point: SvgGatewayPoint, bounds: SvgGatewayBounds): boolean =>
  point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;

const containsEvenOdd = (
  point: SvgGatewayPoint,
  contours: readonly SvgGatewayContour[],
  boundaryMode: SvgGatewayBoundaryMode,
  epsilon: number
): boolean => {
  let inside = false;

  for (const contour of contours) {
    const classification = classifyPointInContour(point, contour, epsilon);
    if (classification === 'boundary') return boundaryMode === 'inside';
    if (classification === 'inside') inside = !inside;
  }

  return inside;
};

const containsNonZero = (
  point: SvgGatewayPoint,
  contours: readonly SvgGatewayContour[],
  boundaryMode: SvgGatewayBoundaryMode,
  epsilon: number
): boolean => {
  let winding = 0;

  for (const contour of contours) {
    const contourWinding = windingNumberForContour(point, contour, epsilon);
    if (Number.isNaN(contourWinding)) return boundaryMode === 'inside';
    if (contourWinding === 0) continue;
    if (contour.role === 'hole') return false;
    winding += contourWinding;
  }

  return winding !== 0;
};

const classifyPointInContour = (
  point: SvgGatewayPoint,
  contour: SvgGatewayContour,
  epsilon: number
): 'boundary' | 'inside' | 'outside' => {
  let inside = false;

  for (let index = 0, previousIndex = contour.points.length - 1; index < contour.points.length; previousIndex = index, index += 1) {
    const start = contour.points[previousIndex];
    const end = contour.points[index];
    if (start === undefined || end === undefined) throw new Error('Unexpected missing contour point.');
    if (pointOnSegment(point, start, end, epsilon)) return 'boundary';

    const straddlesY = start.y > point.y !== end.y > point.y;
    if (straddlesY) {
      const intersectionX = ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
      if (point.x < intersectionX) inside = !inside;
    }
  }

  return inside ? 'inside' : 'outside';
};

const windingNumberForContour = (point: SvgGatewayPoint, contour: SvgGatewayContour, epsilon: number): number => {
  let winding = 0;

  for (let index = 0; index < contour.points.length; index += 1) {
    const start = contour.points[index];
    const end = contour.points[(index + 1) % contour.points.length];
    if (start === undefined || end === undefined) throw new Error('Unexpected missing contour point.');
    if (pointOnSegment(point, start, end, epsilon)) return Number.NaN;

    if (start.y <= point.y) {
      if (end.y > point.y && isLeft(start, end, point) > epsilon) winding += 1;
    } else if (end.y <= point.y && isLeft(start, end, point) < -epsilon) {
      winding -= 1;
    }
  }

  return winding;
};

const pointOnSegment = (point: SvgGatewayPoint, start: SvgGatewayPoint, end: SvgGatewayPoint, epsilon: number): boolean => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length <= epsilon) return Math.hypot(point.x - start.x, point.y - start.y) <= epsilon;

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  if (Math.abs(cross) > epsilon * Math.max(1, length)) return false;

  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return dot >= -epsilon && dot <= length * length + epsilon;
};

const isLeft = (start: SvgGatewayPoint, end: SvgGatewayPoint, point: SvgGatewayPoint): number =>
  (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y);

const groupContoursForTriangulation = (contours: readonly SvgGatewayContour[]): readonly (readonly SvgGatewayContour[])[] => {
  const solids = contours.filter((contour) => contour.role !== 'hole');
  const holes = contours.filter((contour) => contour.role === 'hole');
  const groups = (solids.length === 0 ? contours : solids).map((solid) => [solid] as SvgGatewayContour[]);

  for (const hole of holes) {
    const representative = hole.points[0];
    if (representative === undefined) continue;
    const parentIndex = solids.findIndex((solid) => classifyPointInContour(representative, solid, defaultEpsilon) !== 'outside');
    const group = groups[parentIndex >= 0 ? parentIndex : 0];
    group?.push(hole);
  }

  return groups;
};

const rectToContourInput = (input: SvgGatewayRectInput, flattenTolerance: number): SvgGatewayContourInput => {
  const x = input.x ?? 0;
  const y = input.y ?? 0;
  const width = input.width;
  const height = input.height;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('SVG rect geometry requires finite positive width and height.');
  }

  const rxInput = input.rx ?? input.ry ?? 0;
  const ryInput = input.ry ?? input.rx ?? 0;
  const rx = clamp(Math.abs(rxInput), 0, width / 2);
  const ry = clamp(Math.abs(ryInput), 0, height / 2);

  if (rx === 0 || ry === 0) {
    return {
      id: input.id ?? 'rect',
      points: [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height]
      ],
      role: input.role ?? 'solid'
    };
  }

  const points: MutablePoint[] = [
    { x: x + rx, y },
    { x: x + width - rx, y }
  ];
  appendArc(points, { x: x + width - rx, y: y + ry }, rx, ry, -Math.PI / 2, 0, flattenTolerance);
  points.push({ x: x + width, y: y + height - ry });
  appendArc(points, { x: x + width - rx, y: y + height - ry }, rx, ry, 0, Math.PI / 2, flattenTolerance);
  points.push({ x: x + rx, y: y + height });
  appendArc(points, { x: x + rx, y: y + height - ry }, rx, ry, Math.PI / 2, Math.PI, flattenTolerance);
  points.push({ x, y: y + ry });
  appendArc(points, { x: x + rx, y: y + ry }, rx, ry, Math.PI, Math.PI * 1.5, flattenTolerance);

  return {
    id: input.id ?? 'rounded-rect',
    points,
    role: input.role ?? 'solid'
  };
};

const appendArc = (
  points: MutablePoint[],
  center: SvgGatewayPoint,
  rx: number,
  ry: number,
  startAngle: number,
  endAngle: number,
  tolerance: number
) => {
  const delta = endAngle - startAngle;
  const segments = arcSegmentCount(Math.max(rx, ry), Math.abs(delta), tolerance);
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + delta * (index / segments);
    points.push({ x: center.x + Math.cos(angle) * rx, y: center.y + Math.sin(angle) * ry });
  }
};

const flattenQuadratic = (
  start: SvgGatewayPoint,
  control: SvgGatewayPoint,
  end: SvgGatewayPoint,
  tolerance: number
): readonly MutablePoint[] => {
  const segments = curveSegmentCount([start, control, end], tolerance);
  const points: MutablePoint[] = [];

  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const inverse = 1 - t;
    points.push({
      x: inverse * inverse * start.x + 2 * inverse * t * control.x + t * t * end.x,
      y: inverse * inverse * start.y + 2 * inverse * t * control.y + t * t * end.y
    });
  }

  return points;
};

const flattenCubic = (
  start: SvgGatewayPoint,
  controlA: SvgGatewayPoint,
  controlB: SvgGatewayPoint,
  end: SvgGatewayPoint,
  tolerance: number
): readonly MutablePoint[] => {
  const segments = curveSegmentCount([start, controlA, controlB, end], tolerance);
  const points: MutablePoint[] = [];

  for (let index = 1; index <= segments; index += 1) {
    const t = index / segments;
    const inverse = 1 - t;
    points.push({
      x: inverse ** 3 * start.x + 3 * inverse ** 2 * t * controlA.x + 3 * inverse * t ** 2 * controlB.x + t ** 3 * end.x,
      y: inverse ** 3 * start.y + 3 * inverse ** 2 * t * controlA.y + 3 * inverse * t ** 2 * controlB.y + t ** 3 * end.y
    });
  }

  return points;
};

const flattenArc = (
  start: SvgGatewayPoint,
  end: SvgGatewayPoint,
  rxInput: number,
  ryInput: number,
  xAxisRotationDegrees: number,
  largeArcFlag: boolean,
  sweepFlag: boolean,
  tolerance: number
): readonly MutablePoint[] => {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0 || samePoint(start, end)) return [{ x: end.x, y: end.y }];

  const phi = (xAxisRotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1Prime = cosPhi * dx + sinPhi * dy;
  const y1Prime = -sinPhi * dx + cosPhi * dy;
  const radiusScale = (x1Prime ** 2) / (rx ** 2) + (y1Prime ** 2) / (ry ** 2);

  if (radiusScale > 1) {
    const scale = Math.sqrt(radiusScale);
    rx *= scale;
    ry *= scale;
  }

  const rxSquared = rx ** 2;
  const rySquared = ry ** 2;
  const x1PrimeSquared = x1Prime ** 2;
  const y1PrimeSquared = y1Prime ** 2;
  const denominator = rxSquared * y1PrimeSquared + rySquared * x1PrimeSquared;
  const sign = largeArcFlag === sweepFlag ? -1 : 1;
  const coefficient = denominator === 0
    ? 0
    : sign * Math.sqrt(Math.max(0, (rxSquared * rySquared - rxSquared * y1PrimeSquared - rySquared * x1PrimeSquared) / denominator));
  const cxPrime = coefficient * ((rx * y1Prime) / ry);
  const cyPrime = coefficient * (-(ry * x1Prime) / rx);
  const center = {
    x: cosPhi * cxPrime - sinPhi * cyPrime + (start.x + end.x) / 2,
    y: sinPhi * cxPrime + cosPhi * cyPrime + (start.y + end.y) / 2
  };
  const vectorStart = { x: (x1Prime - cxPrime) / rx, y: (y1Prime - cyPrime) / ry };
  const vectorEnd = { x: (-x1Prime - cxPrime) / rx, y: (-y1Prime - cyPrime) / ry };
  const startAngle = vectorAngle({ x: 1, y: 0 }, vectorStart);
  let deltaAngle = vectorAngle(vectorStart, vectorEnd);

  if (!sweepFlag && deltaAngle > 0) deltaAngle -= Math.PI * 2;
  if (sweepFlag && deltaAngle < 0) deltaAngle += Math.PI * 2;

  const segments = arcSegmentCount(Math.max(rx, ry), Math.abs(deltaAngle), tolerance);
  const points: MutablePoint[] = [];
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + deltaAngle * (index / segments);
    const x = cosPhi * rx * Math.cos(angle) - sinPhi * ry * Math.sin(angle) + center.x;
    const y = sinPhi * rx * Math.cos(angle) + cosPhi * ry * Math.sin(angle) + center.y;
    points.push({ x, y });
  }

  return points;
};

const curveSegmentCount = (points: readonly SvgGatewayPoint[], tolerance: number): number => {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (previous === undefined || point === undefined) throw new Error('Unexpected missing curve point.');
    length += Math.hypot(point.x - previous.x, point.y - previous.y);
  }
  return clampInteger(Math.ceil(length / Math.max(1, tolerance * 8)), 4, 96);
};

const arcSegmentCount = (radius: number, angle: number, tolerance: number): number => {
  const safeTolerance = Math.max(0.05, tolerance);
  const step = 2 * Math.acos(clamp(1 - safeTolerance / Math.max(radius, safeTolerance), -1, 1));
  return clampInteger(Math.ceil(angle / Math.max(step, Math.PI / 24)), 1, 96);
};

const vectorAngle = (from: SvgGatewayPoint, to: SvgGatewayPoint): number => {
  const dot = from.x * to.x + from.y * to.y;
  const determinant = from.x * to.y - from.y * to.x;
  return Math.atan2(determinant, dot);
};

const absolutizePoint = (point: MutablePoint, origin: SvgGatewayPoint, relative: boolean): MutablePoint =>
  relative ? { x: origin.x + point.x, y: origin.y + point.y } : point;

const parsePointList = (points: string): readonly SvgGatewayPoint[] => {
  const values = (points.match(numberTokenPattern) ?? []).map(Number);
  const parsed: SvgGatewayPoint[] = [];

  for (let index = 0; index + 1 < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    parsed.push({ x, y });
  }

  return parsed;
};

const parseAttributes = (attributes: string): TagAttributes => {
  const entries: Record<string, string> = {};
  const attributePattern = /([:\w-]+)\s*=\s*("[^"]*"|'[^']*')/g;
  let match: RegExpExecArray | null;
  while ((match = attributePattern.exec(attributes)) !== null) {
    const key = match[1];
    const quoted = match[2];
    if (key === undefined || quoted === undefined) continue;
    entries[key] = decodeXmlAttribute(quoted.slice(1, -1));
  }
  return entries;
};

const decodeXmlAttribute = (value: string): string =>
  value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');

const rectInputFromAttributes = (
  attributes: TagAttributes,
  id: string,
  role: SvgGatewayContourRole
): SvgGatewayRectInput | undefined => {
  const width = optionalNumber(attributes.width);
  const height = optionalNumber(attributes.height);
  if (width === undefined || height === undefined) return undefined;
  const rx = optionalNumber(attributes.rx);
  const ry = optionalNumber(attributes.ry);

  return {
    height,
    id,
    kind: 'rect',
    role,
    ...(rx === undefined ? {} : { rx }),
    ...(ry === undefined ? {} : { ry }),
    width,
    x: optionalNumber(attributes.x) ?? 0,
    y: optionalNumber(attributes.y) ?? 0
  };
};

const isVisibleFill = (attributes: TagAttributes): boolean => {
  if (attributes.display === 'none' || attributes.visibility === 'hidden') return false;
  const styleFill = attributes.style?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim().toLowerCase();
  const fill = (attributes.fill ?? styleFill)?.trim().toLowerCase();
  return fill !== 'none';
};

const roleFromAttributes = (attributes: TagAttributes): SvgGatewayContourRole =>
  attributes['data-role'] === 'hole' || attributes.role === 'hole' ? 'hole' : 'solid';

const parseFillRule = (value: string | undefined): SvgGatewayFillRule | undefined =>
  value === 'evenodd' || value === 'nonzero' ? value : undefined;

const fillRuleFromInput = (input: SvgGatewayInput): SvgGatewayFillRule | undefined =>
  typeof input === 'string' ? undefined : input.fillRule;

const idFromInput = (input: SvgGatewayInput): string | undefined =>
  typeof input === 'string' || input.kind === 'contours' || input.kind === 'svg' ? undefined : input.id;

const formatId = (attributes: TagAttributes): string => attributes.id === undefined ? '' : `#${attributes.id}`;
const isPathCommand = (token: string): boolean => token.length === 1 && /[AaCcHhLlMmQqVvZz]/.test(token);
const looksLikeSvg = (value: string): boolean => /<\s*(svg|path|polygon|rect)\b/i.test(value);
const optionalNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const samePoint = (left: SvgGatewayPoint, right: SvgGatewayPoint): boolean => left.x === right.x && left.y === right.y;
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const clampInteger = (value: number, min: number, max: number): number => Math.trunc(clamp(value, min, max));

const makeCanvas = (width: number, height: number): HTMLCanvasElement | OffscreenCanvas => {
  const offscreenCanvas = globalThis.OffscreenCanvas;
  if (offscreenCanvas !== undefined) return new offscreenCanvas(width, height);
  if (globalThis.document === undefined) throw new Error('SVG raster texture source requires browser canvas APIs.');
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

const requireCanvas2d = (canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D => {
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Expected a 2D canvas context for SVG raster texture generation.');
  return context;
};

const serializeSvgSource = (svg: Blob | SVGElement | string): { readonly blob: Blob } => {
  if (svg instanceof Blob) return { blob: svg };
  const text = typeof svg === 'string' ? svg : new XMLSerializer().serializeToString(svg);
  return { blob: new Blob([text], { type: 'image/svg+xml;charset=utf-8' }) };
};

const loadImageFromUrl = async (url: string): Promise<CanvasImageSource> => {
  if (typeof createImageBitmap === 'function') {
    const response = await fetch(url);
    return createImageBitmap(await response.blob());
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load SVG image URL: ${url}`));
    image.src = url;
  });
};

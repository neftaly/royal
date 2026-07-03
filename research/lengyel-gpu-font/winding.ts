export type Vec2 = readonly [x: number, y: number];

export type QuadraticCurve = {
  readonly p1: Vec2;
  readonly p2: Vec2;
  readonly p3: Vec2;
};

export type TextBounds2D = {
  readonly xMax: number;
  readonly xMin: number;
  readonly yMax: number;
  readonly yMin: number;
};

export type WindingClass = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H";

export type BandAxis = "x" | "y";

export type BandCurveRef = {
  readonly curveIndex: number;
  readonly maxRayCoordinate: number;
  readonly minRayCoordinate: number;
};

export type GlyphBand = {
  readonly axis: BandAxis;
  readonly index: number;
  readonly negativeOrder: readonly BandCurveRef[];
  readonly positiveOrder: readonly BandCurveRef[];
  readonly range: readonly [min: number, max: number];
  readonly splitCoordinate: number;
};

export type GlyphBandTable = {
  readonly axis: BandAxis;
  readonly bandCount: number;
  readonly bands: readonly GlyphBand[];
  readonly bounds: TextBounds2D;
};

export type BuildBandTableOptions = {
  readonly bandCount: number;
  readonly padding?: number;
};

export const lengyelWindingLookupTable = 0x2e74;

const windingClasses: readonly WindingClass[] = ["A", "B", "C", "D", "E", "F", "G", "H"];

const component = (point: Vec2, axis: BandAxis): number => axis === "x" ? point[0] : point[1];

const oppositeAxis = (axis: BandAxis): BandAxis => axis === "x" ? "y" : "x";

const median = (values: readonly number[], fallback: number): number => {
  if (values.length === 0) return fallback;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted[middle];
  if (value === undefined) return fallback;
  if (sorted.length % 2 !== 0) return value;
  return ((sorted[middle - 1] ?? value) + value) / 2;
};

export const quadraticWindingClassIndex = (y1: number, y2: number, y3: number): number =>
  (y1 > 0 ? 1 : 0) + (y2 > 0 ? 2 : 0) + (y3 > 0 ? 4 : 0);

export const quadraticWindingClass = (y1: number, y2: number, y3: number): WindingClass =>
  windingClasses[quadraticWindingClassIndex(y1, y2, y3)] ?? "A";

export const quadraticWindingShiftCode = (y1: number, y2: number, y3: number): number =>
  quadraticWindingClassIndex(y1, y2, y3) * 2;

export const quadraticRootContributionCode = (y1: number, y2: number, y3: number): number =>
  (lengyelWindingLookupTable >> quadraticWindingShiftCode(y1, y2, y3)) & 0b11;

export const quadraticRootsForTranslatedRay = (
  y1: number,
  y2: number,
  y3: number,
): readonly [t1: number, t2: number] => {
  const a = y1 - 2 * y2 + y3;
  const b = y1 - y2;
  const c = y1;

  if (Math.abs(a) <= Number.EPSILON) {
    if (Math.abs(b) <= Number.EPSILON) return [Number.NaN, Number.NaN];
    const t = c / (2 * b);
    return [t, t];
  }

  const discriminant = Math.max(0, b * b - a * c);
  const root = Math.sqrt(discriminant);
  return [(b - root) / a, (b + root) / a];
};

export const evaluateQuadratic = (curve: QuadraticCurve, t: number): Vec2 => {
  const inverse = 1 - t;
  const a = inverse * inverse;
  const b = 2 * t * inverse;
  const c = t * t;
  return [
    a * curve.p1[0] + b * curve.p2[0] + c * curve.p3[0],
    a * curve.p1[1] + b * curve.p2[1] + c * curve.p3[1],
  ];
};

const translatedQuadraticComponent = (
  v1: number,
  v2: number,
  v3: number,
  t: number,
): number => {
  const inverse = 1 - t;
  return inverse * inverse * v1 + 2 * t * inverse * v2 + t * t * v3;
};

export const horizontalRayWindingContribution = (
  curve: QuadraticCurve,
  origin: Vec2,
): number => {
  const x1 = curve.p1[0] - origin[0];
  const x2 = curve.p2[0] - origin[0];
  const x3 = curve.p3[0] - origin[0];
  const y1 = curve.p1[1] - origin[1];
  const y2 = curve.p2[1] - origin[1];
  const y3 = curve.p3[1] - origin[1];
  const code = quadraticRootContributionCode(y1, y2, y3);
  const [t1, t2] = quadraticRootsForTranslatedRay(y1, y2, y3);
  let winding = 0;

  if ((code & 0b01) !== 0 && translatedQuadraticComponent(x1, x2, x3, t1) >= 0) {
    winding += 1;
  }
  if ((code & 0b10) !== 0 && translatedQuadraticComponent(x1, x2, x3, t2) >= 0) {
    winding -= 1;
  }

  return winding;
};

export const horizontalRayWinding = (
  curves: readonly QuadraticCurve[],
  origin: Vec2,
): number =>
  curves.reduce((sum, curve) => sum + horizontalRayWindingContribution(curve, origin), 0);

export const isInsideByHorizontalWinding = (
  curves: readonly QuadraticCurve[],
  origin: Vec2,
): boolean =>
  horizontalRayWinding(curves, origin) !== 0;

export const curveBounds = (curve: QuadraticCurve): TextBounds2D => ({
  xMax: Math.max(curve.p1[0], curve.p2[0], curve.p3[0]),
  xMin: Math.min(curve.p1[0], curve.p2[0], curve.p3[0]),
  yMax: Math.max(curve.p1[1], curve.p2[1], curve.p3[1]),
  yMin: Math.min(curve.p1[1], curve.p2[1], curve.p3[1]),
});

export const buildUniformBandTable = (
  curves: readonly QuadraticCurve[],
  bounds: TextBounds2D,
  axis: BandAxis,
  options: BuildBandTableOptions,
): GlyphBandTable => {
  const requestedBandCount = Number.isFinite(options.bandCount) ? Math.trunc(options.bandCount) : 1;
  const bandCount = Math.max(1, Math.min(16, requestedBandCount));
  const padding = Math.max(0, options.padding ?? 0);
  const min = axis === "x" ? bounds.xMin : bounds.yMin;
  const max = axis === "x" ? bounds.xMax : bounds.yMax;
  const fallbackWidth = 1;
  const width = Math.max(Number.EPSILON, (max - min) / bandCount || fallbackWidth);
  const rayAxis = oppositeAxis(axis);
  const rayMin = rayAxis === "x" ? bounds.xMin : bounds.yMin;
  const rayMax = rayAxis === "x" ? bounds.xMax : bounds.yMax;
  const rayFallback = (rayMin + rayMax) / 2;
  const curveExtents = curves.map((curve, curveIndex) => {
    const bandCoordinates = [
      component(curve.p1, axis),
      component(curve.p2, axis),
      component(curve.p3, axis),
    ];
    const rayCoordinates = [
      component(curve.p1, rayAxis),
      component(curve.p2, rayAxis),
      component(curve.p3, rayAxis),
    ];
    return {
      bandMax: Math.max(...bandCoordinates),
      bandMin: Math.min(...bandCoordinates),
      curveIndex,
      maxRayCoordinate: Math.max(...rayCoordinates),
      minRayCoordinate: Math.min(...rayCoordinates),
    };
  });

  const bands: GlyphBand[] = [];
  for (let index = 0; index < bandCount; index += 1) {
    const bandMin = min + width * index;
    const bandMax = index === bandCount - 1 ? max : bandMin + width;
    const refs = curveExtents.flatMap((extent): readonly BandCurveRef[] => {
      if (extent.bandMax + padding < bandMin || extent.bandMin - padding > bandMax) return [];
      return [{
        curveIndex: extent.curveIndex,
        maxRayCoordinate: extent.maxRayCoordinate,
        minRayCoordinate: extent.minRayCoordinate,
      }];
    });

    bands.push({
      axis,
      index,
      negativeOrder: [...refs].sort((left, right) =>
        left.minRayCoordinate - right.minRayCoordinate || left.curveIndex - right.curveIndex),
      positiveOrder: [...refs].sort((left, right) =>
        right.maxRayCoordinate - left.maxRayCoordinate || left.curveIndex - right.curveIndex),
      range: [bandMin, bandMax],
      splitCoordinate: median(
        refs.map((ref) => (ref.minRayCoordinate + ref.maxRayCoordinate) / 2),
        rayFallback,
      ),
    });
  }

  return {
    axis,
    bandCount,
    bands,
    bounds,
  };
};

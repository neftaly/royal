export type Vec3 = readonly [x: number, y: number, z: number];

export type ScreenBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export type Sphere = {
  readonly center: Vec3;
  readonly radius: number;
};

export type Viewport = {
  readonly width: number;
  readonly height: number;
};

export type PerspectiveProjection = {
  readonly kind: "perspective";
  readonly fovY: number;
  readonly aspect: number;
  readonly near: number;
};

export type OrthographicProjection = {
  readonly kind: "orthographic";
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly top: number;
  readonly near?: number;
  readonly far?: number;
};

export type Projection = PerspectiveProjection | OrthographicProjection;

export type BoundsOptions = {
  readonly clampToViewport?: boolean;
};

type Interval = readonly [min: number, max: number];

const finitePositive = (value: number): boolean => Number.isFinite(value) && value > 0;

const viewportBounds = ({ width, height }: Viewport): ScreenBounds => ({
  minX: 0,
  minY: 0,
  maxX: width,
  maxY: height,
});

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clampBounds = (bounds: ScreenBounds, viewport: Viewport): ScreenBounds => ({
  minX: clamp(bounds.minX, 0, viewport.width),
  minY: clamp(bounds.minY, 0, viewport.height),
  maxX: clamp(bounds.maxX, 0, viewport.width),
  maxY: clamp(bounds.maxY, 0, viewport.height),
});

const ndcToScreen = ([minX, maxX]: Interval, [minY, maxY]: Interval, viewport: Viewport): ScreenBounds => ({
  minX: (minX * 0.5 + 0.5) * viewport.width,
  maxX: (maxX * 0.5 + 0.5) * viewport.width,
  minY: (0.5 - maxY * 0.5) * viewport.height,
  maxY: (0.5 - minY * 0.5) * viewport.height,
});

const tangentRatioInterval = (offset: number, depth: number, radius: number): Interval | undefined => {
  const denominator = depth * depth - radius * radius;
  if (denominator <= 0) return undefined;

  const discriminant = depth * depth + offset * offset - radius * radius;
  if (discriminant < 0) return undefined;

  const span = radius * Math.sqrt(discriminant);
  const center = offset * depth;
  const a = (center - span) / denominator;
  const b = (center + span) / denominator;
  return a <= b ? [a, b] : [b, a];
};

const perspectiveSphereBounds = (
  sphere: Sphere,
  projection: PerspectiveProjection,
  viewport: Viewport,
): ScreenBounds | undefined => {
  const { center, radius } = sphere;
  const depth = -center[2];
  if (depth + radius <= projection.near) return undefined;

  if (depth - radius < projection.near) return viewportBounds(viewport);

  const xRatio = tangentRatioInterval(center[0], depth, radius);
  const yRatio = tangentRatioInterval(center[1], depth, radius);
  if (xRatio === undefined || yRatio === undefined) return viewportBounds(viewport);

  const fY = 1 / Math.tan(projection.fovY / 2);
  const fX = fY / projection.aspect;
  return ndcToScreen(
    [xRatio[0] * fX, xRatio[1] * fX],
    [yRatio[0] * fY, yRatio[1] * fY],
    viewport,
  );
};

const orthographicSphereBounds = (
  sphere: Sphere,
  projection: OrthographicProjection,
  viewport: Viewport,
): ScreenBounds | undefined => {
  const { center, radius } = sphere;
  const near = projection.near ?? Number.NEGATIVE_INFINITY;
  const far = projection.far ?? Number.POSITIVE_INFINITY;
  if (center[2] + radius < near || center[2] - radius > far) return undefined;

  const xMin = ((center[0] - radius - projection.left) / (projection.right - projection.left)) * 2 - 1;
  const xMax = ((center[0] + radius - projection.left) / (projection.right - projection.left)) * 2 - 1;
  const yMin = ((center[1] - radius - projection.bottom) / (projection.top - projection.bottom)) * 2 - 1;
  const yMax = ((center[1] + radius - projection.bottom) / (projection.top - projection.bottom)) * 2 - 1;
  return ndcToScreen([xMin, xMax], [yMin, yMax], viewport);
};

export const projectedSphereScreenBounds = (
  sphere: Sphere,
  projection: Projection,
  viewport: Viewport,
  options: BoundsOptions = {},
): ScreenBounds | undefined => {
  if (!finitePositive(sphere.radius)) return undefined;
  if (!finitePositive(viewport.width) || !finitePositive(viewport.height)) return undefined;

  const bounds = projection.kind === "perspective"
    ? perspectiveSphereBounds(sphere, projection, viewport)
    : orthographicSphereBounds(sphere, projection, viewport);

  if (bounds === undefined) return undefined;
  return options.clampToViewport === true ? clampBounds(bounds, viewport) : bounds;
};

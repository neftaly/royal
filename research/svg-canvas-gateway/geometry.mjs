const DEFAULT_EPSILON = 1e-9;

const asPoint = (point) => {
  if (Array.isArray(point)) {
    return { x: Number(point[0]), y: Number(point[1]) };
  }

  return { x: Number(point.x), y: Number(point.y) };
};

const normalizeContour = (contour, index) => {
  const rawPoints = contour.points ?? contour;
  const points = rawPoints.map(asPoint);

  if (points.length < 3) {
    throw new Error(`Contour ${contour.id ?? index} must contain at least 3 points.`);
  }

  const first = points[0];
  const last = points[points.length - 1];
  const closedPoints =
    first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;

  return {
    id: contour.id ?? `contour-${index}`,
    role: contour.role ?? 'solid',
    closed: contour.closed ?? true,
    points: closedPoints,
  };
};

const normalizeContours = (contours) => contours.map(normalizeContour);

const computeAabb = (contours) => {
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

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const expandAabb = (aabb, epsilon) => ({
  minX: aabb.minX - epsilon,
  minY: aabb.minY - epsilon,
  maxX: aabb.maxX + epsilon,
  maxY: aabb.maxY + epsilon,
});

const pointInAabb = (point, aabb) =>
  point.x >= aabb.minX &&
  point.x <= aabb.maxX &&
  point.y >= aabb.minY &&
  point.y <= aabb.maxY;

const signedArea = (points) => {
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
};

const pointOnSegment = (pointLike, startLike, endLike, epsilon = DEFAULT_EPSILON) => {
  const point = asPoint(pointLike);
  const start = asPoint(startLike);
  const end = asPoint(endLike);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const segmentLength = Math.hypot(dx, dy);

  if (segmentLength <= epsilon) {
    return Math.hypot(point.x - start.x, point.y - start.y) <= epsilon;
  }

  const cross = (point.x - start.x) * dy - (point.y - start.y) * dx;
  if (Math.abs(cross) > epsilon * Math.max(1, segmentLength)) {
    return false;
  }

  const dot = (point.x - start.x) * dx + (point.y - start.y) * dy;
  return dot >= -epsilon && dot <= segmentLength * segmentLength + epsilon;
};

const windingNumberForContour = (pointLike, contourLike, epsilon = DEFAULT_EPSILON) => {
  const point = asPoint(pointLike);
  const points = Array.isArray(contourLike) ? contourLike.map(asPoint) : contourLike.points;
  let winding = 0;

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];

    if (pointOnSegment(point, start, end, epsilon)) {
      return Number.NaN;
    }

    if (start.y <= point.y) {
      if (end.y > point.y && isLeft(start, end, point) > epsilon) {
        winding += 1;
      }
    } else if (end.y <= point.y && isLeft(start, end, point) < -epsilon) {
      winding -= 1;
    }
  }

  return winding;
};

const isLeft = (start, end, point) =>
  (end.x - start.x) * (point.y - start.y) - (point.x - start.x) * (end.y - start.y);

const classifyPointInContour = (
  pointLike,
  contourLike,
  { epsilon = DEFAULT_EPSILON, algorithm = 'evenodd' } = {},
) => {
  const point = asPoint(pointLike);
  const points = Array.isArray(contourLike) ? contourLike.map(asPoint) : contourLike.points;
  let inside = false;

  for (let index = 0, previousIndex = points.length - 1; index < points.length; previousIndex = index, index += 1) {
    const start = points[previousIndex];
    const end = points[index];

    if (pointOnSegment(point, start, end, epsilon)) {
      return 'boundary';
    }

    const straddlesY = start.y > point.y !== end.y > point.y;
    if (straddlesY) {
      const intersectionX =
        ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;

      if (point.x < intersectionX) {
        inside = !inside;
      }
    }
  }

  if (algorithm === 'nonzero') {
    return windingNumberForContour(point, points, epsilon) === 0 ? 'outside' : 'inside';
  }

  return inside ? 'inside' : 'outside';
};

const createPathHitRegion = ({
  contours,
  fillRule = 'nonzero',
  boundaryMode = 'inside',
  epsilon = DEFAULT_EPSILON,
  metadata = {},
}) => {
  const normalizedContours = normalizeContours(contours);
  const aabb = computeAabb(normalizedContours);
  const expandedAabb = expandAabb(aabb, epsilon);

  const contains = (pointLike, options = {}) => {
    const point = asPoint(pointLike);
    const mode = options.boundaryMode ?? boundaryMode;

    if (!pointInAabb(point, expandedAabb)) {
      return false;
    }

    let evenOddInside = false;
    let winding = 0;

    for (const contour of normalizedContours) {
      const classification = classifyPointInContour(point, contour, {
        epsilon,
        algorithm: fillRule,
      });

      if (classification === 'boundary') {
        return mode === 'inside';
      }

      if (classification === 'outside') {
        continue;
      }

      if (contour.role === 'hole') {
        return false;
      }

      if (fillRule === 'evenodd') {
        evenOddInside = !evenOddInside;
      } else {
        const contourWinding = windingNumberForContour(point, contour, epsilon);
        winding += Number.isNaN(contourWinding) ? 0 : contourWinding;
      }
    }

    return fillRule === 'evenodd' ? evenOddInside : winding !== 0;
  };

  return {
    kind: 'path-hit-region',
    fillRule,
    boundaryMode,
    epsilon,
    contours: normalizedContours,
    bounds: aabb,
    metadata,
    contains,
  };
};

const makeLocalPoint = (worldPoint, origin) => ({
  x: worldPoint.x - origin.x,
  y: worldPoint.y - origin.y,
});

const clampOriginToBounds = (origin, geometryBounds, worldBounds) => ({
  x: clamp(origin.x, worldBounds.minX - geometryBounds.minX, worldBounds.maxX - geometryBounds.maxX),
  y: clamp(origin.y, worldBounds.minY - geometryBounds.minY, worldBounds.maxY - geometryBounds.maxY),
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const createGeometryDragController = ({
  hitRegion,
  position = { x: 0, y: 0 },
  worldBounds,
} = {}) => {
  if (hitRegion === undefined) {
    throw new Error('createGeometryDragController requires a hitRegion.');
  }

  let origin = asPoint(position);
  let active = false;
  let grabOffset = { x: 0, y: 0 };

  const beginDrag = (worldPointLike) => {
    const worldPoint = asPoint(worldPointLike);
    const localPoint = makeLocalPoint(worldPoint, origin);

    if (!hitRegion.contains(localPoint)) {
      active = false;
      return {
        active,
        accepted: false,
        reason: 'outside-hit-region',
        localPoint,
        origin,
      };
    }

    active = true;
    grabOffset = localPoint;
    return {
      active,
      accepted: true,
      localPoint,
      origin,
    };
  };

  const moveDrag = (worldPointLike) => {
    if (!active) {
      return {
        active,
        moved: false,
        reason: 'drag-not-active',
        origin,
      };
    }

    const worldPoint = asPoint(worldPointLike);
    const proposedOrigin = {
      x: worldPoint.x - grabOffset.x,
      y: worldPoint.y - grabOffset.y,
    };
    origin =
      worldBounds === undefined
        ? proposedOrigin
        : clampOriginToBounds(proposedOrigin, hitRegion.bounds, worldBounds);

    return {
      active,
      moved: true,
      origin,
    };
  };

  const endDrag = () => {
    active = false;
    return { active, origin };
  };

  return {
    beginDrag,
    moveDrag,
    endDrag,
    get active() {
      return active;
    },
    get origin() {
      return origin;
    },
  };
};

const simulateDragSequence = ({
  hitRegion,
  startPointer,
  moves,
  position = { x: 0, y: 0 },
  worldBounds,
}) => {
  const controller = createGeometryDragController({ hitRegion, position, worldBounds });
  const start = controller.beginDrag(startPointer);
  const steps = [];

  for (const move of moves) {
    steps.push(controller.moveDrag(move));
  }

  const end = controller.endDrag();
  return { start, steps, end };
};

export {
  classifyPointInContour,
  computeAabb,
  createGeometryDragController,
  createPathHitRegion,
  pointInAabb,
  pointOnSegment,
  signedArea,
  simulateDragSequence,
  windingNumberForContour,
};

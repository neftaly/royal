const DEFAULT_EPSILON = 1e-9;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const isFiniteNumber = (value) => Number.isFinite(value);

const assertFinite = (value, label) => {
  if (!isFiniteNumber(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
};

const asPoint2 = (point) => {
  if (Array.isArray(point)) {
    return { x: Number(point[0]), y: Number(point[1]) };
  }

  return { x: Number(point.x), y: Number(point.y) };
};

const clonePoint = (point) => ({ x: point.x, y: point.y });

const add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });

const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

const scale2 = (point, scalar) => ({ x: point.x * scalar, y: point.y * scalar });

const dot2 = (a, b) => a.x * b.x + a.y * b.y;

const cross2 = (a, b) => a.x * b.y - a.y * b.x;

const crossAround = (a, b, c) => cross2(sub2(b, a), sub2(c, a));

const length2 = (vector) => Math.hypot(vector.x, vector.y);

const normalize2 = (vector, fallback = { x: 1, y: 0 }) => {
  const length = length2(vector);
  return length <= DEFAULT_EPSILON
    ? { ...fallback }
    : { x: vector.x / length, y: vector.y / length };
};

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const normalize3 = (vector, fallback = [0, 0, 1]) => {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  return length <= DEFAULT_EPSILON
    ? [...fallback]
    : [vector[0] / length, vector[1] / length, vector[2] / length];
};

export const signedArea = (pointsLike) => {
  const points = pointsLike.map(asPoint2);
  let area = 0;

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }

  return area / 2;
};

const stripClosingPoint = (points) => {
  if (points.length <= 1) {
    return points;
  }

  const first = points[0];
  const last = points.at(-1);
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
};

export const normalizeContour = (contourLike, index = 0) => {
  const rawPoints = Array.isArray(contourLike) ? contourLike : contourLike.points;
  if (!Array.isArray(rawPoints)) {
    throw new Error(`Contour ${index} must be an array or an object with points.`);
  }

  const points = stripClosingPoint(rawPoints.map(asPoint2));
  if (points.length < 3) {
    throw new Error(`Contour ${contourLike.id ?? index} must contain at least 3 points.`);
  }

  for (const [pointIndex, point] of points.entries()) {
    assertFinite(point.x, `Contour ${contourLike.id ?? index} point ${pointIndex}.x`);
    assertFinite(point.y, `Contour ${contourLike.id ?? index} point ${pointIndex}.y`);
  }

  const area = signedArea(points);
  if (Math.abs(area) <= DEFAULT_EPSILON) {
    throw new Error(`Contour ${contourLike.id ?? index} has zero area.`);
  }

  const role = Array.isArray(contourLike) ? 'solid' : (contourLike.role ?? 'solid');
  const ccwPoints = area < 0 ? points.toReversed() : points;

  return {
    id: Array.isArray(contourLike) ? `contour-${index}` : (contourLike.id ?? `contour-${index}`),
    role,
    closed: true,
    winding: 'ccw',
    originalSignedArea: area,
    area: Math.abs(area),
    points: ccwPoints.map(clonePoint),
  };
};

const normalizeContours = (contours) => {
  if (!Array.isArray(contours) || contours.length === 0) {
    throw new Error('At least one contour is required.');
  }

  return contours.map(normalizeContour);
};

export const roundedRectContour = ({
  id = 'rounded-rect',
  x = 0,
  y = 0,
  width,
  height,
  radius = 0,
  cornerRadius,
  cornerSegments = 8,
} = {}) => {
  assertFinite(width, 'width');
  assertFinite(height, 'height');
  assertFinite(x, 'x');
  assertFinite(y, 'y');

  if (width <= 0 || height <= 0) {
    throw new Error('width and height must be positive.');
  }

  const requestedRadius = Number(cornerRadius ?? radius);
  const resolvedRadius = clamp(requestedRadius, 0, Math.min(width, height) / 2);

  if (resolvedRadius <= DEFAULT_EPSILON) {
    return {
      id,
      role: 'solid',
      closed: true,
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
    };
  }

  const segments = Math.max(1, Math.floor(cornerSegments));
  const corners = [
    {
      cx: x + width - resolvedRadius,
      cy: y + resolvedRadius,
      start: -Math.PI / 2,
      end: 0,
    },
    {
      cx: x + width - resolvedRadius,
      cy: y + height - resolvedRadius,
      start: 0,
      end: Math.PI / 2,
    },
    {
      cx: x + resolvedRadius,
      cy: y + height - resolvedRadius,
      start: Math.PI / 2,
      end: Math.PI,
    },
    {
      cx: x + resolvedRadius,
      cy: y + resolvedRadius,
      start: Math.PI,
      end: Math.PI * 1.5,
    },
  ];
  const points = [];

  for (const corner of corners) {
    for (let step = 0; step <= segments; step += 1) {
      const t = step / segments;
      const angle = corner.start + (corner.end - corner.start) * t;
      points.push({
        x: corner.cx + Math.cos(angle) * resolvedRadius,
        y: corner.cy + Math.sin(angle) * resolvedRadius,
      });
    }
  }

  return {
    id,
    role: 'solid',
    closed: true,
    points,
    metadata: {
      kind: 'rounded-rect',
      x,
      y,
      width,
      height,
      radius: resolvedRadius,
      cornerSegments: segments,
    },
  };
};

const computeBounds2 = (contours) => {
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
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
    },
  };
};

const computeBounds3 = (vertices, bounds2) => {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (const vertex of vertices) {
    const [x, y, z] = vertex.position;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    bounds2,
  };
};

const perimeterOf = (points) => {
  let perimeter = 0;
  for (let index = 0; index < points.length; index += 1) {
    perimeter += length2(sub2(points[(index + 1) % points.length], points[index]));
  }
  return perimeter;
};

const perimeterProgress = (points) => {
  const cumulative = [0];
  let total = 0;

  for (let index = 0; index < points.length; index += 1) {
    total += length2(sub2(points[(index + 1) % points.length], points[index]));
    cumulative.push(total);
  }

  return { cumulative, total };
};

const pointInTriangle = (point, a, b, c, epsilon = DEFAULT_EPSILON) => {
  const areaA = crossAround(point, a, b);
  const areaB = crossAround(point, b, c);
  const areaC = crossAround(point, c, a);
  const hasNegative = areaA < -epsilon || areaB < -epsilon || areaC < -epsilon;
  const hasPositive = areaA > epsilon || areaB > epsilon || areaC > epsilon;
  return !(hasNegative && hasPositive);
};

const triangulateContour = (points, epsilon = DEFAULT_EPSILON) => {
  const vertices = points.map((_, index) => index);
  const triangles = [];
  let guard = points.length * points.length;

  while (vertices.length > 3) {
    let clipped = false;

    for (let cursor = 0; cursor < vertices.length; cursor += 1) {
      const previousIndex = vertices[(cursor - 1 + vertices.length) % vertices.length];
      const currentIndex = vertices[cursor];
      const nextIndex = vertices[(cursor + 1) % vertices.length];
      const previous = points[previousIndex];
      const current = points[currentIndex];
      const next = points[nextIndex];

      if (crossAround(previous, current, next) <= epsilon) {
        continue;
      }

      let containsPoint = false;
      for (const candidateIndex of vertices) {
        if (
          candidateIndex === previousIndex ||
          candidateIndex === currentIndex ||
          candidateIndex === nextIndex
        ) {
          continue;
        }

        if (pointInTriangle(points[candidateIndex], previous, current, next, epsilon)) {
          containsPoint = true;
          break;
        }
      }

      if (containsPoint) {
        continue;
      }

      triangles.push([previousIndex, currentIndex, nextIndex]);
      vertices.splice(cursor, 1);
      clipped = true;
      break;
    }

    guard -= 1;
    if (!clipped || guard <= 0) {
      throw new Error('Unable to triangulate contour; expected a simple non-self-intersecting polygon.');
    }
  }

  triangles.push([vertices[0], vertices[1], vertices[2]]);
  return triangles;
};

export const pointOnSegment = (
  pointLike,
  startLike,
  endLike,
  epsilon = DEFAULT_EPSILON,
) => {
  const point = asPoint2(pointLike);
  const start = asPoint2(startLike);
  const end = asPoint2(endLike);
  const segment = sub2(end, start);
  const pointDelta = sub2(point, start);
  const segmentLength = length2(segment);

  if (segmentLength <= epsilon) {
    return length2(pointDelta) <= epsilon;
  }

  const cross = Math.abs(cross2(pointDelta, segment));
  if (cross > epsilon * Math.max(1, segmentLength)) {
    return false;
  }

  const dot = dot2(pointDelta, segment);
  return dot >= -epsilon && dot <= segmentLength * segmentLength + epsilon;
};

const classifyPointInContour = (pointLike, pointsLike, epsilon = DEFAULT_EPSILON) => {
  const point = asPoint2(pointLike);
  const points = Array.isArray(pointsLike) ? pointsLike.map(asPoint2) : pointsLike.points;
  let inside = false;

  for (
    let index = 0, previousIndex = points.length - 1;
    index < points.length;
    previousIndex = index, index += 1
  ) {
    const start = points[previousIndex];
    const end = points[index];

    if (pointOnSegment(point, start, end, epsilon)) {
      return 'boundary';
    }

    const straddlesY = start.y > point.y !== end.y > point.y;
    if (!straddlesY) {
      continue;
    }

    const intersectionX =
      ((end.x - start.x) * (point.y - start.y)) / (end.y - start.y) + start.x;
    if (point.x < intersectionX) {
      inside = !inside;
    }
  }

  return inside ? 'inside' : 'outside';
};

export const createHitRegion = ({
  contours,
  boundaryMode = 'inside',
  epsilon = DEFAULT_EPSILON,
  metadata = {},
} = {}) => {
  const normalizedContours = normalizeContours(contours);
  const bounds = computeBounds2(normalizedContours);
  const contains = (pointLike, options = {}) => {
    const point = asPoint2(pointLike);
    const mode = options.boundaryMode ?? boundaryMode;

    if (
      point.x < bounds.minX - epsilon ||
      point.x > bounds.maxX + epsilon ||
      point.y < bounds.minY - epsilon ||
      point.y > bounds.maxY + epsilon
    ) {
      return false;
    }

    let inside = false;
    for (const contour of normalizedContours) {
      const classification = classifyPointInContour(point, contour.points, epsilon);
      if (classification === 'boundary') {
        return mode === 'inside';
      }
      if (classification === 'inside') {
        inside = contour.role === 'hole' ? false : true;
      }
    }

    return inside;
  };

  return {
    kind: 'contour-hit-region',
    boundaryMode,
    epsilon,
    contours: normalizedContours,
    bounds,
    metadata,
    contains,
  };
};

export const hitRegion = createHitRegion;

const edgeOutwardNormal = (start, end) => {
  const edge = sub2(end, start);
  return normalize2({ x: edge.y, y: -edge.x });
};

const edgeInwardNormal = (start, end) => {
  const edge = sub2(end, start);
  return normalize2({ x: -edge.y, y: edge.x });
};

const lineIntersection = (pointA, directionA, pointB, directionB) => {
  const denominator = cross2(directionA, directionB);
  if (Math.abs(denominator) <= DEFAULT_EPSILON) {
    return null;
  }

  const t = cross2(sub2(pointB, pointA), directionB) / denominator;
  return add2(pointA, scale2(directionA, t));
};

const offsetContourInward = (points, inset) => {
  if (inset <= DEFAULT_EPSILON) {
    return points.map(clonePoint);
  }

  const offsetPoints = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const previousDirection = normalize2(sub2(current, previous));
    const nextDirection = normalize2(sub2(next, current));
    const previousNormal = edgeInwardNormal(previous, current);
    const nextNormal = edgeInwardNormal(current, next);
    const previousPoint = add2(current, scale2(previousNormal, inset));
    const nextPoint = add2(current, scale2(nextNormal, inset));
    const intersection = lineIntersection(
      previousPoint,
      previousDirection,
      nextPoint,
      nextDirection,
    );

    if (intersection && isFiniteNumber(intersection.x) && isFiniteNumber(intersection.y)) {
      offsetPoints.push(intersection);
      continue;
    }

    offsetPoints.push(add2(current, scale2(normalize2(add2(previousNormal, nextNormal)), inset)));
  }

  return offsetPoints;
};

const faceUv = (point, bounds) => ({
  u: bounds.width <= DEFAULT_EPSILON ? 0 : (point.x - bounds.minX) / bounds.width,
  v: bounds.height <= DEFAULT_EPSILON ? 0 : 1 - (point.y - bounds.minY) / bounds.height,
});

const sideUv = (u, z, depth) => ({
  u,
  v: depth <= DEFAULT_EPSILON ? 0 : z / depth + 0.5,
});

export const shapeGeometry = ({
  contours,
  fillRule = 'nonzero',
  epsilon = DEFAULT_EPSILON,
} = {}) => {
  const normalizedContours = normalizeContours(contours);
  const vertices2d = [];
  const indices = [];
  const contourGeometry = [];
  const edgeLoops = [];

  for (const [contourIndex, contour] of normalizedContours.entries()) {
    if (contour.role === 'hole') {
      throw new Error('Prototype triangulation does not yet support holes.');
    }

    const pointOffset = vertices2d.length;
    for (const point of contour.points) {
      vertices2d.push(clonePoint(point));
    }

    const triangles = triangulateContour(contour.points, epsilon);
    for (const triangle of triangles) {
      indices.push(
        pointOffset + triangle[0],
        pointOffset + triangle[1],
        pointOffset + triangle[2],
      );
    }

    const loop = {
      id: `${contour.id}.outer`,
      contourId: contour.id,
      kind: 'outer-contour',
      pointOffset,
      pointCount: contour.points.length,
      pointIndices: contour.points.map((_, index) => pointOffset + index),
      perimeter: perimeterOf(contour.points),
    };
    edgeLoops.push(loop);
    contourGeometry.push({
      id: contour.id,
      contourIndex,
      pointOffset,
      pointCount: contour.points.length,
      triangles,
      edgeLoop: loop,
    });
  }

  const bounds = computeBounds2(normalizedContours);

  return {
    kind: 'shape-geometry-2d',
    fillRule,
    epsilon,
    contours: normalizedContours,
    contourGeometry,
    vertices2d,
    indices,
    triangleCount: indices.length / 3,
    edgeLoops,
    bounds,
    hitRegion: createHitRegion({ contours: normalizedContours, boundaryMode: 'inside', epsilon }),
    collisionShape: createCollisionShape({ contours: normalizedContours, epsilon }),
  };
};

const resolveShape = (input) => {
  if (input.shape) {
    return input.shape;
  }

  return shapeGeometry({ contours: input.contours, epsilon: input.epsilon });
};

const resolveBevel = (bevel, depth, bounds) => {
  if (!bevel) {
    return { enabled: false, size: 0, depth: 0 };
  }

  const requestedSize =
    typeof bevel === 'number' ? Number(bevel) : Number(bevel.size ?? bevel.amount ?? 0);
  const requestedDepth =
    typeof bevel === 'number' ? Number(bevel) : Number(bevel.depth ?? requestedSize);
  const maxSize = Math.max(0, Math.min(bounds.width, bounds.height) * 0.45);
  const maxDepth = Math.max(0, depth / 2 - DEFAULT_EPSILON);
  const size = clamp(requestedSize, 0, maxSize);
  const bevelDepth = clamp(requestedDepth, 0, maxDepth);

  return {
    enabled: size > DEFAULT_EPSILON && bevelDepth > DEFAULT_EPSILON,
    size,
    depth: bevelDepth,
  };
};

export const extrudeShape = ({
  shape,
  contours,
  depth = 1,
  bevel = 0,
  epsilon = DEFAULT_EPSILON,
} = {}) => {
  assertFinite(depth, 'depth');
  if (depth <= 0) {
    throw new Error('depth must be positive.');
  }

  const resolvedShape = resolveShape({ shape, contours, epsilon });
  const resolvedBevel = resolveBevel(bevel, depth, resolvedShape.bounds);
  const halfDepth = depth / 2;
  const vertices = [];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const edgeLoops = [];

  const addVertex = ({
    position,
    normal,
    uv,
    loop,
    contourId,
    sourceIndex,
  }) => {
    const normalizedNormal = normalize3(normal);
    const index = vertices.length;
    const vertex = {
      index,
      position,
      normal: normalizedNormal,
      uv,
      loop,
      contourId,
      sourceIndex,
    };
    vertices.push(vertex);
    positions.push(...position);
    normals.push(...normalizedNormal);
    uvs.push(uv.u, uv.v);
    return index;
  };

  const triangleNormal = (a, b, c) =>
    cross3(sub3(vertices[b].position, vertices[a].position), sub3(vertices[c].position, vertices[a].position));

  const addTriangleWound = (a, b, c, expectedNormal) => {
    const actualNormal = triangleNormal(a, b, c);
    if (dot3(actualNormal, expectedNormal) < 0) {
      indices.push(a, c, b);
    } else {
      indices.push(a, b, c);
    }
  };

  const addQuad = (quadVertices, expectedNormal) => {
    const ids = quadVertices.map(addVertex);
    addTriangleWound(ids[0], ids[1], ids[2], expectedNormal);
    addTriangleWound(ids[0], ids[2], ids[3], expectedNormal);
    return ids;
  };

  for (const contourInfo of resolvedShape.contourGeometry) {
    const contour = resolvedShape.contours[contourInfo.contourIndex];
    const outerPoints = contour.points;
    const contourBounds = computeBounds2([contour]);
    const { cumulative, total } = perimeterProgress(outerPoints);
    const pointCount = outerPoints.length;
    const facePoints = resolvedBevel.enabled
      ? offsetContourInward(outerPoints, resolvedBevel.size)
      : outerPoints;
    const faceTriangles = triangulateContour(facePoints, epsilon);

    const frontFaceLoop = facePoints.map((point, sourceIndex) =>
      addVertex({
        position: [point.x, point.y, halfDepth],
        normal: [0, 0, 1],
        uv: faceUv(point, contourBounds),
        loop: `${contour.id}.front-face`,
        contourId: contour.id,
        sourceIndex,
      }),
    );
    const backFaceLoop = facePoints.map((point, sourceIndex) =>
      addVertex({
        position: [point.x, point.y, -halfDepth],
        normal: [0, 0, -1],
        uv: faceUv(point, contourBounds),
        loop: `${contour.id}.back-face`,
        contourId: contour.id,
        sourceIndex,
      }),
    );

    for (const triangle of faceTriangles) {
      indices.push(
        frontFaceLoop[triangle[0]],
        frontFaceLoop[triangle[1]],
        frontFaceLoop[triangle[2]],
      );
      indices.push(
        backFaceLoop[triangle[2]],
        backFaceLoop[triangle[1]],
        backFaceLoop[triangle[0]],
      );
    }

    edgeLoops.push(
      {
        id: `${contour.id}.front-face`,
        contourId: contour.id,
        kind: 'front-face-boundary',
        z: halfDepth,
        points: facePoints.map(clonePoint),
        vertexIndices: frontFaceLoop,
      },
      {
        id: `${contour.id}.back-face`,
        contourId: contour.id,
        kind: 'back-face-boundary',
        z: -halfDepth,
        points: facePoints.map(clonePoint),
        vertexIndices: backFaceLoop,
      },
    );

    if (resolvedBevel.enabled) {
      const frontRimZ = halfDepth - resolvedBevel.depth;
      const backRimZ = -halfDepth + resolvedBevel.depth;
      edgeLoops.push(
        {
          id: `${contour.id}.front-rim`,
          contourId: contour.id,
          kind: 'outer-rim-before-front-bevel',
          z: frontRimZ,
          points: outerPoints.map(clonePoint),
        },
        {
          id: `${contour.id}.back-rim`,
          contourId: contour.id,
          kind: 'outer-rim-before-back-bevel',
          z: backRimZ,
          points: outerPoints.map(clonePoint),
        },
      );

      for (let index = 0; index < pointCount; index += 1) {
        const nextIndex = (index + 1) % pointCount;
        const outerStart = outerPoints[index];
        const outerEnd = outerPoints[nextIndex];
        const innerStart = facePoints[index];
        const innerEnd = facePoints[nextIndex];
        const outward = edgeOutwardNormal(outerStart, outerEnd);
        const u0 = total <= DEFAULT_EPSILON ? 0 : cumulative[index] / total;
        const u1 = total <= DEFAULT_EPSILON ? 1 : cumulative[index + 1] / total;
        const frontBevelNormal = normalize3([
          outward.x * resolvedBevel.depth,
          outward.y * resolvedBevel.depth,
          resolvedBevel.size,
        ]);
        const sideNormal = [outward.x, outward.y, 0];
        const backBevelNormal = normalize3([
          outward.x * resolvedBevel.depth,
          outward.y * resolvedBevel.depth,
          -resolvedBevel.size,
        ]);

        addQuad(
          [
            {
              position: [innerStart.x, innerStart.y, halfDepth],
              normal: frontBevelNormal,
              uv: faceUv(innerStart, contourBounds),
              loop: `${contour.id}.front-bevel`,
              contourId: contour.id,
              sourceIndex: index,
            },
            {
              position: [innerEnd.x, innerEnd.y, halfDepth],
              normal: frontBevelNormal,
              uv: faceUv(innerEnd, contourBounds),
              loop: `${contour.id}.front-bevel`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [outerEnd.x, outerEnd.y, frontRimZ],
              normal: frontBevelNormal,
              uv: faceUv(outerEnd, contourBounds),
              loop: `${contour.id}.front-bevel`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [outerStart.x, outerStart.y, frontRimZ],
              normal: frontBevelNormal,
              uv: faceUv(outerStart, contourBounds),
              loop: `${contour.id}.front-bevel`,
              contourId: contour.id,
              sourceIndex: index,
            },
          ],
          frontBevelNormal,
        );

        addQuad(
          [
            {
              position: [outerStart.x, outerStart.y, frontRimZ],
              normal: sideNormal,
              uv: sideUv(u0, frontRimZ, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: index,
            },
            {
              position: [outerEnd.x, outerEnd.y, frontRimZ],
              normal: sideNormal,
              uv: sideUv(u1, frontRimZ, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [outerEnd.x, outerEnd.y, backRimZ],
              normal: sideNormal,
              uv: sideUv(u1, backRimZ, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [outerStart.x, outerStart.y, backRimZ],
              normal: sideNormal,
              uv: sideUv(u0, backRimZ, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: index,
            },
          ],
          sideNormal,
        );

        addQuad(
          [
            {
              position: [outerStart.x, outerStart.y, backRimZ],
              normal: backBevelNormal,
              uv: faceUv(outerStart, contourBounds),
              loop: `${contour.id}.back-bevel`,
              contourId: contour.id,
              sourceIndex: index,
            },
            {
              position: [outerEnd.x, outerEnd.y, backRimZ],
              normal: backBevelNormal,
              uv: faceUv(outerEnd, contourBounds),
              loop: `${contour.id}.back-bevel`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [innerEnd.x, innerEnd.y, -halfDepth],
              normal: backBevelNormal,
              uv: faceUv(innerEnd, contourBounds),
              loop: `${contour.id}.back-bevel`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [innerStart.x, innerStart.y, -halfDepth],
              normal: backBevelNormal,
              uv: faceUv(innerStart, contourBounds),
              loop: `${contour.id}.back-bevel`,
              contourId: contour.id,
              sourceIndex: index,
            },
          ],
          backBevelNormal,
        );
      }
    } else {
      for (let index = 0; index < pointCount; index += 1) {
        const nextIndex = (index + 1) % pointCount;
        const start = outerPoints[index];
        const end = outerPoints[nextIndex];
        const outward = edgeOutwardNormal(start, end);
        const normal = [outward.x, outward.y, 0];
        const u0 = total <= DEFAULT_EPSILON ? 0 : cumulative[index] / total;
        const u1 = total <= DEFAULT_EPSILON ? 1 : cumulative[index + 1] / total;

        addQuad(
          [
            {
              position: [start.x, start.y, halfDepth],
              normal,
              uv: sideUv(u0, halfDepth, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: index,
            },
            {
              position: [end.x, end.y, halfDepth],
              normal,
              uv: sideUv(u1, halfDepth, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [end.x, end.y, -halfDepth],
              normal,
              uv: sideUv(u1, -halfDepth, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: nextIndex,
            },
            {
              position: [start.x, start.y, -halfDepth],
              normal,
              uv: sideUv(u0, -halfDepth, depth),
              loop: `${contour.id}.side-wall`,
              contourId: contour.id,
              sourceIndex: index,
            },
          ],
          normal,
        );
      }
    }
  }

  return {
    kind: 'extruded-shape-geometry',
    depth,
    bevel: resolvedBevel,
    source: resolvedShape,
    vertices,
    positions,
    normals,
    uvs,
    indices,
    triangleCount: indices.length / 3,
    edgeLoops,
    bounds: computeBounds3(vertices, resolvedShape.bounds),
    hitRegion: resolvedShape.hitRegion,
    collisionShape: resolvedShape.collisionShape,
  };
};

const transformPoint = (point, transform = {}) => {
  const scale = transform.scale ?? 1;
  const rotation = transform.rotation ?? 0;
  const translateX = transform.x ?? transform.translateX ?? 0;
  const translateY = transform.y ?? transform.translateY ?? 0;
  const scaledX = point.x * scale;
  const scaledY = point.y * scale;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: scaledX * cos - scaledY * sin + translateX,
    y: scaledX * sin + scaledY * cos + translateY,
  };
};

const contourAxes = (points) => {
  const axes = [];

  for (let index = 0; index < points.length; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const axis = edgeOutwardNormal(start, end);
    const duplicate = axes.some(
      (existing) => Math.abs(dot2(existing, axis)) > 1 - 1e-6,
    );
    if (!duplicate) {
      axes.push(axis);
    }
  }

  return axes;
};

const centerOfPoints = (points) => {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
};

export const createCollisionShape = ({
  contours,
  id = 'collision-shape',
  transform,
  epsilon = DEFAULT_EPSILON,
} = {}) => {
  const normalizedContours = normalizeContours(contours).map((contour) => ({
    ...contour,
    points: contour.points.map((point) => transformPoint(point, transform)),
  }));
  const solidContours = normalizedContours.filter((contour) => contour.role !== 'hole');
  if (solidContours.length !== 1) {
    throw new Error('Prototype collision expects exactly one solid convex contour.');
  }

  const contour = solidContours[0];
  const bounds = computeBounds2([contour]);

  return {
    kind: 'convex-contour-collision-shape',
    id,
    epsilon,
    contour,
    contours: normalizedContours,
    points: contour.points,
    axes: contourAxes(contour.points),
    bounds,
    center: centerOfPoints(contour.points),
    perimeter: perimeterOf(contour.points),
    containsPoint: (point, options = {}) => {
      const classification = classifyPointInContour(point, contour.points, epsilon);
      if (classification === 'boundary') {
        return options.boundaryMode !== 'outside';
      }
      return classification === 'inside';
    },
  };
};

export const transformCollisionShape = (shape, transform) =>
  createCollisionShape({
    id: shape.id,
    contours: shape.contours,
    transform,
    epsilon: shape.epsilon,
  });

const projectPoints = (points, axis) => {
  let min = Infinity;
  let max = -Infinity;

  for (const point of points) {
    const projection = dot2(point, axis);
    min = Math.min(min, projection);
    max = Math.max(max, projection);
  }

  return { min, max };
};

const closestPointOnSegment = (point, start, end) => {
  const segment = sub2(end, start);
  const lengthSquared = dot2(segment, segment);
  if (lengthSquared <= DEFAULT_EPSILON) {
    return { point: clonePoint(start), t: 0 };
  }

  const t = clamp(dot2(sub2(point, start), segment) / lengthSquared, 0, 1);
  return {
    point: add2(start, scale2(segment, t)),
    t,
  };
};

const segmentIntersectionPoint = (a, b, c, d, epsilon = DEFAULT_EPSILON) => {
  const ab = sub2(b, a);
  const cd = sub2(d, c);
  const denominator = cross2(ab, cd);
  const ca = sub2(c, a);

  if (Math.abs(denominator) <= epsilon) {
    if (pointOnSegment(a, c, d, epsilon)) {
      return clonePoint(a);
    }
    if (pointOnSegment(b, c, d, epsilon)) {
      return clonePoint(b);
    }
    if (pointOnSegment(c, a, b, epsilon)) {
      return clonePoint(c);
    }
    if (pointOnSegment(d, a, b, epsilon)) {
      return clonePoint(d);
    }
    return null;
  }

  const t = cross2(ca, cd) / denominator;
  const u = cross2(ca, ab) / denominator;
  if (t < -epsilon || t > 1 + epsilon || u < -epsilon || u > 1 + epsilon) {
    return null;
  }

  return add2(a, scale2(ab, t));
};

const closestSegmentPair = (aStart, aEnd, bStart, bEnd, epsilon = DEFAULT_EPSILON) => {
  const intersection = segmentIntersectionPoint(aStart, aEnd, bStart, bEnd, epsilon);
  if (intersection) {
    return {
      distance: 0,
      pointA: intersection,
      pointB: intersection,
    };
  }

  const candidates = [];
  const bFromAStart = closestPointOnSegment(aStart, bStart, bEnd);
  candidates.push({
    pointA: clonePoint(aStart),
    pointB: bFromAStart.point,
  });
  const bFromAEnd = closestPointOnSegment(aEnd, bStart, bEnd);
  candidates.push({
    pointA: clonePoint(aEnd),
    pointB: bFromAEnd.point,
  });
  const aFromBStart = closestPointOnSegment(bStart, aStart, aEnd);
  candidates.push({
    pointA: aFromBStart.point,
    pointB: clonePoint(bStart),
  });
  const aFromBEnd = closestPointOnSegment(bEnd, aStart, aEnd);
  candidates.push({
    pointA: aFromBEnd.point,
    pointB: clonePoint(bEnd),
  });

  let best = null;
  for (const candidate of candidates) {
    const distance = length2(sub2(candidate.pointB, candidate.pointA));
    if (!best || distance < best.distance) {
      best = { ...candidate, distance };
    }
  }

  return best;
};

const closestContourPair = (pointsA, pointsB, epsilon = DEFAULT_EPSILON) => {
  let best = null;

  for (let indexA = 0; indexA < pointsA.length; indexA += 1) {
    const aStart = pointsA[indexA];
    const aEnd = pointsA[(indexA + 1) % pointsA.length];
    for (let indexB = 0; indexB < pointsB.length; indexB += 1) {
      const bStart = pointsB[indexB];
      const bEnd = pointsB[(indexB + 1) % pointsB.length];
      const candidate = closestSegmentPair(aStart, aEnd, bStart, bEnd, epsilon);
      if (!best || candidate.distance < best.distance) {
        best = { ...candidate, edgeA: indexA, edgeB: indexB };
      }
    }
  }

  return best;
};

const averagePoints = (points) => {
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
};

const resolveCollisionShape = (shapeLike) => {
  if (shapeLike.kind === 'convex-contour-collision-shape') {
    return shapeLike;
  }

  return createCollisionShape(shapeLike);
};

export const closestContact = (shapeALike, shapeBLike, { epsilon = DEFAULT_EPSILON } = {}) => {
  const shapeA = resolveCollisionShape(shapeALike);
  const shapeB = resolveCollisionShape(shapeBLike);
  let minOverlap = Infinity;
  let minAxis = null;
  let separated = false;

  for (const rawAxis of [...shapeA.axes, ...shapeB.axes]) {
    const axis = normalize2(rawAxis);
    const projectionA = projectPoints(shapeA.points, axis);
    const projectionB = projectPoints(shapeB.points, axis);
    const overlap =
      Math.min(projectionA.max, projectionB.max) - Math.max(projectionA.min, projectionB.min);

    if (overlap < -epsilon) {
      separated = true;
      break;
    }

    if (overlap < minOverlap) {
      minOverlap = overlap;
      minAxis = axis;
    }
  }

  const closest = closestContourPair(shapeA.points, shapeB.points, epsilon);
  const centerDelta = sub2(shapeB.center, shapeA.center);
  const normalFromClosest = normalize2(sub2(closest.pointB, closest.pointA), minAxis ?? { x: 1, y: 0 });
  const orientedAxis =
    minAxis && dot2(minAxis, centerDelta) < 0 ? scale2(minAxis, -1) : (minAxis ?? normalFromClosest);

  if (separated) {
    return {
      kind: 'contour-contact',
      state: closest.distance <= epsilon ? 'touching' : 'separated',
      method: 'convex-sat-plus-segment-witness',
      usesTextureBounds: false,
      distance: closest.distance,
      penetrationDepth: 0,
      normal: closest.distance <= epsilon ? orientedAxis : normalFromClosest,
      pointA: closest.pointA,
      pointB: closest.pointB,
      witness: closest,
    };
  }

  const overlapPoints = [];
  for (const point of shapeA.points) {
    if (shapeB.containsPoint(point)) {
      overlapPoints.push(point);
    }
  }
  for (const point of shapeB.points) {
    if (shapeA.containsPoint(point)) {
      overlapPoints.push(point);
    }
  }

  const contactPoint =
    overlapPoints.length > 0 ? averagePoints(overlapPoints) : averagePoints([closest.pointA, closest.pointB]);
  const touching = minOverlap <= epsilon;

  return {
    kind: 'contour-contact',
    state: touching ? 'touching' : 'overlapping',
    method: 'convex-sat-plus-segment-witness',
    usesTextureBounds: false,
    distance: touching ? 0 : -minOverlap,
    penetrationDepth: touching ? 0 : minOverlap,
    normal: orientedAxis,
    pointA: touching ? closest.pointA : contactPoint,
    pointB: touching ? closest.pointB : contactPoint,
    witness: closest,
  };
};

export const signedDistanceToContour = (
  pointLike,
  shapeLike,
  { epsilon = DEFAULT_EPSILON } = {},
) => {
  const point = asPoint2(pointLike);
  const shape = resolveCollisionShape(shapeLike);
  let minDistance = Infinity;

  for (let index = 0; index < shape.points.length; index += 1) {
    const start = shape.points[index];
    const end = shape.points[(index + 1) % shape.points.length];
    const closest = closestPointOnSegment(point, start, end);
    minDistance = Math.min(minDistance, length2(sub2(point, closest.point)));
  }

  const classification = classifyPointInContour(point, shape.points, epsilon);
  if (classification === 'boundary') {
    return 0;
  }

  return classification === 'inside' ? -minDistance : minDistance;
};

export const textureMaterial = ({
  id = 'shape-texture',
  source = 'canvas-rasterized-svg',
  width,
  height,
  uvSet = 'face-bounds',
  premultipliedAlpha = true,
  metadata = {},
} = {}) => ({
  kind: 'texture-material-sketch',
  id,
  source,
  width,
  height,
  uvSet,
  premultipliedAlpha,
  geometryCoupling: 'uv-sampling-only',
  collisionCoupling: 'none',
  note:
    'Rasterized SVG/canvas/card art is sampled by material UVs; contour geometry owns extrusion, picking, and collision.',
  metadata,
});

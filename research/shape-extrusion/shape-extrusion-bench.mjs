#!/usr/bin/env node

import { performance } from 'node:perf_hooks';

import {
  closestContact,
  createCollisionShape,
  extrudeShape,
  roundedRectContour,
  shapeGeometry,
  signedDistanceToContour,
} from './geometry.mjs';

const DEFAULT_ITERATIONS = 120;
const CARD_WIDTH = 320;
const CARD_HEIGHT = 448;
const CARD_RADIUS = 36;
const SEGMENT_COUNTS = [1, 2, 4, 8, 16, 32];
const DEPTHS = [2, 8, 24, 48];
const BEVELS = [
  { label: 'square', value: 0 },
  { label: 'chamfer', value: { size: 2, depth: 1.5 } },
];

const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const triangleArea3 = (a, b, c) => {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  return Math.hypot(cross[0], cross[1], cross[2]) / 2;
};

const positionAt = (mesh, index) => [
  mesh.positions[index * 3],
  mesh.positions[index * 3 + 1],
  mesh.positions[index * 3 + 2],
];

const expectedTriangleCount = (pointCount, bevelEnabled) =>
  bevelEnabled ? 8 * pointCount - 4 : 4 * pointCount - 4;

const validateMesh = (mesh, label) => {
  const vertexCount = mesh.vertices.length;
  const sourcePointCount = mesh.source.contours[0].points.length;
  const expectedTriangles = expectedTriangleCount(sourcePointCount, mesh.bevel.enabled);
  let minArea = Infinity;

  assert(mesh.indices.length % 3 === 0, `${label}: index length must be divisible by 3`);
  assert(mesh.positions.length === vertexCount * 3, `${label}: position count mismatch`);
  assert(mesh.normals.length === vertexCount * 3, `${label}: normal count mismatch`);
  assert(mesh.uvs.length === vertexCount * 2, `${label}: uv count mismatch`);
  assert(mesh.triangleCount === expectedTriangles, `${label}: unexpected triangle count`);
  assert(mesh.edgeLoops.length >= 2, `${label}: expected named edge loops`);
  assert(
    Math.abs(mesh.bounds.size[2] - mesh.depth) < 1e-9,
    `${label}: 3D bounds should preserve extrusion depth`,
  );

  for (const index of mesh.indices) {
    assert(Number.isInteger(index), `${label}: index must be integer`);
    assert(index >= 0 && index < vertexCount, `${label}: index out of range`);
  }

  for (let index = 0; index < mesh.indices.length; index += 3) {
    const a = positionAt(mesh, mesh.indices[index]);
    const b = positionAt(mesh, mesh.indices[index + 1]);
    const c = positionAt(mesh, mesh.indices[index + 2]);
    const area = triangleArea3(a, b, c);
    minArea = Math.min(minArea, area);
    assert(area > 1e-9, `${label}: degenerate triangle at ${index / 3}`);
  }

  for (let index = 0; index < mesh.normals.length; index += 3) {
    const length = Math.hypot(
      mesh.normals[index],
      mesh.normals[index + 1],
      mesh.normals[index + 2],
    );
    assert(length > 0.999 && length < 1.001, `${label}: normal ${index / 3} is not unit length`);
  }

  for (const value of [...mesh.positions, ...mesh.normals, ...mesh.uvs]) {
    assert(Number.isFinite(value), `${label}: geometry arrays must be finite`);
  }

  return {
    label,
    sourcePointCount,
    vertices: vertexCount,
    triangles: mesh.triangleCount,
    indices: mesh.indices.length,
    edgeLoops: mesh.edgeLoops.length,
    minTriangleArea: minArea,
  };
};

const makeCardContour = (cornerSegments, id = 'card') =>
  roundedRectContour({
    id,
    x: 0,
    y: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    radius: CARD_RADIUS,
    cornerSegments,
  });

const runMeshValidation = () => {
  const cases = [];

  for (const cornerSegments of SEGMENT_COUNTS) {
    for (const depth of DEPTHS) {
      for (const bevel of BEVELS) {
        const contour = makeCardContour(cornerSegments, `card-s${cornerSegments}`);
        const shape = shapeGeometry({ contours: [contour] });
        const mesh = extrudeShape({
          shape,
          depth,
          bevel: bevel.value,
        });
        cases.push(validateMesh(mesh, `segments=${cornerSegments} depth=${depth} ${bevel.label}`));
      }
    }
  }

  return {
    caseCount: cases.length,
    minVertices: Math.min(...cases.map((entry) => entry.vertices)),
    maxVertices: Math.max(...cases.map((entry) => entry.vertices)),
    minTriangles: Math.min(...cases.map((entry) => entry.triangles)),
    maxTriangles: Math.max(...cases.map((entry) => entry.triangles)),
    minTriangleArea: round(Math.min(...cases.map((entry) => entry.minTriangleArea)), 9),
    cases,
  };
};

const maxBy = (items, score) => items.reduce((best, item) => (score(item) > score(best) ? item : best));

const minBy = (items, score) => items.reduce((best, item) => (score(item) < score(best) ? item : best));

const contactSummary = (label, contact) => ({
  label,
  state: contact.state,
  distance: round(contact.distance, 6),
  penetrationDepth: round(contact.penetrationDepth, 6),
  normal: {
    x: round(contact.normal.x, 6),
    y: round(contact.normal.y, 6),
  },
  pointA: {
    x: round(contact.pointA.x, 6),
    y: round(contact.pointA.y, 6),
  },
  pointB: {
    x: round(contact.pointB.x, 6),
    y: round(contact.pointB.y, 6),
  },
  usesTextureBounds: contact.usesTextureBounds,
});

const runContactChecks = () => {
  const contour = roundedRectContour({
    id: 'contact-card',
    x: 0,
    y: 0,
    width: 160,
    height: 224,
    radius: 28,
    cornerSegments: 16,
  });
  const shapeA = createCollisionShape({ id: 'card-a', contours: [contour] });
  const topRightCornerPoint = maxBy(contour.points, (point) => point.x + point.y);
  const bottomLeftCornerPoint = minBy(contour.points, (point) => point.x + point.y);
  const cornerTouchOffset = {
    x: topRightCornerPoint.x - bottomLeftCornerPoint.x,
    y: topRightCornerPoint.y - bottomLeftCornerPoint.y,
  };
  const bottomLeftOuterPoint = minBy(contour.points, (point) => point.x * 1000 + point.y);
  const edgeCornerTouchOffset = {
    x: 160 - bottomLeftOuterPoint.x,
    y: 112 - bottomLeftOuterPoint.y,
  };
  const makeShapeB = (offset) =>
    createCollisionShape({
      id: 'card-b',
      contours: [contour],
      transform: offset,
    });
  const cases = [
    {
      label: 'corner-corner touch',
      expectedState: 'touching',
      contact: closestContact(shapeA, makeShapeB(cornerTouchOffset)),
    },
    {
      label: 'corner-corner overlap',
      expectedState: 'overlapping',
      contact: closestContact(
        shapeA,
        makeShapeB({ x: cornerTouchOffset.x - 2, y: cornerTouchOffset.y - 2 }),
      ),
    },
    {
      label: 'corner-corner separation',
      expectedState: 'separated',
      contact: closestContact(
        shapeA,
        makeShapeB({ x: cornerTouchOffset.x + 4, y: cornerTouchOffset.y + 4 }),
      ),
    },
    {
      label: 'edge-corner touch',
      expectedState: 'touching',
      contact: closestContact(shapeA, makeShapeB(edgeCornerTouchOffset)),
    },
    {
      label: 'edge-corner overlap',
      expectedState: 'overlapping',
      contact: closestContact(
        shapeA,
        makeShapeB({ x: edgeCornerTouchOffset.x - 2, y: edgeCornerTouchOffset.y }),
      ),
    },
  ];

  for (const entry of cases) {
    assert(
      entry.contact.state === entry.expectedState,
      `${entry.label}: expected ${entry.expectedState}, got ${entry.contact.state}`,
    );
    assert(!entry.contact.usesTextureBounds, `${entry.label}: contact must not use texture bounds`);
  }

  assert(cases[1].contact.penetrationDepth > 0, 'corner overlap should report penetration');
  assert(cases[2].contact.distance > 0, 'corner separation should report positive distance');
  assert(cases[4].contact.penetrationDepth > 0, 'edge/corner overlap should report penetration');

  const insideDistance = signedDistanceToContour({ x: 80, y: 112 }, shapeA);
  const outsideDistance = signedDistanceToContour({ x: -8, y: 28 }, shapeA);
  assert(insideDistance < 0, 'inside signed distance should be negative');
  assert(outsideDistance > 0, 'outside signed distance should be positive');

  return {
    cases: cases.map((entry) => contactSummary(entry.label, entry.contact)),
    signedDistance: {
      center: round(insideDistance, 6),
      outsideLeftOfCorner: round(outsideDistance, 6),
    },
  };
};

const runTiming = (iterations) => {
  const bySegment = [];
  let checksum = 0;
  let totalExtrusions = 0;
  const totalStart = performance.now();

  for (const cornerSegments of SEGMENT_COUNTS) {
    const start = performance.now();
    let extrusions = 0;
    for (let iteration = 0; iteration < iterations; iteration += 1) {
      for (const depth of DEPTHS) {
        for (const bevel of BEVELS) {
          const contour = makeCardContour(cornerSegments, `bench-card-s${cornerSegments}`);
          const mesh = extrudeShape({
            contours: [contour],
            depth,
            bevel: bevel.value,
          });
          checksum += mesh.indices.length + mesh.vertices.length + mesh.edgeLoops.length;
          extrusions += 1;
        }
      }
    }
    const elapsedMs = performance.now() - start;
    totalExtrusions += extrusions;
    bySegment.push({
      cornerSegments,
      contourPoints: makeCardContour(cornerSegments).points.length,
      extrusions,
      elapsedMs: round(elapsedMs),
      extrusionsPerSecond: Math.round(extrusions / (elapsedMs / 1000)),
    });
  }

  const totalElapsedMs = performance.now() - totalStart;
  return {
    iterationsPerSegment: iterations,
    totalExtrusions,
    elapsedMs: round(totalElapsedMs),
    extrusionsPerSecond: Math.round(totalExtrusions / (totalElapsedMs / 1000)),
    checksum,
    bySegment,
  };
};

const run = () => {
  const args = new Set(process.argv.slice(2));
  const iterations =
    Number.parseInt(
      process.argv.find((arg) => arg.startsWith('--iterations='))?.split('=')[1] ?? '',
      10,
    ) || DEFAULT_ITERATIONS;
  const meshValidation = runMeshValidation();
  const contacts = runContactChecks();
  const timing = runTiming(iterations);
  const report = {
    ok: true,
    card: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      radius: CARD_RADIUS,
      segmentCounts: SEGMENT_COUNTS,
      depths: DEPTHS,
      bevels: BEVELS.map((entry) => entry.label),
    },
    meshValidation,
    contacts,
    timing,
    recommendation:
      'Make rounded-card contours authoritative for geometry, picking, and collision; use canvas/SVG textures only as UV-sampled face material.',
  };

  if (args.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('Shape extrusion prototype OK');
  console.log(
    `mesh cases: ${meshValidation.caseCount}; triangles ${meshValidation.minTriangles}-${meshValidation.maxTriangles}; vertices ${meshValidation.minVertices}-${meshValidation.maxVertices}`,
  );
  console.log(`min triangle area: ${meshValidation.minTriangleArea}`);
  console.log('contacts:');
  for (const contact of contacts.cases) {
    console.log(
      `  ${contact.label}: ${contact.state}, distance=${contact.distance}, penetration=${contact.penetrationDepth}, normal=(${contact.normal.x}, ${contact.normal.y})`,
    );
  }
  console.log(
    `signed distance: center=${contacts.signedDistance.center}, outside-left-corner=${contacts.signedDistance.outsideLeftOfCorner}`,
  );
  console.log(
    `timing: ${timing.totalExtrusions} extrusions in ${timing.elapsedMs} ms (${timing.extrusionsPerSecond}/sec)`,
  );
  for (const entry of timing.bySegment) {
    console.log(
      `  segments=${entry.cornerSegments} points=${entry.contourPoints}: ${entry.extrusions} extrusions, ${entry.elapsedMs} ms, ${entry.extrusionsPerSecond}/sec`,
    );
  }
};

run();

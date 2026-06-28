#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createPathHitRegion,
  pointOnSegment,
  simulateDragSequence,
} from './geometry.mjs';

const DEFAULT_ITERATIONS = 200_000;
const FIXTURE_URL = new URL('./fixtures/star-geometry.json', import.meta.url);

const round = (value, digits = 3) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

const readStarFixture = async () => JSON.parse(await readFile(FIXTURE_URL, 'utf8'));

const makePrng = (seed = 0x12345678) => {
  let state = seed >>> 0;

  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const makeFuzzPoints = ({ bounds, count, seed = 0x51a7 }) => {
  const random = makePrng(seed);
  const paddingX = bounds.width * 0.2;
  const paddingY = bounds.height * 0.2;
  const minX = bounds.minX - paddingX;
  const minY = bounds.minY - paddingY;
  const width = bounds.width + paddingX * 2;
  const height = bounds.height + paddingY * 2;

  return Array.from({ length: count }, () => ({
    x: minX + random() * width,
    y: minY + random() * height,
  }));
};

const makeGridPoints = ({ bounds, step = 1 }) => {
  const points = [];

  for (let y = Math.floor(bounds.minY); y <= Math.ceil(bounds.maxY); y += step) {
    for (let x = Math.floor(bounds.minX); x <= Math.ceil(bounds.maxX); x += step) {
      points.push({ x, y });
    }
  }

  return points;
};

const countHits = (hitRegion, points) => {
  let hits = 0;

  for (const point of points) {
    if (hitRegion.contains(point)) {
      hits += 1;
    }
  }

  return hits;
};

const timedCount = (label, hitRegion, points) => {
  const start = performance.now();
  const hits = countHits(hitRegion, points);
  const elapsedMs = performance.now() - start;

  return {
    label,
    points: points.length,
    hits,
    misses: points.length - hits,
    elapsedMs: round(elapsedMs),
    pointsPerSecond: Math.round(points.length / (elapsedMs / 1000)),
  };
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const runCorrectnessChecks = ({ starRegion, starPoints }) => {
  const cases = [
    { label: 'center body', point: { x: 128, y: 128 }, expected: true },
    { label: 'top point boundary', point: { x: 128, y: 20 }, expected: true },
    { label: 'concave notch outside', point: { x: 187, y: 130 }, expected: false },
    { label: 'inside AABB outside star left notch', point: { x: 60, y: 136 }, expected: false },
    { label: 'inside AABB outside star right notch', point: { x: 196, y: 136 }, expected: false },
    { label: 'outside AABB', point: { x: 10, y: 10 }, expected: false },
  ];

  for (const entry of cases) {
    assert(
      starRegion.contains(entry.point) === entry.expected,
      `${entry.label} expected ${entry.expected}`,
    );
  }

  assert(
    pointOnSegment({ x: 128, y: 20 }, starPoints[9], starPoints[0]),
    'vertex should count as boundary',
  );

  const donutRegion = createPathHitRegion({
    fillRule: 'nonzero',
    contours: [
      {
        id: 'outer-square',
        role: 'solid',
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
      },
      {
        id: 'hole-square',
        role: 'hole',
        points: [
          [35, 35],
          [65, 35],
          [65, 65],
          [35, 65],
        ],
      },
    ],
  });

  assert(donutRegion.contains({ x: 20, y: 20 }), 'solid contour should hit');
  assert(!donutRegion.contains({ x: 50, y: 50 }), 'hole contour should reject');

  const rejectedDrag = simulateDragSequence({
    hitRegion: starRegion,
    startPointer: { x: 60, y: 136 },
    moves: [{ x: 80, y: 150 }],
  });

  assert(!rejectedDrag.start.accepted, 'drag must not begin in transparent AABB space');

  const acceptedDrag = simulateDragSequence({
    hitRegion: starRegion,
    startPointer: { x: 128, y: 128 },
    moves: [
      { x: 140, y: 140 },
      { x: 155, y: 160 },
    ],
    worldBounds: { minX: 0, minY: 0, maxX: 512, maxY: 512 },
  });

  assert(acceptedDrag.start.accepted, 'drag should begin inside the star');
  assert(acceptedDrag.steps.at(-1).origin.x === 27, 'drag x origin should preserve grab offset');
  assert(acceptedDrag.steps.at(-1).origin.y === 32, 'drag y origin should preserve grab offset');

  return {
    caseCount: cases.length + 5,
    drag: {
      rejectedReason: rejectedDrag.start.reason,
      acceptedFinalOrigin: acceptedDrag.end.origin,
    },
  };
};

const estimateTextureBytes = ({ width, height }) => ({
  width,
  height,
  rgba8Bytes: width * height * 4,
  rgba8KiB: round((width * height * 4) / 1024, 1),
});

const run = async () => {
  const args = new Set(process.argv.slice(2));
  const iterations = Number.parseInt(
    process.argv.find((arg) => arg.startsWith('--iterations='))?.split('=')[1] ?? '',
    10,
  ) || DEFAULT_ITERATIONS;

  const fixture = await readStarFixture();
  const starRegion = createPathHitRegion({
    contours: fixture.contours,
    fillRule: fixture.fillRule,
    boundaryMode: 'inside',
    metadata: { fixture: fixture.id },
  });
  const starPoints = starRegion.contours[0].points;
  const correctness = runCorrectnessChecks({ starRegion, starPoints });
  const fuzzPoints = makeFuzzPoints({ bounds: starRegion.bounds, count: iterations });
  const gridPoints = makeGridPoints({ bounds: starRegion.bounds, step: 1 });
  const insideAabbOutsideShape = gridPoints.filter(
    (point) => !starRegion.contains(point),
  ).length;
  const benchmark = [
    timedCount('deterministic pointer fuzz', starRegion, fuzzPoints),
    timedCount('1px grid over geometry AABB', starRegion, gridPoints),
  ];
  const texture = estimateTextureBytes({ width: 256, height: 256 });
  const heap = process.memoryUsage();
  const report = {
    ok: true,
    fixture: fixture.id,
    algorithm: {
      fillRule: starRegion.fillRule,
      boundaryMode: starRegion.boundaryMode,
      contourCount: starRegion.contours.length,
      pointCount: starPoints.length,
      bounds: starRegion.bounds,
    },
    correctness,
    falsePositivePrevention: {
      gridPointsInsideAabbButOutsideStar: insideAabbOutsideShape,
      percentOfAabbRejected: round((insideAabbOutsideShape / gridPoints.length) * 100, 2),
    },
    benchmark,
    memory: {
      heapUsedKiB: round(heap.heapUsed / 1024, 1),
      arrayBuffersKiB: round(heap.arrayBuffers / 1024, 1),
      texture,
      note: 'Geometry hit testing uses a small point array; the 256x256 RGBA8 canvas texture dominates this fixture memory.',
    },
  };

  if (args.has('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const rejected = report.falsePositivePrevention.gridPointsInsideAabbButOutsideStar;
    const rejectedPercent = report.falsePositivePrevention.percentOfAabbRejected;

    console.log(`SVG canvas gateway hit-region benchmark
fixture: ${report.fixture}
correctness cases: ${report.correctness.caseCount}
false-positive prevention: ${rejected} of ${gridPoints.length} AABB grid points rejected (${rejectedPercent}%)
texture memory: ${texture.rgba8KiB} KiB for ${texture.width}x${texture.height} RGBA8
`);

    for (const entry of benchmark) {
      console.log(
        `${entry.label}: ${entry.points} points, ${entry.elapsedMs} ms, ${entry.pointsPerSecond} points/sec, ${entry.hits} hits`,
      );
    }
  }
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export {
  makeFuzzPoints,
  makeGridPoints,
  runCorrectnessChecks,
  timedCount,
};

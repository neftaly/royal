#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Research harness for picking fuzz oracles.
 *
 * This file keeps the browser-independent core runnable while the browser
 * adapter is still a future integration point. It models the same loop the
 * browser runner should use:
 *
 *   generate samples -> dispatch pointer events -> read hover/probe rows
 *   -> sample visible pixels -> report mismatches.
 */

const DEFAULT_COLUMNS = 12;
const DEFAULT_ROWS = 5;

const defaultTargets = [
  {
    id: 'viewport',
    label: 'Viewport',
    layer: 0,
    rect: { x: 0, y: 0, width: 8, height: 5 },
  },
  {
    id: 'cube-control',
    label: 'Cube Control',
    layer: 1,
    rect: { x: 8, y: 0, width: 4, height: 2 },
  },
];

const REPLAY_SCHEMA_VERSION = 1;
const REPLAY_POINTER_SPACE = 'fixture-css-px';
const REPLAY_EVENT_TYPE = 'pointermove';
const EXPECTED_HIT_SOURCE = 'visible-mask-oracle';
const OBSERVED_HIT_SOURCE = 'bounds-simulator';
const VISIBLE_PIXEL_ORACLE_SOURCE = 'visible-mask-oracle';
const VISIBLE_PIXEL_CLASSIFICATIONS = new Set([
  'covered-target',
  'covered-other-target',
  'empty',
]);
const CLASSIFICATIONS = new Set([
  'match',
  'false-positive',
  'false-negative',
  'wrong-target',
]);

const isInsideRect = (point, rect) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const pickByBounds = (point, targets) =>
  [...targets]
    .sort((a, b) => b.layer - a.layer)
    .find((target) => isInsideRect(point, target.rect))?.id;

const findTarget = (targets, targetId) =>
  targetId === undefined || targetId === null
    ? undefined
    : targets.find((target) => target.id === targetId);

const makeGridSamples = ({
  columns = DEFAULT_COLUMNS,
  rows = DEFAULT_ROWS,
  step = 0.5,
  jitter = 0.13,
} = {}) => {
  const samples = [];
  let sequence = 1;

  for (let y = 0; y <= rows; y += step) {
    for (let x = 0; x <= columns; x += step) {
      const offset = ((sequence * 1103515245 + 12345) >>> 0) / 0xffffffff;
      const jx = (offset - 0.5) * jitter;
      const jy = (1 - offset - 0.5) * jitter;
      samples.push({
        id: `sample-${sequence}`,
        x: clamp(x + jx, 0, columns),
        y: clamp(y + jy, 0, rows),
      });
      sequence += 1;
    }
  }

  return samples;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Visible mask oracle used by --self-test.
 *
 * The notch intentionally creates a region that is inside the cube-control
 * pick rectangle but not visible. The same shape maps to the helmet issue:
 * bounds-based picking says "hit", while an alpha/depth/stencil pixel oracle
 * says "empty".
 */
const visibleTargetAtPoint = (point) => {
  if (isInsideRect(point, { x: 8, y: 0, width: 4, height: 2 })) {
    const inTransparentNotch =
      point.x >= 9.25 &&
      point.x <= 10.75 &&
      point.y >= 0.45 &&
      point.y <= 1.55;

    return inTransparentNotch ? undefined : 'cube-control';
  }

  if (isInsideRect(point, { x: 0, y: 0, width: 8, height: 5 })) {
    return 'viewport';
  }

  return undefined;
};

const analyzeSamples = ({ samples, targets, visibleTargetAt }) => {
  const failures = [];

  for (const sample of samples) {
    const pickedId = pickByBounds(sample, targets);
    const visibleId = visibleTargetAt(sample);

    if (pickedId !== undefined && visibleId === undefined) {
      failures.push({
        kind: 'non-visible-hover',
        sampleId: sample.id,
        x: round(sample.x),
        y: round(sample.y),
        pickedId,
        visibleId: visibleId ?? null,
      });
      continue;
    }

    if (pickedId !== visibleId) {
      failures.push({
        kind: 'wrong-visible-target',
        sampleId: sample.id,
        x: round(sample.x),
        y: round(sample.y),
        pickedId,
        visibleId: visibleId ?? null,
      });
    }
  }

  return {
    sampleCount: samples.length,
    failureCount: failures.length,
    failures,
  };
};

const makeHit = (targetId, source) =>
  targetId === undefined || targetId === null
    ? null
    : {
        targetId,
        source,
      };

const classifyHit = ({ expectedHit, observedHit }) => {
  const expectedId = expectedHit?.targetId ?? null;
  const observedId = observedHit?.targetId ?? null;

  if (expectedId === observedId) {
    return 'match';
  }

  if (expectedId === null && observedId !== null) {
    return 'false-positive';
  }

  if (expectedId !== null && observedId === null) {
    return 'false-negative';
  }

  return 'wrong-target';
};

const makeRegionRef = (target) =>
  target === undefined
    ? null
    : {
        targetId: target.id,
        label: target.label,
        layer: target.layer,
      };

const makeVisualBounds = (target) =>
  target === undefined
    ? null
    : {
        targetId: target.id,
        space: REPLAY_POINTER_SPACE,
        rect: roundRect(target.rect),
      };

const classifyVisiblePixel = ({ expectedId, observedId }) => {
  if (expectedId === undefined || expectedId === null) {
    return 'empty';
  }

  if (observedId === undefined || observedId === null || expectedId === observedId) {
    return 'covered-target';
  }

  return 'covered-other-target';
};

const makeVisiblePixelOracle = ({ expectedId, observedId }) => ({
  source: VISIBLE_PIXEL_ORACLE_SOURCE,
  space: REPLAY_POINTER_SPACE,
  radiusPx: 0,
  targetId: expectedId ?? null,
  classification: classifyVisiblePixel({ expectedId, observedId }),
});

const makeReplayRow = ({ sample, targets, visibleTargetAt }) => {
  const observedId = pickByBounds(sample, targets);
  const expectedId = visibleTargetAt(sample);
  const observedHit = makeHit(observedId, OBSERVED_HIT_SOURCE);
  const expectedHit = makeHit(expectedId, EXPECTED_HIT_SOURCE);

  return {
    rowId: sample.id,
    pointerSample: {
      id: sample.id,
      eventType: REPLAY_EVENT_TYPE,
      space: REPLAY_POINTER_SPACE,
      x: round(sample.x),
      y: round(sample.y),
    },
    expectedHit,
    observedHit,
    visiblePixelOracle: makeVisiblePixelOracle({ expectedId, observedId }),
    hitRegionRef: makeRegionRef(findTarget(targets, observedId)),
    visualBounds: makeVisualBounds(findTarget(targets, expectedId)),
    classification: classifyHit({ expectedHit, observedHit }),
  };
};

const makeReplayFixture = ({
  fixtureId = 'notched-bounds-simulator',
  samples,
  targets,
  visibleTargetAt,
} = {}) => ({
  schemaVersion: REPLAY_SCHEMA_VERSION,
  fixtureId,
  pointerSpace: REPLAY_POINTER_SPACE,
  generatedBy: 'research/picking-fuzz/picking-fuzz-harness.mjs',
  rows: samples.map((sample) => makeReplayRow({ sample, targets, visibleTargetAt })),
});

const summarizeReplayRows = (rows) => {
  const counts = Object.fromEntries([...CLASSIFICATIONS].map((kind) => [kind, 0]));

  for (const row of rows) {
    counts[row.classification] += 1;
  }

  const mismatches = rows
    .filter((row) => row.classification !== 'match')
    .map((row) => ({
      rowId: row.rowId,
      x: row.pointerSample.x,
      y: row.pointerSample.y,
      expectedId: row.expectedHit?.targetId ?? null,
      observedId: row.observedHit?.targetId ?? null,
      classification: row.classification,
    }));

  return {
    rowCount: rows.length,
    mismatchCount: mismatches.length,
    falsePositiveCount: counts['false-positive'],
    falseNegativeCount: counts['false-negative'],
    counts,
    mismatches,
  };
};

const validateReplayFixture = (fixture) => {
  const errors = [];

  if (fixture === null || typeof fixture !== 'object' || Array.isArray(fixture)) {
    return ['fixture must be a JSON object'];
  }

  if (fixture.schemaVersion !== REPLAY_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${REPLAY_SCHEMA_VERSION}`);
  }

  if (!Array.isArray(fixture.rows)) {
    errors.push('rows must be an array');
    return errors;
  }

  fixture.rows.forEach((row, index) => {
    const prefix = `rows[${index}]`;

    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      errors.push(`${prefix} must be an object`);
      return;
    }

    if (typeof row.rowId !== 'string' || row.rowId.length === 0) {
      errors.push(`${prefix}.rowId must be a non-empty string`);
    }

    if (!isPointerSample(row.pointerSample)) {
      errors.push(`${prefix}.pointerSample must include id, eventType, space, x, and y`);
    }

    if (!isHit(row.expectedHit)) {
      errors.push(`${prefix}.expectedHit must be null or a hit object`);
    }

    if (!isHit(row.observedHit)) {
      errors.push(`${prefix}.observedHit must be null or a hit object`);
    }

    if (!isVisiblePixelOracle(row.visiblePixelOracle)) {
      errors.push(
        `${prefix}.visiblePixelOracle must include source, space, radiusPx, targetId, and classification`,
      );
    } else {
      const expectedId = row.expectedHit?.targetId ?? null;
      const observedId = row.observedHit?.targetId ?? null;
      const derivedVisibleClassification = classifyVisiblePixel({ expectedId, observedId });

      if (row.visiblePixelOracle.targetId !== expectedId) {
        errors.push(`${prefix}.visiblePixelOracle.targetId must match expectedHit target id`);
      }

      if (row.visiblePixelOracle.classification !== derivedVisibleClassification) {
        errors.push(
          `${prefix}.visiblePixelOracle.classification must be ${derivedVisibleClassification} for expected/observed hit ids`,
        );
      }
    }

    if (!isNullableObject(row.hitRegionRef)) {
      errors.push(`${prefix}.hitRegionRef must be null or an object`);
    }

    if (!isNullableObject(row.visualBounds)) {
      errors.push(`${prefix}.visualBounds must be null or an object`);
    }

    if (!CLASSIFICATIONS.has(row.classification)) {
      errors.push(`${prefix}.classification is not a known classification`);
      return;
    }

    const derivedClassification = classifyHit(row);
    if (row.classification !== derivedClassification) {
      errors.push(
        `${prefix}.classification must be ${derivedClassification} for expected/observed hit ids`,
      );
    }
  });

  return errors;
};

const isPointerSample = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof value.id === 'string' &&
  typeof value.eventType === 'string' &&
  typeof value.space === 'string' &&
  Number.isFinite(value.x) &&
  Number.isFinite(value.y);

const isHit = (value) =>
  value === null ||
  (value !== undefined &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.targetId === 'string' &&
    typeof value.source === 'string');

const isVisiblePixelOracle = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof value.source === 'string' &&
  value.space === REPLAY_POINTER_SPACE &&
  Number.isFinite(value.radiusPx) &&
  (value.targetId === null || typeof value.targetId === 'string') &&
  VISIBLE_PIXEL_CLASSIFICATIONS.has(value.classification);

const isNullableObject = (value) =>
  value === null ||
  (value !== undefined && typeof value === 'object' && !Array.isArray(value));

const round = (value) => Math.round(value * 1000) / 1000;

const roundRect = (rect) => ({
  x: round(rect.x),
  y: round(rect.y),
  width: round(rect.width),
  height: round(rect.height),
});

const printBrowserAdapterSketch = () => {
  console.log(`Browser adapter sketch:

const canvas = await page.locator('canvas').first();
const box = await canvas.boundingBox();
for (const sample of samples) {
  const clientX = box.x + sample.u * box.width;
  const clientY = box.y + sample.v * box.height;
  await page.mouse.move(clientX, clientY);

  const observed = await page.evaluate(() => ({
    hoverId: window.__royalPickingProbe?.hoveredId,
    rows: window.__royalPickingProbe?.rows ?? scrapeMiniTableRows(),
    pixel: sampleCanvasPixelUnderPointer(),
  }));

  record(sample, observed);
}
`);
};

const runSelfTest = () => {
  const samples = makeGridSamples({ step: 0.25, jitter: 0.06 });
  const report = analyzeSamples({
    samples,
    targets: defaultTargets,
    visibleTargetAt: visibleTargetAtPoint,
  });

  console.log(JSON.stringify({
    ok: report.failureCount > 0,
    sampleCount: report.sampleCount,
    failureCount: report.failureCount,
    firstFailures: report.failures.slice(0, 8),
  }, null, 2));

  if (report.failureCount === 0) {
    console.error('Expected the visible-mask oracle to find at least one mismatch.');
    process.exitCode = 1;
  }
};

const runEmitReplay = () => {
  const fixture = makeReplayFixture({
    samples: makeGridSamples({ step: 1, jitter: 0 }),
    targets: defaultTargets,
    visibleTargetAt: visibleTargetAtPoint,
  });

  console.log(JSON.stringify(fixture, null, 2));
};

const runReplayCheck = (fixturePath) => {
  if (fixturePath === undefined) {
    console.error('Usage: picking-fuzz-harness.mjs replay/check <fixture.json>');
    process.exitCode = 1;
    return;
  }

  const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  const errors = validateReplayFixture(fixture);

  if (errors.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      fixturePath,
      errorCount: errors.length,
      errors,
    }, null, 2));
    process.exitCode = 1;
    return;
  }

  const summary = summarizeReplayRows(fixture.rows);
  console.log(JSON.stringify({
    ok: true,
    fixturePath,
    rowCount: summary.rowCount,
    mismatchCount: summary.mismatchCount,
    falsePositiveCount: summary.falsePositiveCount,
    falseNegativeCount: summary.falseNegativeCount,
    counts: summary.counts,
    firstMismatches: summary.mismatches.slice(0, 12),
  }, null, 2));
};

const runPlan = () => {
  const samples = makeGridSamples({ step: 1 });
  console.log(JSON.stringify({
    sampleCount: samples.length,
    firstSamples: samples.slice(0, 8),
    targets: defaultTargets,
  }, null, 2));
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const args = new Set(argv);

  if (args.has('--self-test')) {
    runSelfTest();
  } else if (argv[0] === 'emit-replay' || args.has('--emit-replay')) {
    runEmitReplay();
  } else if (argv[0] === 'replay/check' || args.has('--replay-check')) {
    runReplayCheck(argv[0] === 'replay/check' ? argv[1] : argv[argv.indexOf('--replay-check') + 1]);
  } else if (args.has('--browser-sketch')) {
    printBrowserAdapterSketch();
  } else {
    runPlan();
  }
}

export {
  analyzeSamples,
  classifyHit,
  makeGridSamples,
  makeReplayFixture,
  makeReplayRow,
  pickByBounds,
  summarizeReplayRows,
  validateReplayFixture,
  visibleTargetAtPoint,
};

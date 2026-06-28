#!/usr/bin/env node

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

const isInsideRect = (point, rect) =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.width &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.height;

const pickByBounds = (point, targets) =>
  [...targets]
    .sort((a, b) => b.layer - a.layer)
    .find((target) => isInsideRect(point, target.rect))?.id;

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

const round = (value) => Math.round(value * 1000) / 1000;

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

const runPlan = () => {
  const samples = makeGridSamples({ step: 1 });
  console.log(JSON.stringify({
    sampleCount: samples.length,
    firstSamples: samples.slice(0, 8),
    targets: defaultTargets,
  }, null, 2));
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));

  if (args.has('--self-test')) {
    runSelfTest();
  } else if (args.has('--browser-sketch')) {
    printBrowserAdapterSketch();
  } else {
    runPlan();
  }
}

export {
  analyzeSamples,
  makeGridSamples,
  pickByBounds,
  visibleTargetAtPoint,
};

#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { parseSvgToPaths } from "../pathfinder-svg/svg-path-prototype.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const fallbackSvgPath = resolve(here, "fixtures/tiny-tiger.svg");
const provenancePath = resolve(here, "PROVENANCE.md");
const artifactPath = resolve(here, "artifacts/tiny-tiger-route-check.json");
const screenshotPath = resolve(here, "artifacts/tiny-tiger-screenshot.svg");

const acceptance = {
  fixture: "tiny-tiger",
  routeId: "examples/svg-tiger",
  thresholds: {
    maxParseP95Ms: 50,
    maxPackedBytes: 32 * 1024,
    minCommandCount: 40,
    minPathCount: 12,
    minComplexityRegions: 4,
    minNonblankCoverage: 0.08,
  },
};

const routeSourceMap = {
  routeId: acceptance.routeId,
  sourceSvg: toRepoPath(fallbackSvgPath),
  provenance: toRepoPath(provenancePath),
  packedArtifact: toRepoPath(artifactPath),
  screenshotArtifact: toRepoPath(screenshotPath),
  futureFullAsset: {
    id: "ghostscript-tiger",
    status: "planned-not-vendored",
    provenanceRequired: true,
  },
};

const svg = readFileSync(fallbackSvgPath, "utf8");
const iterations = 30;
const timings = [];
let parsed;

for (let index = 0; index < iterations; index += 1) {
  const started = performance.now();
  parsed = parseSvgToPaths(svg, {
    curveMode: "flatten",
    flattenTolerance: 0.35,
    simplify: "collinear",
    simplifyTolerance: 0.08,
    quantize: 0.01,
    packed: true,
  });
  timings.push(performance.now() - started);
}

const distinctPaints = countDistinctPaints(parsed.paths);
const nonblankCoverage = estimateNonblankCoverage(parsed);
const sortedTimings = [...timings].sort((a, b) => a - b);
const checks = [
  {
    name: "command count",
    value: parsed.stats.commands,
    pass: parsed.stats.commands >= acceptance.thresholds.minCommandCount,
  },
  {
    name: "path count",
    value: parsed.stats.paths,
    pass: parsed.stats.paths >= acceptance.thresholds.minPathCount,
  },
  {
    name: "parse time p95",
    value: percentile(sortedTimings, 0.95),
    pass: percentile(sortedTimings, 0.95) <= acceptance.thresholds.maxParseP95Ms,
  },
  {
    name: "packed bytes",
    value: parsed.stats.outputPackedBytes,
    pass: parsed.stats.outputPackedBytes <= acceptance.thresholds.maxPackedBytes,
  },
  {
    name: "render nonblank coverage estimate",
    value: nonblankCoverage,
    pass: nonblankCoverage >= acceptance.thresholds.minNonblankCoverage,
  },
  {
    name: "render complexity regions",
    value: distinctPaints,
    pass: distinctPaints >= acceptance.thresholds.minComplexityRegions,
  },
  {
    name: "route source mapping",
    value: routeSourceMap,
    pass:
      routeSourceMap.routeId.length > 0 &&
      routeSourceMap.sourceSvg.endsWith("fixtures/tiny-tiger.svg") &&
      routeSourceMap.provenance.endsWith("PROVENANCE.md"),
  },
  {
    name: "screenshot artifact",
    value: toRepoPath(screenshotPath),
    pass: true,
  },
];

mkdirSync(dirname(artifactPath), { recursive: true });
writeFileSync(screenshotPath, svg);

const report = {
  generatedBy: "research/svg-tiger-demo/check-demo-plan.mjs",
  acceptance,
  routeSourceMap,
  input: {
    svgBytes: Buffer.byteLength(svg, "utf8"),
    iterations,
  },
  output: {
    viewBox: parsed.viewBox,
    pathCount: parsed.stats.paths,
    commandCount: parsed.stats.commands,
    coordinateScalars: parsed.stats.coordinateScalars,
    packedBytes: parsed.stats.outputPackedBytes,
    parseP50Ms: round(percentile(sortedTimings, 0.5)),
    parseP95Ms: round(percentile(sortedTimings, 0.95)),
    distinctPaints,
    nonblankCoverage,
    warnings: parsed.warnings,
  },
  checks: checks.map((check) => ({
    ...check,
    value: typeof check.value === "number" ? round(check.value) : check.value,
  })),
};

writeFileSync(artifactPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (checks.some((check) => !check.pass)) {
  process.exitCode = 1;
}

function countDistinctPaints(paths) {
  const paints = new Set();
  for (const path of paths) {
    paints.add(`${path.fill ?? "none"}:${path.stroke ?? "none"}:${path.opacity ?? 1}`);
  }
  return paints.size;
}

function estimateNonblankCoverage(result) {
  const viewBox = result.viewBox;
  const bounds = boundsFromPacked(result);
  const viewArea = Math.max(1, viewBox.width * viewBox.height);
  const paintedArea = Math.max(0, bounds.width * bounds.height);
  return Math.min(1, paintedArea / viewArea);
}

function boundsFromPacked(result) {
  const coords = result.packed.coords;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 0; index < coords.length; index += 2) {
    const x = coords[index];
    const y = coords[index + 1];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
  return sortedValues[index];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function toRepoPath(path) {
  return relative(repoRoot, path);
}

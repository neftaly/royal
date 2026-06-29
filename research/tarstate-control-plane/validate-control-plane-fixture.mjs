#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, "fixtures/control-plane-snapshot.json");

const expectedSchemaVersion = "royal.research.tarstate-control-plane.fixture.v0";
const requiredRelations = new Set([
  "renderRoots",
  "renderPasses",
  "renderNodes",
  "rendererCapabilities",
  "diagnostics",
  "assetLoads",
  "visibilityStats",
  "commands",
  "commandResults",
]);
const requiredCommandKinds = new Set([
  "selectNode",
  "clearSelection",
  "setDebugOverlay",
  "requestCapabilityProbe",
  "requestBenchmarkProbe",
  "setRendererBudget",
]);
const allowedPolicies = new Set(["replace", "ring", "sampledBucket"]);
const allowedEventKinds = new Set([
  "root:created",
  "scene:accepted",
  "pass:stats",
  "asset:load",
  "pick:sample",
]);

const fixture = await readJson(fixturePath);
const diagnostics = validateFixture(fixture);

if (diagnostics.length > 0) {
  console.error(JSON.stringify({
    status: "failed",
    message: "tarstate control-plane fixture validation failed",
    diagnostics,
  }, null, 2));
  process.exit(1);
}

console.log(
  `tarstate control-plane fixture checked: ${fixture.relations.length} relations, ${fixture.eventRows.length} event rows, ${fixture.commandKinds.length} command kinds`,
);

function validateFixture(value) {
  const diagnostics = [];

  expectEqual(diagnostics, "schemaVersion", value.schemaVersion, expectedSchemaVersion);
  expectEqual(diagnostics, "status", value.status, "research-fixture");
  expectEqual(diagnostics, "exampleReadiness.readyForExampleRoute", value.exampleReadiness?.readyForExampleRoute, false);
  expectString(diagnostics, "exampleReadiness.blocker", value.exampleReadiness?.blocker);
  expectString(diagnostics, "exampleReadiness.nextPrototypeStep", value.exampleReadiness?.nextPrototypeStep);
  validateBudgets(diagnostics, value.budgets);
  validateRelations(diagnostics, value.relations, value.budgets);
  validateEventRows(diagnostics, value.eventRows, new Set(value.forbiddenPayloadKeys ?? []));
  validateCommandKinds(diagnostics, value.commandKinds);

  return diagnostics;
}

function validateBudgets(diagnostics, budgets) {
  expectObject(diagnostics, "budgets", budgets);
  for (const key of ["diagnostics", "pickSamples", "pointerSamples", "frameStatBuckets", "benchmarkSamples", "commandResults"]) {
    expectInteger(diagnostics, `budgets.${key}`, budgets?.[key], { min: 1, max: 10_000 });
  }
  expectInteger(diagnostics, "budgets.statsPeriodMs", budgets?.statsPeriodMs, { min: 50, max: 5_000 });
}

function validateRelations(diagnostics, relations, budgets) {
  const rows = arrayAt(diagnostics, "relations", relations);
  const names = new Set();
  for (const [index, relation] of rows.entries()) {
    const prefix = `relations[${index}]`;
    expectString(diagnostics, `${prefix}.name`, relation?.name);
    if (typeof relation?.name === "string") {
      if (names.has(relation.name)) diagnostics.push(`${prefix}.name duplicates ${relation.name}`);
      names.add(relation.name);
    }
    expectStringArray(diagnostics, `${prefix}.key`, relation?.key);
    expectOneOf(diagnostics, `${prefix}.policy`, relation?.policy, allowedPolicies);
    expectEqual(diagnostics, `${prefix}.drawLoopDependency`, relation?.drawLoopDependency, false);

    if (relation?.budget !== undefined) {
      expectString(diagnostics, `${prefix}.budget`, relation.budget);
      if (budgets?.[relation.budget] === undefined) diagnostics.push(`${prefix}.budget references missing budget ${relation.budget}`);
    } else {
      expectInteger(diagnostics, `${prefix}.maxRows`, relation?.maxRows, { min: 1, max: 100_000 });
    }
  }

  for (const required of requiredRelations) {
    if (!names.has(required)) diagnostics.push(`relations missing required relation ${required}`);
  }
}

function validateEventRows(diagnostics, rows, forbiddenKeys) {
  const eventRows = arrayAt(diagnostics, "eventRows", rows);
  for (const [index, row] of eventRows.entries()) {
    const prefix = `eventRows[${index}]`;
    expectOneOf(diagnostics, `${prefix}.kind`, row?.kind, allowedEventKinds);
    expectString(diagnostics, `${prefix}.rootId`, row?.rootId);
    validateNoForbiddenKeys(diagnostics, prefix, row, forbiddenKeys);
  }
}

function validateCommandKinds(diagnostics, commandKinds) {
  const rows = arrayAt(diagnostics, "commandKinds", commandKinds);
  const kinds = new Set();
  for (const [index, row] of rows.entries()) {
    const prefix = `commandKinds[${index}]`;
    expectString(diagnostics, `${prefix}.kind`, row?.kind);
    expectString(diagnostics, `${prefix}.target`, row?.target);
    expectString(diagnostics, `${prefix}.resultPolicy`, row?.resultPolicy);
    if (typeof row?.kind === "string") {
      if (kinds.has(row.kind)) diagnostics.push(`${prefix}.kind duplicates ${row.kind}`);
      kinds.add(row.kind);
    }
  }

  for (const required of requiredCommandKinds) {
    if (!kinds.has(required)) diagnostics.push(`commandKinds missing required command ${required}`);
  }
}

function validateNoForbiddenKeys(diagnostics, prefix, value, forbiddenKeys) {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.has(key)) diagnostics.push(`${prefix}.${key} must not carry renderer/browser handles`);
    validateNoForbiddenKeys(diagnostics, `${prefix}.${key}`, child, forbiddenKeys);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function arrayAt(diagnostics, pathName, value) {
  if (!Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an array`);
    return [];
  }
  return value;
}

function expectObject(diagnostics, pathName, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an object`);
  }
}

function expectString(diagnostics, pathName, value) {
  if (typeof value !== "string" || value.length === 0) diagnostics.push(`${pathName} must be a non-empty string`);
}

function expectStringArray(diagnostics, pathName, value) {
  const rows = arrayAt(diagnostics, pathName, value);
  if (rows.length === 0) diagnostics.push(`${pathName} must not be empty`);
  for (const [index, item] of rows.entries()) expectString(diagnostics, `${pathName}[${index}]`, item);
}

function expectInteger(diagnostics, pathName, value, { min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = {}) {
  if (!Number.isInteger(value)) {
    diagnostics.push(`${pathName} must be an integer`);
    return;
  }
  if (value < min || value > max) diagnostics.push(`${pathName} must be between ${min} and ${max}`);
}

function expectEqual(diagnostics, pathName, actual, expected) {
  if (actual !== expected) diagnostics.push(`${pathName} expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
}

function expectOneOf(diagnostics, pathName, value, allowed) {
  if (!allowed.has(value)) diagnostics.push(`${pathName} must be one of ${JSON.stringify([...allowed])}`);
}

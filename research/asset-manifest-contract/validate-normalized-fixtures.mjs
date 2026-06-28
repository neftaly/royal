#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures");
const schemaPath = path.join(here, "asset-manifest-contract.schema.json");

const allowedAssetKinds = new Set([
  "virtual-texture",
  "terrain-tile",
  "terrain-world-index",
  "dynamic-impostor-set",
  "mesh",
  "texture",
  "debug-report",
]);
const allowedArtifactKinds = new Set([
  "mesh",
  "texture",
  "atlas",
  "preview",
  "stats",
  "report",
  "debug-overlay",
  "source",
  "page-table",
]);
const allowedBoundSpaces = new Set(["world", "tile", "object", "virtual-texture", "atlas", "page", "uv", "screen"]);
const allowedBoundKinds = new Set(["aabb3", "rect2", "sphere", "grid2", "range1"]);
const allowedPageKinds = new Set([
  "virtual-texture-page",
  "terrain-tile-page",
  "impostor-atlas-region",
  "impostor-page-group",
]);
const allowedQualities = new Set(["placeholder", "preview", "draft", "research-demo", "final"]);

async function main() {
  await readJson(schemaPath);
  const fixtureNames = (await readdir(fixtureRoot))
    .filter((name) => name.endsWith(".normalized.json"))
    .sort();

  if (fixtureNames.length === 0) {
    fail(["fixtures directory has no *.normalized.json files"]);
  }

  const diagnostics = [];
  for (const fixtureName of fixtureNames) {
    const fixture = await readJson(path.join(fixtureRoot, fixtureName));
    diagnostics.push(...validateFixture(fixture, fixtureName));
  }

  if (diagnostics.length > 0) {
    fail(diagnostics);
  }

  console.log(`normalized asset manifest fixtures checked: ${fixtureNames.length} fixtures`);
}

function validateFixture(fixture, fixtureName) {
  const diagnostics = [];
  const at = (pathName) => `${fixtureName}:${pathName}`;

  expectEqual(diagnostics, at("schemaVersion"), fixture.schemaVersion, "royal.research.asset-manifest-contract.v0");
  expectEqual(diagnostics, at("contractStatus"), fixture.contractStatus, "research-unstable");
  expectObject(diagnostics, at("asset"), fixture.asset);
  expectString(diagnostics, at("asset.id"), fixture.asset?.id);
  expectOneOf(diagnostics, at("asset.kind"), fixture.asset?.kind, allowedAssetKinds);
  expectString(diagnostics, at("asset.revision"), fixture.asset?.revision);
  expectOneOf(diagnostics, at("asset.quality"), fixture.asset?.quality, allowedQualities);

  validateWorld(diagnostics, at, fixture.world);

  const bounds = arrayAt(diagnostics, at("bounds"), fixture.bounds);
  const artifacts = arrayAt(diagnostics, at("artifacts"), fixture.artifacts);
  const pages = optionalArrayAt(diagnostics, at("pages"), fixture.pages);
  const lodLevels = arrayAt(diagnostics, at("lod.levels"), fixture.lod?.levels);
  const previews = arrayAt(diagnostics, at("previews"), fixture.previews);
  const debugRecords = arrayAt(diagnostics, at("debug"), fixture.debug);
  const sourceRecords = arrayAt(diagnostics, at("provenance.sources"), fixture.provenance?.sources);

  expectString(diagnostics, at("lod.identityPolicy"), fixture.lod?.identityPolicy);
  expectString(diagnostics, at("residency.policy"), fixture.residency?.policy);

  const boundsById = uniqueById(diagnostics, at("bounds"), bounds);
  const artifactsById = uniqueById(diagnostics, at("artifacts"), artifacts);
  const pagesById = uniqueById(diagnostics, at("pages"), pages);
  const lodById = uniqueById(diagnostics, at("lod.levels"), lodLevels);
  uniqueById(diagnostics, at("previews"), previews);
  uniqueById(diagnostics, at("debug"), debugRecords);

  for (const [index, bound] of bounds.entries()) {
    validateBounds(diagnostics, at(`bounds[${index}]`), bound);
  }

  for (const [index, artifact] of artifacts.entries()) {
    const prefix = at(`artifacts[${index}]`);
    expectString(diagnostics, `${prefix}.id`, artifact?.id);
    expectOneOf(diagnostics, `${prefix}.kind`, artifact?.kind, allowedArtifactKinds);
    expectString(diagnostics, `${prefix}.uri`, artifact?.uri);
    expectString(diagnostics, `${prefix}.revision`, artifact?.revision);
    expectOneOf(diagnostics, `${prefix}.quality`, artifact?.quality, allowedQualities);
    validateUri(diagnostics, `${prefix}.uri`, artifact?.uri);
    validateRefs(diagnostics, `${prefix}.bounds`, artifact?.bounds, boundsById, "bound");
    if (artifact?.sha256 !== undefined) {
      expectSha256(diagnostics, `${prefix}.sha256`, artifact.sha256);
    }
    if (artifact?.dimensions !== undefined) {
      expectPositiveNumberArray(diagnostics, `${prefix}.dimensions`, artifact.dimensions);
    }
  }

  for (const [index, page] of pages.entries()) {
    const prefix = at(`pages[${index}]`);
    expectString(diagnostics, `${prefix}.id`, page?.id);
    expectOneOf(diagnostics, `${prefix}.kind`, page?.kind, allowedPageKinds);
    expectRef(diagnostics, `${prefix}.artifact`, page?.artifact, artifactsById, "artifact");
    validateRefs(diagnostics, `${prefix}.bounds`, page?.bounds, boundsById, "bound", { required: true });
    if (page?.lodLevel !== undefined) {
      expectRef(diagnostics, `${prefix}.lodLevel`, page.lodLevel, lodById, "LOD level");
    }
  }

  for (const [index, level] of lodLevels.entries()) {
    const prefix = at(`lod.levels[${index}]`);
    expectString(diagnostics, `${prefix}.id`, level?.id);
    expectInteger(diagnostics, `${prefix}.level`, level?.level, { min: 0 });
    expectOneOf(diagnostics, `${prefix}.quality`, level?.quality, allowedQualities);
    validateRefs(diagnostics, `${prefix}.artifacts`, level?.artifacts, artifactsById, "artifact");
    validateRefs(diagnostics, `${prefix}.pages`, level?.pages, pagesById, "page");
    validateRefs(diagnostics, `${prefix}.bounds`, level?.bounds, boundsById, "bound");
  }

  validateResidency(diagnostics, at, fixture.residency, artifactsById, pagesById, boundsById);

  for (const [index, preview] of previews.entries()) {
    const prefix = at(`previews[${index}]`);
    expectString(diagnostics, `${prefix}.id`, preview?.id);
    expectString(diagnostics, `${prefix}.role`, preview?.role);
    if (preview?.artifact !== undefined) {
      expectRef(diagnostics, `${prefix}.artifact`, preview.artifact, artifactsById, "artifact");
    }
    validateRefs(diagnostics, `${prefix}.bounds`, preview?.bounds, boundsById, "bound");
  }

  for (const [index, debugRecord] of debugRecords.entries()) {
    const prefix = at(`debug[${index}]`);
    expectString(diagnostics, `${prefix}.id`, debugRecord?.id);
    expectString(diagnostics, `${prefix}.role`, debugRecord?.role);
    if (debugRecord?.artifact !== undefined) {
      expectRef(diagnostics, `${prefix}.artifact`, debugRecord.artifact, artifactsById, "artifact");
    }
  }

  for (const [index, source] of sourceRecords.entries()) {
    const prefix = at(`provenance.sources[${index}]`);
    expectString(diagnostics, `${prefix}.kind`, source?.kind);
    expectString(diagnostics, `${prefix}.uri`, source?.uri);
    validateUri(diagnostics, `${prefix}.uri`, source?.uri);
  }

  return diagnostics;
}

function validateWorld(diagnostics, at, world) {
  expectObject(diagnostics, at("world"), world);
  expectString(diagnostics, at("world.id"), world?.id);
  expectString(diagnostics, at("world.units"), world?.units);
  expectObject(diagnostics, at("world.coordinateSystem"), world?.coordinateSystem);
  expectOneOf(
    diagnostics,
    at("world.coordinateSystem.handedness"),
    world?.coordinateSystem?.handedness,
    new Set(["right-handed", "left-handed", "screen-2d", "texture-2d"]),
  );
  expectString(diagnostics, at("world.coordinateSystem.up"), world?.coordinateSystem?.up);
  expectString(diagnostics, at("world.coordinateSystem.forward"), world?.coordinateSystem?.forward);
}

function validateBounds(diagnostics, prefix, bound) {
  expectString(diagnostics, `${prefix}.id`, bound?.id);
  expectOneOf(diagnostics, `${prefix}.space`, bound?.space, allowedBoundSpaces);
  expectOneOf(diagnostics, `${prefix}.kind`, bound?.kind, allowedBoundKinds);

  if (bound?.kind === "aabb3") {
    expectNumberArray(diagnostics, `${prefix}.min`, bound.min, 3);
    expectNumberArray(diagnostics, `${prefix}.max`, bound.max, 3);
    validateMinMax(diagnostics, prefix, bound.min, bound.max);
  }

  if (bound?.kind === "rect2") {
    expectNumberArray(diagnostics, `${prefix}.rect`, bound.rect, 4);
    if (Array.isArray(bound?.rect) && (bound.rect[2] < 0 || bound.rect[3] < 0)) {
      diagnostics.push(`${prefix}.rect width and height must be non-negative`);
    }
  }

  if (bound?.kind === "sphere") {
    expectNumberArray(diagnostics, `${prefix}.center`, bound.center, 3);
    expectNumber(diagnostics, `${prefix}.radius`, bound.radius, { min: 0 });
  }

  if (bound?.kind === "grid2") {
    expectObject(diagnostics, `${prefix}.grid`, bound.grid);
    expectNumber(diagnostics, `${prefix}.tileSize`, bound.tileSize, { exclusiveMin: 0 });
  }

  if (bound?.kind === "range1") {
    expectNumberArray(diagnostics, `${prefix}.min`, bound.min, 1);
    expectNumberArray(diagnostics, `${prefix}.max`, bound.max, 1);
    validateMinMax(diagnostics, prefix, bound.min, bound.max);
  }
}

function validateResidency(diagnostics, at, residency, artifactsById, pagesById, boundsById) {
  expectObject(diagnostics, at("residency"), residency);
  const pageGroups = optionalArrayAt(diagnostics, at("residency.pageGroups"), residency?.pageGroups);
  uniqueById(diagnostics, at("residency.pageGroups"), pageGroups);

  for (const [index, group] of pageGroups.entries()) {
    const prefix = at(`residency.pageGroups[${index}]`);
    expectString(diagnostics, `${prefix}.id`, group?.id);
    if (group?.atlasArtifact !== undefined) {
      expectRef(diagnostics, `${prefix}.atlasArtifact`, group.atlasArtifact, artifactsById, "artifact");
    }
    validateRefs(diagnostics, `${prefix}.pages`, group?.pages, pagesById, "page");
  }

  const cells = optionalArrayAt(diagnostics, at("residency.cells"), residency?.cells);
  uniqueById(diagnostics, at("residency.cells"), cells);
  for (const [index, cell] of cells.entries()) {
    const prefix = at(`residency.cells[${index}]`);
    expectString(diagnostics, `${prefix}.id`, cell?.id);
    validateRefs(diagnostics, `${prefix}.bounds`, cell?.bounds, boundsById, "bound", { required: true });
  }
}

function validateRefs(diagnostics, pathName, values, targetMap, label, options = {}) {
  if (values === undefined) {
    if (options.required) diagnostics.push(`${pathName} is required`);
    return;
  }
  if (!Array.isArray(values)) {
    diagnostics.push(`${pathName} must be an array`);
    return;
  }
  if (options.required && values.length === 0) {
    diagnostics.push(`${pathName} must not be empty`);
  }
  for (const [index, value] of values.entries()) {
    expectRef(diagnostics, `${pathName}[${index}]`, value, targetMap, label);
  }
}

function expectRef(diagnostics, pathName, value, targetMap, label) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(`${pathName} must be a non-empty ${label} id`);
    return;
  }
  if (!targetMap.has(value)) {
    diagnostics.push(`${pathName} references missing ${label} ${value}`);
  }
}

function uniqueById(diagnostics, pathName, records) {
  const byId = new Map();
  for (const [index, record] of records.entries()) {
    if (!record || typeof record !== "object") {
      diagnostics.push(`${pathName}[${index}] must be an object`);
      continue;
    }
    if (typeof record.id !== "string" || record.id.length === 0) {
      diagnostics.push(`${pathName}[${index}].id must be a non-empty string`);
      continue;
    }
    if (byId.has(record.id)) {
      diagnostics.push(`${pathName}[${index}].id duplicates ${record.id}`);
      continue;
    }
    byId.set(record.id, record);
  }
  return byId;
}

function arrayAt(diagnostics, pathName, value) {
  if (!Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an array`);
    return [];
  }
  if (value.length === 0) {
    diagnostics.push(`${pathName} must not be empty`);
  }
  return value;
}

function optionalArrayAt(diagnostics, pathName, value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an array when present`);
    return [];
  }
  return value;
}

function validateUri(diagnostics, pathName, value) {
  if (typeof value !== "string" || value.length === 0) return;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
  if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
    diagnostics.push(`${pathName} must be a relative repo path or an explicit URI scheme`);
  }
}

function validateMinMax(diagnostics, prefix, min, max) {
  if (!Array.isArray(min) || !Array.isArray(max) || min.length !== max.length) return;
  for (let index = 0; index < min.length; index += 1) {
    if (typeof min[index] === "number" && typeof max[index] === "number" && min[index] > max[index]) {
      diagnostics.push(`${prefix}.min[${index}] must be <= max[${index}]`);
    }
  }
}

function expectObject(diagnostics, pathName, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an object`);
  }
}

function expectString(diagnostics, pathName, value) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(`${pathName} must be a non-empty string`);
  }
}

function expectEqual(diagnostics, pathName, value, expected) {
  if (value !== expected) {
    diagnostics.push(`${pathName} expected ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
  }
}

function expectOneOf(diagnostics, pathName, value, allowed) {
  if (!allowed.has(value)) {
    diagnostics.push(`${pathName} expected one of ${[...allowed].join(", ")}, got ${JSON.stringify(value)}`);
  }
}

function expectInteger(diagnostics, pathName, value, options = {}) {
  if (!Number.isInteger(value)) {
    diagnostics.push(`${pathName} must be an integer`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    diagnostics.push(`${pathName} must be >= ${options.min}`);
  }
}

function expectNumber(diagnostics, pathName, value, options = {}) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    diagnostics.push(`${pathName} must be a finite number`);
    return;
  }
  if (options.min !== undefined && value < options.min) {
    diagnostics.push(`${pathName} must be >= ${options.min}`);
  }
  if (options.exclusiveMin !== undefined && value <= options.exclusiveMin) {
    diagnostics.push(`${pathName} must be > ${options.exclusiveMin}`);
  }
}

function expectNumberArray(diagnostics, pathName, value, length) {
  if (!Array.isArray(value) || value.length !== length) {
    diagnostics.push(`${pathName} must be an array of ${length} numbers`);
    return;
  }
  for (const [index, item] of value.entries()) {
    expectNumber(diagnostics, `${pathName}[${index}]`, item);
  }
}

function expectPositiveNumberArray(diagnostics, pathName, value) {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(`${pathName} must be a non-empty array of positive numbers`);
    return;
  }
  for (const [index, item] of value.entries()) {
    expectNumber(diagnostics, `${pathName}[${index}]`, item, { exclusiveMin: 0 });
  }
}

function expectSha256(diagnostics, pathName, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(`${pathName} must be a lowercase sha256 hex digest`);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function fail(diagnostics) {
  console.error(
    JSON.stringify(
      {
        status: "failed",
        message: "normalized asset manifest validation failed",
        diagnostics,
      },
      null,
      2,
    ),
  );
  process.exit(1);
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

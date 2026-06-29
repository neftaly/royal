#!/usr/bin/env node

import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const roadmapPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, "prototype-readiness.json");

const expectedSchemaVersion = "royal.research.renderer-foundations.readiness.v0";
const allowedStatuses = new Set([
  "research-ready",
  "blocked-by-renderer-api",
  "blocked-by-runtime-api",
  "planned",
]);

const roadmap = JSON.parse(await readFile(roadmapPath, "utf8"));
const diagnostics = await validateRoadmap(roadmap);

if (diagnostics.length > 0) {
  console.error(JSON.stringify({
    status: "failed",
    message: "renderer-foundations readiness roadmap validation failed",
    diagnostics,
  }, null, 2));
  process.exit(1);
}

console.log(`renderer foundations readiness checked: ${roadmap.stages.length} stages`);

async function validateRoadmap(value) {
  const diagnostics = [];
  expectEqual(diagnostics, "schemaVersion", value.schemaVersion, expectedSchemaVersion);
  expectEqual(diagnostics, "status", value.status, "research-roadmap");
  expectEqual(diagnostics, "exampleReadiness.readyForExampleRoute", value.exampleReadiness?.readyForExampleRoute, false);
  expectString(diagnostics, "exampleReadiness.blocker", value.exampleReadiness?.blocker);
  expectString(diagnostics, "exampleReadiness.nextPrototypeStep", value.exampleReadiness?.nextPrototypeStep);

  const stages = arrayAt(diagnostics, "stages", value.stages);
  const seen = new Set();
  for (const [index, stage] of stages.entries()) {
    const prefix = `stages[${index}]`;
    validateStageShape(diagnostics, prefix, stage);
    if (typeof stage?.id === "string") {
      if (seen.has(stage.id)) diagnostics.push(`${prefix}.id duplicates ${stage.id}`);
      seen.add(stage.id);
    }
    for (const dependency of stage?.dependencies ?? []) {
      if (!seen.has(dependency)) diagnostics.push(`${prefix}.dependencies references ${dependency} before it is ready`);
    }
    await validatePathsExist(diagnostics, `${prefix}.readinessAssets`, stage?.readinessAssets ?? []);
    await validateCommands(diagnostics, `${prefix}.validationCommands`, stage?.validationCommands ?? []);
  }

  if (stages.length < 8) diagnostics.push("stages should cover all renderer-foundations sections");
  return diagnostics;
}

function validateStageShape(diagnostics, prefix, stage) {
  expectString(diagnostics, `${prefix}.id`, stage?.id);
  expectString(diagnostics, `${prefix}.title`, stage?.title);
  expectOneOf(diagnostics, `${prefix}.status`, stage?.status, allowedStatuses);
  expectStringArray(diagnostics, `${prefix}.dependencies`, stage?.dependencies);
  expectStringArray(diagnostics, `${prefix}.readinessAssets`, stage?.readinessAssets);
  expectStringArray(diagnostics, `${prefix}.validationCommands`, stage?.validationCommands);
  expectString(diagnostics, `${prefix}.blocker`, stage?.blocker);
  expectString(diagnostics, `${prefix}.nextPrototypeStep`, stage?.nextPrototypeStep);
}

async function validatePathsExist(diagnostics, pathName, paths) {
  for (const [index, repoPath] of paths.entries()) {
    if (!isResearchPath(repoPath)) {
      diagnostics.push(`${pathName}[${index}] must stay under research/`);
      continue;
    }
    try {
      await access(path.join(repoRoot, repoPath));
    } catch {
      diagnostics.push(`${pathName}[${index}] missing ${repoPath}`);
    }
  }
}

async function validateCommands(diagnostics, pathName, commands) {
  for (const [index, command] of commands.entries()) {
    if (!command.startsWith("node research/")) {
      diagnostics.push(`${pathName}[${index}] must be a local node research command`);
      continue;
    }
    const scriptPath = command.split(/\s+/).find((part) => part.startsWith("research/"));
    if (!scriptPath) {
      diagnostics.push(`${pathName}[${index}] missing research script path`);
      continue;
    }
    if (!scriptPath.endsWith(".mjs")) diagnostics.push(`${pathName}[${index}] should point at an .mjs script`);
    if (!isResearchPath(scriptPath)) {
      diagnostics.push(`${pathName}[${index}] script path must stay under research/`);
      continue;
    }
    try {
      await access(path.join(repoRoot, scriptPath));
    } catch {
      diagnostics.push(`${pathName}[${index}] missing script ${scriptPath}`);
    }
  }
}

function isResearchPath(repoPath) {
  return typeof repoPath === "string" && repoPath.startsWith("research/") && !repoPath.includes("..");
}

function arrayAt(diagnostics, pathName, value) {
  if (!Array.isArray(value)) {
    diagnostics.push(`${pathName} must be an array`);
    return [];
  }
  return value;
}

function expectString(diagnostics, pathName, value) {
  if (typeof value !== "string" || value.length === 0) diagnostics.push(`${pathName} must be a non-empty string`);
}

function expectStringArray(diagnostics, pathName, value) {
  const rows = arrayAt(diagnostics, pathName, value);
  for (const [index, item] of rows.entries()) expectString(diagnostics, `${pathName}[${index}]`, item);
}

function expectEqual(diagnostics, pathName, actual, expected) {
  if (actual !== expected) diagnostics.push(`${pathName} expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
}

function expectOneOf(diagnostics, pathName, value, allowed) {
  if (!allowed.has(value)) diagnostics.push(`${pathName} must be one of ${JSON.stringify([...allowed])}`);
}

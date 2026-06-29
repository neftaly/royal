#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(here, "fixtures/backend-choice-cases.json");
const sourcePath = path.join(here, "capability-probe.ts");

const expectedSchemaVersion = "royal.research.webgpu.backend-choice-cases.v0";
const allowedBackends = new Set(["webgl", "webgpu", "auto"]);
const allowedResolvedBackends = new Set(["webgl", "webgpu"]);
const allowedFallbacks = new Set(["error", "webgl", "disable-feature", "cpu", "asset"]);
const allowedFeatures = new Set([
  "indexed-geometry",
  "uint32-indices",
  "instancing",
  "compute-pass",
  "storage-buffer",
  "timestamp-query",
  "texture-compression-bc",
  "texture-compression-astc",
  "texture-compression-etc2",
]);

const fixture = await readJson(fixturePath);
const source = await readFile(sourcePath, "utf8");
const diagnostics = [
  ...validateSourceContract(source),
  ...validateFixture(fixture),
];

if (diagnostics.length > 0) {
  console.error(JSON.stringify({
    status: "failed",
    message: "webgpu backend-choice fixture validation failed",
    diagnostics,
  }, null, 2));
  process.exit(1);
}

console.log(`webgpu backend-choice fixture checked: ${fixture.cases.length} cases`);

function validateSourceContract(sourceText) {
  const diagnostics = [];
  for (const token of [
    "chooseRoyalBackend",
    "probeRoyalGpuCapabilities",
    "RoyalBackendRequest",
    "RoyalFallbackPolicy",
    '"webgpu"',
    '"webgl"',
    '"auto"',
  ]) {
    if (!sourceText.includes(token)) diagnostics.push(`capability-probe.ts missing ${token}`);
  }
  return diagnostics;
}

function validateFixture(value) {
  const diagnostics = [];
  expectEqual(diagnostics, "schemaVersion", value.schemaVersion, expectedSchemaVersion);
  expectEqual(diagnostics, "status", value.status, "research-fixture");
  expectEqual(diagnostics, "exampleReadiness.readyForExampleRoute", value.exampleReadiness?.readyForExampleRoute, false);
  expectString(diagnostics, "exampleReadiness.blocker", value.exampleReadiness?.blocker);
  expectString(diagnostics, "exampleReadiness.nextPrototypeStep", value.exampleReadiness?.nextPrototypeStep);

  const cases = arrayAt(diagnostics, "cases", value.cases);
  const names = new Set();
  for (const [index, testCase] of cases.entries()) {
    const prefix = `cases[${index}]`;
    validateCaseShape(diagnostics, prefix, testCase);
    if (typeof testCase?.name === "string") {
      if (names.has(testCase.name)) diagnostics.push(`${prefix}.name duplicates ${testCase.name}`);
      names.add(testCase.name);
    }

    const actual = chooseBackend(testCase.probe, testCase.request);
    validateExpectedResult(diagnostics, `${prefix}.expected`, actual, testCase.expected);
  }

  if (cases.length < 4) diagnostics.push("cases must include explicit, auto, fallback, and error-policy coverage");
  return diagnostics;
}

function validateCaseShape(diagnostics, prefix, testCase) {
  expectString(diagnostics, `${prefix}.name`, testCase?.name);
  validateRequest(diagnostics, `${prefix}.request`, testCase?.request);
  validateProbe(diagnostics, `${prefix}.probe`, testCase?.probe);
  expectOneOf(diagnostics, `${prefix}.expected.backend`, testCase?.expected?.backend, allowedResolvedBackends);
  for (const [featureIndex, feature] of optionalArrayAt(diagnostics, `${prefix}.expected.featuresInclude`, testCase?.expected?.featuresInclude).entries()) {
    expectOneOf(diagnostics, `${prefix}.expected.featuresInclude[${featureIndex}]`, feature, allowedFeatures);
  }
}

function validateRequest(diagnostics, prefix, request) {
  expectObject(diagnostics, prefix, request);
  if (request?.backend !== undefined) expectOneOf(diagnostics, `${prefix}.backend`, request.backend, allowedBackends);
  if (request?.fallback !== undefined) expectOneOf(diagnostics, `${prefix}.fallback`, request.fallback, allowedFallbacks);
  for (const [index, feature] of optionalArrayAt(diagnostics, `${prefix}.requiredFeatures`, request?.requiredFeatures).entries()) {
    expectOneOf(diagnostics, `${prefix}.requiredFeatures[${index}]`, feature, allowedFeatures);
  }
}

function validateProbe(diagnostics, prefix, probe) {
  expectObject(diagnostics, prefix, probe);
  validateBackendProbe(diagnostics, `${prefix}.webgl`, probe?.webgl, "webgl");
  validateBackendProbe(diagnostics, `${prefix}.webgpu`, probe?.webgpu, "webgpu");
}

function validateBackendProbe(diagnostics, prefix, probe, backend) {
  expectObject(diagnostics, prefix, probe);
  expectBoolean(diagnostics, `${prefix}.available`, probe?.available);
  for (const [index, feature] of optionalArrayAt(diagnostics, `${prefix}.features`, probe?.features).entries()) {
    if (backend === "webgpu" && feature.startsWith("texture-compression-")) {
      expectOneOf(diagnostics, `${prefix}.features[${index}]`, feature, allowedFeatures);
    }
    if (backend === "webgl") {
      expectOneOf(diagnostics, `${prefix}.features[${index}]`, feature, allowedFeatures);
    }
  }
}

function validateExpectedResult(diagnostics, prefix, actual, expected) {
  expectEqual(diagnostics, `${prefix}.backend`, actual.backend, expected?.backend);
  expectJsonEqual(diagnostics, `${prefix}.diagnosticCodes`, actual.diagnostics.map((diagnostic) => diagnostic.code), expected?.diagnosticCodes ?? []);

  if (expected?.diagnosticFeatures !== undefined) {
    expectJsonEqual(
      diagnostics,
      `${prefix}.diagnosticFeatures`,
      actual.diagnostics.map((diagnostic) => diagnostic.feature).filter(Boolean),
      expected.diagnosticFeatures,
    );
  }

  for (const feature of expected?.featuresInclude ?? []) {
    if (!actual.features.has(feature)) diagnostics.push(`${prefix}.features missing ${feature}`);
  }
}

function chooseBackend(probe, request = {}) {
  const backend = request.backend ?? "auto";
  const requiredFeatures = request.requiredFeatures ?? [];
  const diagnostics = [];

  if (backend === "webgpu") return requireBackend("webgpu", probe, requiredFeatures, diagnostics);
  if (backend === "webgl") return requireBackend("webgl", probe, requiredFeatures, diagnostics);

  if (probe.webgpu.available) {
    const webgpu = requireBackend("webgpu", probe, requiredFeatures, diagnostics);
    if (webgpu.diagnostics.every((diagnostic) => diagnostic.code !== "feature_unavailable")) {
      return webgpu;
    }
  }

  if (probe.webgl.available && request.fallback !== "error") {
    diagnostics.push({
      backend: "webgl",
      code: "fallback_selected",
      message: "Selected WebGL because WebGPU was unavailable or missing required features.",
    });
    return requireBackend("webgl", probe, requiredFeatures, diagnostics);
  }

  return requireBackend("webgpu", probe, requiredFeatures, diagnostics);
}

function requireBackend(backend, probe, requiredFeatures, diagnostics) {
  const backendProbe = backend === "webgpu" ? probe.webgpu : probe.webgl;
  const availableFeatures = backend === "webgpu" ? webgpuRoyalFeatures(probe.webgpu) : new Set(probe.webgl.features);

  if (!backendProbe.available) {
    diagnostics.push({
      backend,
      code: "backend_unavailable",
      message: `${backend} is unavailable.`,
    });
  }

  for (const feature of requiredFeatures) {
    if (!availableFeatures.has(feature)) {
      diagnostics.push({
        backend,
        code: "feature_unavailable",
        feature,
        message: `${feature} is unavailable on ${backend}.`,
      });
    }
  }

  return {
    backend,
    diagnostics,
    features: availableFeatures,
  };
}

function webgpuRoyalFeatures(webgpu) {
  const features = new Set([
    "indexed-geometry",
    "uint32-indices",
    "instancing",
    "compute-pass",
    "storage-buffer",
  ]);
  for (const optional of ["timestamp-query", "texture-compression-bc", "texture-compression-astc", "texture-compression-etc2"]) {
    if (webgpu.features.includes(optional)) features.add(optional);
  }
  return features;
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

function optionalArrayAt(diagnostics, pathName, value) {
  if (value === undefined) return [];
  return arrayAt(diagnostics, pathName, value);
}

function expectObject(diagnostics, pathName, value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) diagnostics.push(`${pathName} must be an object`);
}

function expectString(diagnostics, pathName, value) {
  if (typeof value !== "string" || value.length === 0) diagnostics.push(`${pathName} must be a non-empty string`);
}

function expectBoolean(diagnostics, pathName, value) {
  if (typeof value !== "boolean") diagnostics.push(`${pathName} must be a boolean`);
}

function expectEqual(diagnostics, pathName, actual, expected) {
  if (actual !== expected) diagnostics.push(`${pathName} expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
}

function expectJsonEqual(diagnostics, pathName, actual, expected) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) diagnostics.push(`${pathName} expected ${expectedJson}, actual ${actualJson}`);
}

function expectOneOf(diagnostics, pathName, value, allowed) {
  if (!allowed.has(value)) diagnostics.push(`${pathName} must be one of ${JSON.stringify([...allowed])}`);
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile as readFileAsync } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "../..");

const args = parseArgs(process.argv.slice(2));
const diagnostics = [];

const configPath = path.join(toolDir, "config/low.json");
const fixturePath = path.join(toolDir, "fixtures/sample-manifest.json");

const config = await readJson(configPath, diagnostics);
if (config) {
  validateConfig(config, diagnostics, configPath);
}

const fixture = await readJson(fixturePath, diagnostics);
if (fixture) {
  validateManifest(fixture, diagnostics, {
    label: "fixture manifest",
    root: path.dirname(fixturePath),
    checkFiles: false,
  });
}

if (args.out) {
  const manifestPath = path.join(args.out, "manifest.json");
  const manifest = await readJson(manifestPath, diagnostics);
  if (manifest) {
    validateManifest(manifest, diagnostics, {
      label: "generated manifest",
      root: args.out,
      checkFiles: true,
    });
  }
}

if (diagnostics.length > 0) {
  console.error(`blender terrain POC validation failed (${diagnostics.length})`);
  for (const diagnostic of diagnostics) {
    console.error(`- ${diagnostic}`);
  }
  process.exit(1);
}

console.log(
  args.out
    ? `blender terrain POC validation passed: fixture plus ${relative(args.out)}`
    : "blender terrain POC validation passed: config plus fixture",
);

function parseArgs(argv) {
  const parsed = { out: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      parsed.out = resolveFromRoot(requireValue(argv, ++index, arg));
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node tools/blender-terrain-poc/validate.mjs [--out tools/blender-terrain-poc/out/low]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function validateConfig(config, diagnostics, label) {
  expectEqual(diagnostics, `${label}.manifestVersion`, config.manifestVersion, 1);
  expectString(diagnostics, `${label}.world.id`, config.world?.id);
  expectString(diagnostics, `${label}.world.seed`, config.world?.seed);
  expectEqual(diagnostics, `${label}.world.units`, config.world?.units, "meters");
  expectCoordinateSystem(diagnostics, `${label}.world.coordinateSystem`, config.world?.coordinateSystem);
  expectString(diagnostics, `${label}.tile.id`, config.tile?.id);
  expectString(diagnostics, `${label}.tile.pageId`, config.tile?.pageId);
  expectPositiveNumber(diagnostics, `${label}.tile.sizeMeters`, config.tile?.sizeMeters);
  expectInteger(diagnostics, `${label}.tile.grid.x`, config.tile?.grid?.x, { allowZero: true });
  expectInteger(diagnostics, `${label}.tile.grid.z`, config.tile?.grid?.z, { allowZero: true });
  expectInteger(diagnostics, `${label}.tile.grid.level`, config.tile?.grid?.level, { allowZero: true });
  expectString(diagnostics, `${label}.recipe.id`, config.recipe?.id);
  expectOneOf(diagnostics, `${label}.recipe.quality`, config.recipe?.quality, ["preview", "draft", "high"]);
  expectInteger(diagnostics, `${label}.recipe.segments`, config.recipe?.segments);
  expectInteger(diagnostics, `${label}.recipe.textureSize`, config.recipe?.textureSize);
  expectInteger(diagnostics, `${label}.recipe.previewSize`, config.recipe?.previewSize);
  expectPositiveNumber(diagnostics, `${label}.recipe.screenSpaceError`, config.recipe?.screenSpaceError);

  for (const [index, asset] of arrayAt(config.assets, `${label}.assets`, diagnostics).entries()) {
    expectString(diagnostics, `${label}.assets[${index}].id`, asset?.id);
    expectOneOf(diagnostics, `${label}.assets[${index}].kind`, asset?.kind, ["tree", "rocks", "marker"]);
    validateVec2(diagnostics, `${label}.assets[${index}].position`, asset?.position);
    expectPositiveNumber(diagnostics, `${label}.assets[${index}].scale`, asset?.scale);
  }
}

function validateManifest(manifest, diagnostics, options) {
  const label = options.label;
  expectEqual(diagnostics, `${label}.manifestVersion`, manifest.manifestVersion, 1);
  expectString(diagnostics, `${label}.world.id`, manifest.world?.id);
  expectEqual(diagnostics, `${label}.world.units`, manifest.world?.units, "meters");
  expectCoordinateSystem(diagnostics, `${label}.world.coordinateSystem`, manifest.world?.coordinateSystem);
  expectString(diagnostics, `${label}.world.seed`, manifest.world?.seed);
  expectString(diagnostics, `${label}.tile.id`, manifest.tile?.id);
  expectString(diagnostics, `${label}.tile.pageId`, manifest.tile?.pageId);
  expectString(diagnostics, `${label}.tile.revision`, manifest.tile?.revision);
  expectOneOf(diagnostics, `${label}.tile.quality`, manifest.tile?.quality, ["preview", "draft", "high", "final"]);
  expectPositiveNumber(diagnostics, `${label}.tile.sizeMeters`, manifest.tile?.sizeMeters);
  validateBounds(diagnostics, `${label}.tile.bounds`, manifest.tile?.bounds);
  expectEqual(diagnostics, `${label}.lod.identityPolicy`, manifest.lod?.identityPolicy, "stable-world-tile-page");

  const allArtifacts = [
    ...arrayAt(manifest.meshes, `${label}.meshes`, diagnostics),
    ...arrayAt(manifest.materialTextures, `${label}.materialTextures`, diagnostics),
    ...arrayAt(manifest.previews, `${label}.previews`, diagnostics),
    ...arrayAt(manifest.reports, `${label}.reports`, diagnostics),
  ];

  const artifactIds = new Set();
  for (const [index, artifact] of allArtifacts.entries()) {
    const prefix = `${label}.artifact[${index}]`;
    expectString(diagnostics, `${prefix}.id`, artifact?.id);
    expectString(diagnostics, `${prefix}.uri`, artifact?.uri);
    expectString(diagnostics, `${prefix}.mediaType`, artifact?.mediaType);
    expectString(diagnostics, `${prefix}.format`, artifact?.format);
    expectInteger(diagnostics, `${prefix}.bytes`, artifact?.bytes);
    expectSha256(diagnostics, `${prefix}.sha256`, artifact?.sha256);
    if (artifact?.id) {
      if (artifactIds.has(artifact.id)) {
        diagnostics.push(`${prefix}.id duplicates ${artifact.id}`);
      }
      artifactIds.add(artifact.id);
    }
  }

  for (const mesh of arrayAt(manifest.meshes, `${label}.meshes`, diagnostics)) {
    expectOneOf(diagnostics, `${label}.mesh.${mesh?.id}.mediaType`, mesh?.mediaType, ["model/gltf-binary", "model/gltf+json"]);
    validateBounds(diagnostics, `${label}.mesh.${mesh?.id}.bounds`, mesh?.bounds);
    expectInteger(diagnostics, `${label}.mesh.${mesh?.id}.vertexCount`, mesh?.vertexCount);
    expectInteger(diagnostics, `${label}.mesh.${mesh?.id}.indexCount`, mesh?.indexCount);
  }

  for (const texture of arrayAt(manifest.materialTextures, `${label}.materialTextures`, diagnostics)) {
    expectOneOf(diagnostics, `${label}.texture.${texture?.id}.slot`, texture?.slot, [
      "albedo",
      "normal",
      "roughness",
      "height",
      "material-mask",
    ]);
    validateDimensions(diagnostics, `${label}.texture.${texture?.id}.dimensions`, texture?.dimensions);
  }

  for (const preview of arrayAt(manifest.previews, `${label}.previews`, diagnostics)) {
    expectOneOf(diagnostics, `${label}.preview.${preview?.id}.role`, preview?.role, ["thumbnail", "orbit-render", "debug-overlay", "contact-sheet"]);
    validateDimensions(diagnostics, `${label}.preview.${preview?.id}.dimensions`, preview?.dimensions);
  }

  for (const level of arrayAt(manifest.lod?.levels, `${label}.lod.levels`, diagnostics)) {
    expectString(diagnostics, `${label}.lod.${level?.id}.id`, level?.id);
    expectInteger(diagnostics, `${label}.lod.${level?.id}.level`, level?.level, { allowZero: true });
    expectPositiveNumber(diagnostics, `${label}.lod.${level?.id}.screenSpaceError`, level?.screenSpaceError, { allowZero: true });
    if (!artifactIds.has(level?.mesh)) {
      diagnostics.push(`${label}.lod.${level?.id}.mesh references missing artifact ${level?.mesh}`);
    }
    if (!artifactIds.has(level?.preview)) {
      diagnostics.push(`${label}.lod.${level?.id}.preview references missing artifact ${level?.preview}`);
    }
    for (const textureId of arrayAt(level?.textures, `${label}.lod.${level?.id}.textures`, diagnostics)) {
      if (!artifactIds.has(textureId)) {
        diagnostics.push(`${label}.lod.${level?.id}.textures references missing artifact ${textureId}`);
      }
    }
  }

  expectString(diagnostics, `${label}.provenance.generator.name`, manifest.provenance?.generator?.name);
  expectString(diagnostics, `${label}.provenance.generator.version`, manifest.provenance?.generator?.version);
  expectString(diagnostics, `${label}.provenance.generator.command`, manifest.provenance?.generator?.command);
  expectString(diagnostics, `${label}.provenance.source.kind`, manifest.provenance?.source?.kind);
  expectSha256(diagnostics, `${label}.provenance.inputsHash`, manifest.provenance?.inputsHash);
  expectString(diagnostics, `${label}.provenance.createdAt`, manifest.provenance?.createdAt);

  if (options.checkFiles) {
    validateArtifactFiles(allArtifacts, options.root, diagnostics, label);
  }
}

function validateArtifactFiles(artifacts, root, diagnostics, label) {
  for (const artifact of artifacts) {
    const filePath = path.join(root, artifact.uri);
    let bytes;
    try {
      bytes = readFileSync(filePath);
    } catch {
      diagnostics.push(`${label}.${artifact.id} missing ${relative(filePath)}`);
      continue;
    }
    if (bytes.length !== artifact.bytes) {
      diagnostics.push(`${label}.${artifact.id} bytes expected ${artifact.bytes}, actual ${bytes.length}`);
    }
    const actualHash = sha256(bytes);
    if (actualHash !== artifact.sha256) {
      diagnostics.push(`${label}.${artifact.id} sha256 expected ${artifact.sha256}, actual ${actualHash}`);
    }
  }
}

async function readJson(filePath, diagnostics) {
  try {
    return JSON.parse(await readFileAsync(filePath, "utf8"));
  } catch (error) {
    diagnostics.push(`${relative(filePath)}: ${error.message}`);
    return undefined;
  }
}

function expectCoordinateSystem(diagnostics, label, value) {
  expectEqual(diagnostics, `${label}.handedness`, value?.handedness, "right-handed");
  expectEqual(diagnostics, `${label}.up`, value?.up, "+Y");
  expectEqual(diagnostics, `${label}.forward`, value?.forward, "-Z");
}

function validateBounds(diagnostics, label, bounds) {
  if (!bounds || typeof bounds !== "object") {
    diagnostics.push(`${label} must be an object`);
    return;
  }
  validateVec3(diagnostics, `${label}.min`, bounds.min);
  validateVec3(diagnostics, `${label}.max`, bounds.max);
  if (Array.isArray(bounds.min) && Array.isArray(bounds.max)) {
    for (let index = 0; index < 3; index += 1) {
      if (bounds.min[index] > bounds.max[index]) {
        diagnostics.push(`${label}.min[${index}] exceeds max`);
      }
    }
  }
}

function validateVec2(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "number")) {
    diagnostics.push(`${label} must be a numeric vec2`);
  }
}

function validateVec3(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== "number")) {
    diagnostics.push(`${label} must be a numeric vec3`);
  }
}

function validateDimensions(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isInteger(entry) || entry < 1)) {
    diagnostics.push(`${label} must be two positive integers`);
  }
}

function arrayAt(value, label, diagnostics) {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(`${label} must be a non-empty array`);
    return [];
  }
  return value;
}

function expectString(diagnostics, label, value) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(`${label} must be a non-empty string`);
  }
}

function expectEqual(diagnostics, label, actual, expected) {
  if (actual !== expected) {
    diagnostics.push(`${label} expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
  }
}

function expectOneOf(diagnostics, label, actual, expected) {
  if (!expected.includes(actual)) {
    diagnostics.push(`${label} expected one of ${expected.join(", ")}, actual ${JSON.stringify(actual)}`);
  }
}

function expectInteger(diagnostics, label, value, options = {}) {
  const minimum = options.allowZero ? 0 : 1;
  if (!Number.isInteger(value) || value < minimum) {
    diagnostics.push(`${label} must be an integer >= ${minimum}`);
  }
}

function expectPositiveNumber(diagnostics, label, value, options = {}) {
  const minimum = options.allowZero ? 0 : Number.MIN_VALUE;
  if (typeof value !== "number" || value < minimum) {
    diagnostics.push(`${label} must be a number >= ${minimum}`);
  }
}

function expectSha256(diagnostics, label, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(`${label} must be a lowercase sha256 hex string`);
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function requireValue(argv, index, flag) {
  if (index >= argv.length || argv[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return argv[index];
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

function relative(value) {
  return path.relative(repoRoot, value) || ".";
}

#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const defaultManifestPath = path.join(repoRoot, "research/blender-pipeline/out/manifest.json");

const expected = {
  schemaVersion: 1,
  stageId: "cheap-blender-static-tile",
  stageStatus: "prototype",
  revision: "cheap-blender-pipeline@0.1.0",
  recipe: "royal-cheap-terrain-assets@0.1.0",
  worldId: "royal-cheap-blender-world",
  tileId: "tile:cheap-blender:lod0:x0:z0",
  coordinateSystem: {
    handedness: "right-handed",
    up: "+Y",
    forward: "-Z",
    units: "meters",
  },
};

async function main() {
  const manifestPath = path.resolve(process.argv[2] ?? defaultManifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const context = {
    manifestPath,
    pipelineRoot: path.dirname(path.dirname(manifestPath)),
  };

  const diagnostics = validateBlenderManifest(manifest, context);
  if (diagnostics.length > 0) {
    console.error(JSON.stringify({ status: "failed", diagnostics }, null, 2));
    process.exitCode = 1;
    return;
  }

  const contract = toRoyalAssetManifest(manifest);
  console.log(JSON.stringify({ status: "ok", contract }, null, 2));
}

function validateBlenderManifest(manifest, context) {
  const diagnostics = [];

  expectEqual(diagnostics, "schemaVersion", manifest.schemaVersion, expected.schemaVersion);
  expectEqual(diagnostics, "worldId", manifest.worldId, expected.worldId);
  expectEqual(diagnostics, "tileId", manifest.tileId, expected.tileId);
  expectEqual(diagnostics, "revision", manifest.revision, expected.revision);
  expectEqual(diagnostics, "stage.id", manifest.stage?.id, expected.stageId);
  expectEqual(diagnostics, "stage.status", manifest.stage?.status, expected.stageStatus);
  expectEqual(diagnostics, "stage.recipe", manifest.stage?.recipe, expected.recipe);
  expectNonEmptyString(diagnostics, "stage.provenance.seed", manifest.stage?.provenance?.seed);
  expectSha256(diagnostics, "stage.provenance.inputsHash", manifest.stage?.provenance?.inputsHash);

  validateCoordinateSystem(diagnostics, manifest.coordinateSystem);
  validateBounds(diagnostics, "bounds", manifest.bounds);
  validateTerrain(diagnostics, manifest);
  validateAssets(diagnostics, manifest);
  validateArtifacts(diagnostics, manifest, context);
  if (diagnostics.length === 0) {
    validateLodIdentity(diagnostics, toRoyalAssetManifest(manifest));
  }

  return diagnostics;
}

function validateCoordinateSystem(diagnostics, coordinateSystem) {
  const asset = coordinateSystem?.asset;
  expectEqual(diagnostics, "coordinateSystem.asset.handedness", asset?.handedness, expected.coordinateSystem.handedness);
  expectEqual(diagnostics, "coordinateSystem.asset.up", asset?.up, expected.coordinateSystem.up);
  expectEqual(diagnostics, "coordinateSystem.asset.forward", asset?.forward, expected.coordinateSystem.forward);
  expectEqual(diagnostics, "coordinateSystem.asset.units", asset?.units, expected.coordinateSystem.units);
  expectEqual(diagnostics, "coordinateSystem.exporter.format", coordinateSystem?.exporter?.format, "glTF 2.0");
  expectEqual(diagnostics, "coordinateSystem.exporter.exportYUp", coordinateSystem?.exporter?.exportYUp, true);
  expectEqual(diagnostics, "coordinateSystem.sourceToAsset.x", coordinateSystem?.sourceToAsset?.x, "blender.x");
  expectEqual(diagnostics, "coordinateSystem.sourceToAsset.y", coordinateSystem?.sourceToAsset?.y, "blender.z");
  expectEqual(diagnostics, "coordinateSystem.sourceToAsset.z", coordinateSystem?.sourceToAsset?.z, "-blender.y");
}

function validateTerrain(diagnostics, manifest) {
  const terrain = manifest.terrain;
  expectEqual(diagnostics, "terrain.kind", terrain?.kind, "heightfield-mesh");
  expectEqual(diagnostics, "terrain.tileSizeMeters", terrain?.tileSizeMeters, 64);
  expectEqual(diagnostics, "terrain.segmentsPerEdge", terrain?.segmentsPerEdge, 28);
  validateBounds(diagnostics, "terrain.bounds", terrain?.bounds);

  if (terrain?.bounds && manifest.bounds) {
    for (const axis of [0, 2]) {
      if (terrain.bounds.min[axis] < manifest.bounds.min[axis] || terrain.bounds.max[axis] > manifest.bounds.max[axis]) {
        diagnostics.push(`${axisName(axis)} terrain bounds exceed global bounds`);
      }
    }
  }
}

function validateAssets(diagnostics, manifest) {
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    diagnostics.push("assets must be a non-empty array");
    return;
  }

  const seenIds = new Set();
  for (const [index, asset] of manifest.assets.entries()) {
    const prefix = `assets[${index}]`;
    expectNonEmptyString(diagnostics, `${prefix}.assetId`, asset.assetId);
    expectNonEmptyString(diagnostics, `${prefix}.kind`, asset.kind);
    expectEqual(diagnostics, `${prefix}.stage`, asset.stage, "cheap-static-fixture");
    validateBounds(diagnostics, `${prefix}.bounds`, asset.bounds);
    validateVector(diagnostics, `${prefix}.position`, asset.position);
    expectSha256(diagnostics, `${prefix}.provenance.inputsHash`, asset.provenance?.inputsHash);
    expectEqual(diagnostics, `${prefix}.provenance.recipe`, asset.provenance?.recipe, expected.recipe);
    expectNonEmptyString(diagnostics, `${prefix}.provenance.seed`, asset.provenance?.seed);

    if (seenIds.has(asset.assetId)) {
      diagnostics.push(`${prefix}.assetId duplicates ${asset.assetId}`);
    }
    seenIds.add(asset.assetId);

    if (!Array.isArray(asset.objectNames) || asset.objectNames.length === 0) {
      diagnostics.push(`${prefix}.objectNames must be a non-empty array`);
    }
  }
}

function validateArtifacts(diagnostics, manifest, context) {
  if (!Array.isArray(manifest.artifacts) || manifest.artifacts.length === 0) {
    diagnostics.push("artifacts must be a non-empty array");
    return;
  }

  const glbArtifacts = manifest.artifacts.filter((artifact) => artifact.mediaType === "model/gltf-binary");
  if (glbArtifacts.length !== 1) {
    diagnostics.push(`expected exactly one model/gltf-binary artifact, found ${glbArtifacts.length}`);
  }

  for (const [index, artifact] of manifest.artifacts.entries()) {
    const prefix = `artifacts[${index}]`;
    expectEqual(diagnostics, `${prefix}.status`, artifact.status, "written");
    expectNonEmptyString(diagnostics, `${prefix}.path`, artifact.path);
    expectNonEmptyString(diagnostics, `${prefix}.mediaType`, artifact.mediaType);
    expectPositiveInteger(diagnostics, `${prefix}.bytes`, artifact.bytes);
    expectSha256(diagnostics, `${prefix}.sha256`, artifact.sha256);

    const artifactPath = path.resolve(context.pipelineRoot, artifact.path);
    let stats;
    try {
      stats = statSync(artifactPath);
    } catch {
      diagnostics.push(`${prefix}.path missing file ${artifactPath}`);
      continue;
    }

    if (stats.size !== artifact.bytes) {
      diagnostics.push(`${prefix}.bytes expected ${artifact.bytes}, actual ${stats.size}`);
    }

    const actualHash = sha256FileSync(artifactPath);
    if (actualHash !== artifact.sha256) {
      diagnostics.push(`${prefix}.sha256 expected ${artifact.sha256}, actual ${actualHash}`);
    }
  }
}

function validateLodIdentity(diagnostics, contract) {
  expectEqual(diagnostics, "contract.lod.identityPolicy", contract.lod.identityPolicy, "stable-page-revision");
  expectEqual(diagnostics, "contract.tile.pageId", contract.tile.pageId, `${contract.tileId}:page:terrain-main`);
  expectEqual(diagnostics, "contract.tile.revision", contract.tile.revision, contract.revision);
  expectEqual(diagnostics, "contract.tile.quality", contract.tile.quality, "preview");

  for (const [index, asset] of contract.assets.entries()) {
    const prefix = `contract.assets[${index}]`;
    expectEqual(diagnostics, `${prefix}.pageId`, asset.pageId, contract.tile.pageId);
    expectEqual(diagnostics, `${prefix}.revision`, asset.revision, contract.revision);
    expectEqual(diagnostics, `${prefix}.quality`, asset.quality, "preview");
  }
}

function toRoyalAssetManifest(source) {
  const pageId = `${source.tileId}:page:terrain-main`;
  return {
    contractVersion: 1,
    worldId: source.worldId,
    tileId: source.tileId,
    revision: source.revision,
    stage: {
      id: source.stage.id,
      status: source.stage.status,
      recipe: source.stage.recipe,
      provenance: source.stage.provenance,
    },
    coordinateSystem: source.coordinateSystem,
    tile: {
      pageId,
      kind: "terrain-static-glb-page",
      terrainKind: source.terrain.kind,
      tileSizeMeters: source.terrain.tileSizeMeters,
      segmentsPerEdge: source.terrain.segmentsPerEdge,
      bounds: source.terrain.bounds,
      revision: source.revision,
      quality: "preview",
    },
    artifacts: source.artifacts.map((artifact) => ({
      role: artifact.mediaType === "model/gltf-binary" ? "renderable-glb" : "metadata",
      path: artifact.path,
      mediaType: artifact.mediaType,
      format: artifact.format,
      bytes: artifact.bytes,
      sha256: artifact.sha256,
      revision: source.revision,
      quality: "preview",
    })),
    assets: source.assets.map((asset) => ({
      assetId: asset.assetId,
      kind: asset.kind,
      pageId,
      revision: source.revision,
      quality: "preview",
      bounds: asset.bounds,
      position: asset.position,
      objectNames: asset.objectNames,
      stage: asset.stage,
      provenance: asset.provenance,
    })),
    lod: {
      identityPolicy: "stable-page-revision",
      replacement: "same pageId, newer revision or higher quality",
      previewQuality: "preview",
      finalQuality: "final",
      clientServerRule: "client cache keys use pageId; artifact content uses revision and sha256",
    },
  };
}

function validateBounds(diagnostics, label, bounds) {
  if (bounds === null || typeof bounds !== "object") {
    diagnostics.push(`${label} must be an object`);
    return;
  }

  validateVector(diagnostics, `${label}.min`, bounds.min);
  validateVector(diagnostics, `${label}.max`, bounds.max);
  validateVector(diagnostics, `${label}.center`, bounds.center);
  validateVector(diagnostics, `${label}.size`, bounds.size);

  if (!Array.isArray(bounds.min) || !Array.isArray(bounds.max) || !Array.isArray(bounds.center) || !Array.isArray(bounds.size)) {
    return;
  }

  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.min[axis] > bounds.max[axis]) {
      diagnostics.push(`${label}.${axisName(axis)} min exceeds max`);
    }

    const expectedSize = round4(bounds.max[axis] - bounds.min[axis]);
    if (Math.abs(expectedSize - bounds.size[axis]) > 0.0011) {
      diagnostics.push(`${label}.size[${axis}] expected ${expectedSize}, actual ${bounds.size[axis]}`);
    }

    const expectedCenter = round4((bounds.min[axis] + bounds.max[axis]) / 2);
    if (Math.abs(expectedCenter - bounds.center[axis]) > 0.0011) {
      diagnostics.push(`${label}.center[${axis}] expected ${expectedCenter}, actual ${bounds.center[axis]}`);
    }
  }
}

function validateVector(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 3) {
    diagnostics.push(`${label} must be a 3-number array`);
    return;
  }

  for (const [index, entry] of value.entries()) {
    if (!Number.isFinite(entry)) {
      diagnostics.push(`${label}[${index}] must be finite`);
    }
  }
}

function expectEqual(diagnostics, label, actual, wanted) {
  if (actual !== wanted) {
    diagnostics.push(`${label} expected ${JSON.stringify(wanted)}, actual ${JSON.stringify(actual)}`);
  }
}

function expectNonEmptyString(diagnostics, label, value) {
  if (typeof value !== "string" || value.length === 0) {
    diagnostics.push(`${label} must be a non-empty string`);
  }
}

function expectPositiveInteger(diagnostics, label, value) {
  if (!Number.isInteger(value) || value <= 0) {
    diagnostics.push(`${label} must be a positive integer`);
  }
}

function expectSha256(diagnostics, label, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(`${label} must be a lowercase SHA-256 hex string`);
  }
}

function sha256FileSync(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function axisName(axis) {
  return ["x", "y", "z"][axis];
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

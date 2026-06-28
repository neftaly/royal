#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(here, "fixtures");
const defaultIndexPath = path.join(fixtureRoot, "world-index.json");
const indexPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultIndexPath;

const directions = Object.freeze(["north", "east", "south", "west"]);
const opposite = Object.freeze({
  north: "south",
  east: "west",
  south: "north",
  west: "east",
});
const gridDelta = Object.freeze({
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0],
});

async function main() {
  const index = await readJson(indexPath);
  const diagnostics = validateWorldIndex(index);
  diagnostics.push(...(await validateReferencedManifests(index, path.dirname(indexPath))));

  if (diagnostics.length > 0) {
    console.error(
      JSON.stringify(
        {
          status: "failed",
          message: "offline terrain world index validation failed",
          diagnostics,
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.log(
    `offline terrain world index checked: ${index.tiles.length} tiles, ${countSeams(index.tiles)} directed seams`,
  );
}

function validateWorldIndex(index) {
  const diagnostics = [];
  expectEqual(diagnostics, "indexVersion", index.indexVersion, 1);
  expectString(diagnostics, "world.id", index.world?.id);
  expectEqual(diagnostics, "world.units", index.world?.units, "meters");
  expectEqual(diagnostics, "world.coordinateSystem.handedness", index.world?.coordinateSystem?.handedness, "right-handed");
  expectEqual(diagnostics, "world.coordinateSystem.up", index.world?.coordinateSystem?.up, "+Y");
  expectEqual(diagnostics, "world.coordinateSystem.forward", index.world?.coordinateSystem?.forward, "-Z");
  expectString(diagnostics, "world.seed", index.world?.seed);
  expectPositiveNumber(diagnostics, "tileSizeMeters", index.tileSizeMeters);
  validateHeightRange(diagnostics, "heightRangeMeters", index.heightRangeMeters);
  expectString(diagnostics, "provenance.recipe", index.provenance?.recipe);
  expectString(diagnostics, "provenance.generator.name", index.provenance?.generator?.name);
  expectString(diagnostics, "provenance.generator.version", index.provenance?.generator?.version);
  expectString(diagnostics, "provenance.generator.command", index.provenance?.generator?.command);
  expectString(diagnostics, "provenance.createdAt", index.provenance?.createdAt);
  expectString(diagnostics, "provenance.license", index.provenance?.license);

  const tiles = arrayAt(diagnostics, index.tiles, "tiles");
  const tilesById = new Map();
  const tilesByGrid = new Map();
  const pageIds = new Set();
  const manifestUris = new Set();

  for (const [tileIndex, tile] of tiles.entries()) {
    const prefix = `tiles[${tileIndex}]`;
    validateTile(diagnostics, prefix, tile, index);

    if (tile?.id) {
      if (tilesById.has(tile.id)) {
        diagnostics.push(`${prefix}.id duplicates ${tile.id}`);
      }
      tilesById.set(tile.id, tile);
    }

    if (tile?.pageId) {
      if (pageIds.has(tile.pageId)) {
        diagnostics.push(`${prefix}.pageId duplicates ${tile.pageId}`);
      }
      pageIds.add(tile.pageId);
    }

    if (tile?.manifestUri) {
      if (manifestUris.has(tile.manifestUri)) {
        diagnostics.push(`${prefix}.manifestUri duplicates ${tile.manifestUri}`);
      }
      manifestUris.add(tile.manifestUri);
    }

    if (tile?.grid) {
      const gridKey = gridKeyFor(tile.grid);
      if (tilesByGrid.has(gridKey)) {
        diagnostics.push(`${prefix}.grid duplicates ${gridKey}`);
      }
      tilesByGrid.set(gridKey, tile);
    }
  }

  validateNeighborsAndSeams(diagnostics, tiles, tilesById, tilesByGrid);

  return diagnostics;
}

function validateTile(diagnostics, prefix, tile, index) {
  expectString(diagnostics, `${prefix}.id`, tile?.id);
  expectString(diagnostics, `${prefix}.pageId`, tile?.pageId);
  expectString(diagnostics, `${prefix}.manifestUri`, tile?.manifestUri);
  expectString(diagnostics, `${prefix}.revision`, tile?.revision);
  expectOneOf(diagnostics, `${prefix}.quality`, tile?.quality, ["placeholder", "preview", "draft", "final"]);
  validateGrid(diagnostics, `${prefix}.grid`, tile?.grid);
  validateBounds(diagnostics, `${prefix}.bounds`, tile?.bounds);
  validateBoundsMatchGrid(diagnostics, prefix, tile, index.tileSizeMeters, index.heightRangeMeters);
  validateNeighborsObject(diagnostics, `${prefix}.neighbors`, tile?.neighbors);
  validateSeamsObject(diagnostics, `${prefix}.seams`, tile?.seams);
}

function validateNeighborsAndSeams(diagnostics, tiles, tilesById, tilesByGrid) {
  for (const [tileIndex, tile] of tiles.entries()) {
    const prefix = `tiles[${tileIndex}]`;
    if (!tile?.grid || !tile?.neighbors || !tile?.seams) {
      continue;
    }

    for (const direction of directions) {
      const neighborId = tile.neighbors[direction];
      const expectedNeighbor = expectedNeighborFor(tile, direction, tilesByGrid);
      const seam = tile.seams[direction];

      if (expectedNeighbor && neighborId !== expectedNeighbor.id) {
        diagnostics.push(`${prefix}.neighbors.${direction} expected ${expectedNeighbor.id}, actual ${JSON.stringify(neighborId)}`);
      }
      if (!expectedNeighbor && neighborId !== null) {
        diagnostics.push(`${prefix}.neighbors.${direction} expected null at world edge, actual ${JSON.stringify(neighborId)}`);
      }
      if (neighborId && !tilesById.has(neighborId)) {
        diagnostics.push(`${prefix}.neighbors.${direction} references missing tile ${neighborId}`);
      }
      if (!neighborId && seam) {
        diagnostics.push(`${prefix}.seams.${direction} must be absent when there is no neighbor`);
      }
      if (neighborId && !seam) {
        diagnostics.push(`${prefix}.seams.${direction} missing seam metadata for neighbor ${neighborId}`);
      }
      if (!neighborId || !seam) {
        continue;
      }

      const neighbor = tilesById.get(neighborId);
      const neighborIndex = tiles.indexOf(neighbor);
      const reverseDirection = opposite[direction];
      const reverseSeam = neighbor?.seams?.[reverseDirection];

      expectEqual(diagnostics, `${prefix}.seams.${direction}.neighborTileId`, seam.neighborTileId, neighborId);
      expectEqual(diagnostics, `${prefix}.seams.${direction}.edge`, seam.edge, direction);
      expectEqual(diagnostics, `${prefix}.seams.${direction}.neighborEdge`, seam.neighborEdge, reverseDirection);
      expectSha256(diagnostics, `${prefix}.seams.${direction}.borderHash`, seam.borderHash);
      expectPositiveNumber(diagnostics, `${prefix}.seams.${direction}.heightDeltaMaxMeters`, seam.heightDeltaMaxMeters, {
        allowZero: true,
      });
      expectPositiveNumber(diagnostics, `${prefix}.seams.${direction}.normalDeltaMaxDegrees`, seam.normalDeltaMaxDegrees, {
        allowZero: true,
      });
      validateTouchingBounds(diagnostics, prefix, tile, direction, neighbor);

      if (!neighbor) {
        continue;
      }
      if (neighbor.neighbors?.[reverseDirection] !== tile.id) {
        diagnostics.push(`tiles[${neighborIndex}].neighbors.${reverseDirection} must point back to ${tile.id}`);
      }
      if (!reverseSeam) {
        diagnostics.push(`tiles[${neighborIndex}].seams.${reverseDirection} missing reciprocal seam for ${tile.id}`);
        continue;
      }
      if (reverseSeam.neighborTileId !== tile.id) {
        diagnostics.push(`tiles[${neighborIndex}].seams.${reverseDirection}.neighborTileId must point back to ${tile.id}`);
      }
      if (reverseSeam.borderHash !== seam.borderHash) {
        diagnostics.push(`${prefix}.seams.${direction}.borderHash does not match reciprocal seam`);
      }
      if (reverseSeam.heightDeltaMaxMeters !== seam.heightDeltaMaxMeters) {
        diagnostics.push(`${prefix}.seams.${direction}.heightDeltaMaxMeters does not match reciprocal seam`);
      }
      if (reverseSeam.normalDeltaMaxDegrees !== seam.normalDeltaMaxDegrees) {
        diagnostics.push(`${prefix}.seams.${direction}.normalDeltaMaxDegrees does not match reciprocal seam`);
      }
    }
  }
}

async function validateReferencedManifests(index, root) {
  const diagnostics = [];
  const tiles = Array.isArray(index.tiles) ? index.tiles : [];

  for (const [tileIndex, tile] of tiles.entries()) {
    if (typeof tile?.manifestUri !== "string") {
      continue;
    }
    if (path.isAbsolute(tile.manifestUri) || tile.manifestUri.split(/[\\/]/).includes("..")) {
      diagnostics.push(`tiles[${tileIndex}].manifestUri must stay inside the fixture root`);
      continue;
    }

    const manifestPath = path.join(root, tile.manifestUri);
    const manifest = await readJsonIfPresent(manifestPath);
    if (!manifest) {
      continue;
    }

    const prefix = `tiles[${tileIndex}].manifest`;
    expectEqual(diagnostics, `${prefix}.world.id`, manifest.world?.id, index.world?.id);
    expectEqual(diagnostics, `${prefix}.world.seed`, manifest.world?.seed, index.world?.seed);
    expectEqual(diagnostics, `${prefix}.world.units`, manifest.world?.units, index.world?.units);
    expectEqual(diagnostics, `${prefix}.tile.id`, manifest.tile?.id, tile.id);
    expectEqual(diagnostics, `${prefix}.tile.pageId`, manifest.tile?.pageId, tile.pageId);
    expectEqual(diagnostics, `${prefix}.tile.revision`, manifest.tile?.revision, tile.revision);
    expectEqual(diagnostics, `${prefix}.tile.quality`, manifest.tile?.quality, tile.quality);
    expectJsonEqual(diagnostics, `${prefix}.tile.grid`, manifest.tile?.grid, tile.grid);
    expectJsonEqual(diagnostics, `${prefix}.tile.bounds`, manifest.tile?.bounds, tile.bounds);
  }

  return diagnostics;
}

function expectedNeighborFor(tile, direction, tilesByGrid) {
  const [xDelta, zDelta] = gridDelta[direction];
  return tilesByGrid.get(`${tile.grid.level}:${tile.grid.x + xDelta}:${tile.grid.z + zDelta}`);
}

function validateBoundsMatchGrid(diagnostics, prefix, tile, tileSizeMeters, heightRangeMeters) {
  if (!tile?.grid || !tile?.bounds || typeof tileSizeMeters !== "number") {
    return;
  }
  const expectedMinX = -tileSizeMeters / 2 + tile.grid.x * tileSizeMeters;
  const expectedMaxX = expectedMinX + tileSizeMeters;
  const expectedMinZ = -tileSizeMeters / 2 + tile.grid.z * tileSizeMeters;
  const expectedMaxZ = expectedMinZ + tileSizeMeters;

  expectEqual(diagnostics, `${prefix}.bounds.min[0]`, tile.bounds.min?.[0], expectedMinX);
  expectEqual(diagnostics, `${prefix}.bounds.max[0]`, tile.bounds.max?.[0], expectedMaxX);
  expectEqual(diagnostics, `${prefix}.bounds.min[2]`, tile.bounds.min?.[2], expectedMinZ);
  expectEqual(diagnostics, `${prefix}.bounds.max[2]`, tile.bounds.max?.[2], expectedMaxZ);

  if (Array.isArray(heightRangeMeters) && heightRangeMeters.length === 2) {
    expectEqual(diagnostics, `${prefix}.bounds.min[1]`, tile.bounds.min?.[1], heightRangeMeters[0]);
    expectEqual(diagnostics, `${prefix}.bounds.max[1]`, tile.bounds.max?.[1], heightRangeMeters[1]);
  }
}

function validateTouchingBounds(diagnostics, prefix, tile, direction, neighbor) {
  if (!tile?.bounds || !neighbor?.bounds) {
    return;
  }
  if (direction === "east" || direction === "west") {
    const ownEdge = direction === "east" ? tile.bounds.max[0] : tile.bounds.min[0];
    const neighborEdge = direction === "east" ? neighbor.bounds.min[0] : neighbor.bounds.max[0];
    expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.x`, ownEdge, neighborEdge);
    expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.minZ`, tile.bounds.min[2], neighbor.bounds.min[2]);
    expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.maxZ`, tile.bounds.max[2], neighbor.bounds.max[2]);
    return;
  }

  const ownEdge = direction === "south" ? tile.bounds.max[2] : tile.bounds.min[2];
  const neighborEdge = direction === "south" ? neighbor.bounds.min[2] : neighbor.bounds.max[2];
  expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.z`, ownEdge, neighborEdge);
  expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.minX`, tile.bounds.min[0], neighbor.bounds.min[0]);
  expectEqual(diagnostics, `${prefix}.seams.${direction}.bounds.maxX`, tile.bounds.max[0], neighbor.bounds.max[0]);
}

function validateGrid(diagnostics, label, grid) {
  if (!grid || !Number.isInteger(grid.x) || !Number.isInteger(grid.z) || !Number.isInteger(grid.level) || grid.level < 0) {
    diagnostics.push(`${label} must have integer x/z and non-negative integer level`);
  }
}

function validateBounds(diagnostics, label, bounds) {
  if (!bounds || !Array.isArray(bounds.min) || !Array.isArray(bounds.max)) {
    diagnostics.push(`${label} must have min/max vectors`);
    return;
  }
  validateVector3(diagnostics, `${label}.min`, bounds.min);
  validateVector3(diagnostics, `${label}.max`, bounds.max);
  for (let axis = 0; axis < 3; axis += 1) {
    if (bounds.min[axis] > bounds.max[axis]) {
      diagnostics.push(`${label}.min[${axis}] exceeds max`);
    }
  }
}

function validateHeightRange(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => typeof entry !== "number")) {
    diagnostics.push(`${label} must be a numeric [min, max] pair`);
    return;
  }
  if (value[0] > value[1]) {
    diagnostics.push(`${label}[0] must be <= ${label}[1]`);
  }
}

function validateVector3(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== "number")) {
    diagnostics.push(`${label} must be a numeric vec3`);
  }
}

function validateNeighborsObject(diagnostics, label, neighbors) {
  if (!neighbors || typeof neighbors !== "object" || Array.isArray(neighbors)) {
    diagnostics.push(`${label} must be an object`);
    return;
  }
  for (const direction of directions) {
    if (!(direction in neighbors)) {
      diagnostics.push(`${label}.${direction} is required`);
      continue;
    }
    const value = neighbors[direction];
    if (value !== null && (typeof value !== "string" || value.length === 0)) {
      diagnostics.push(`${label}.${direction} must be a tile id string or null`);
    }
  }
}

function validateSeamsObject(diagnostics, label, seams) {
  if (!seams || typeof seams !== "object" || Array.isArray(seams)) {
    diagnostics.push(`${label} must be an object`);
    return;
  }
  for (const edge of Object.keys(seams)) {
    if (!directions.includes(edge)) {
      diagnostics.push(`${label}.${edge} is not a valid edge`);
    }
  }
}

function countSeams(tiles) {
  return tiles.reduce((count, tile) => count + Object.keys(tile.seams ?? {}).length, 0);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function readJsonIfPresent(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function arrayAt(diagnostics, value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    diagnostics.push(`${label} must be a non-empty array`);
    return [];
  }
  return value;
}

function gridKeyFor(grid) {
  return `${grid.level}:${grid.x}:${grid.z}`;
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

function expectJsonEqual(diagnostics, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    diagnostics.push(`${label} expected ${JSON.stringify(expected)}, actual ${JSON.stringify(actual)}`);
  }
}

function expectOneOf(diagnostics, label, actual, expected) {
  if (!expected.includes(actual)) {
    diagnostics.push(`${label} expected one of ${expected.join(", ")}, actual ${JSON.stringify(actual)}`);
  }
}

function expectSha256(diagnostics, label, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(`${label} must be a lowercase sha256 hex string`);
  }
}

function expectPositiveNumber(diagnostics, label, value, options = {}) {
  const minimum = options.allowZero ? 0 : Number.MIN_VALUE;
  if (typeof value !== "number" || value < minimum) {
    diagnostics.push(`${label} must be a number >= ${minimum}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

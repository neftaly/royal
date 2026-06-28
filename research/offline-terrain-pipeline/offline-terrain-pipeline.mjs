#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(here, "sample-output");
const fixtureManifestPath = path.join(here, "fixtures/sample-manifest.json");

const config = Object.freeze({
  worldId: "royal-offline-terrain-demo",
  tileId: "tile:offline-terrain-demo:lod0:x0:z0",
  pageId: "tile:offline-terrain-demo:lod0:x0:z0:page:terrain-main",
  seed: "royal:offline-terrain:demo:001",
  revision: "offline-terrain-pipeline@0.1.0+fixture",
  recipe: "royal-offline-terrain-fixture@0.1.0",
  createdAt: "2026-06-28T00:00:00.000Z",
});

const args = new Set(process.argv.slice(2));
const mode = args.has("--write") ? "write" : "check";

async function main() {
  const fixture = await readJson(fixtureManifestPath);
  const fixtureDiagnostics = validateManifestShape(fixture, {
    checkArtifactFiles: false,
    root: path.dirname(fixtureManifestPath),
  });

  if (fixtureDiagnostics.length > 0) {
    fail("committed fixture manifest is invalid", fixtureDiagnostics);
  }

  const artifacts = buildSampleArtifacts();
  const manifest = buildManifest(artifacts);
  artifacts.set("manifest.json", jsonBuffer(manifest));

  if (mode === "write") {
    await writeArtifacts(artifacts);
    console.log(
      `offline terrain sample generated: ${artifacts.size} files in ${relative(outputRoot)}`,
    );
    return;
  }

  const generatedManifestPath = path.join(outputRoot, "manifest.json");
  const generatedManifest = await readJson(generatedManifestPath);
  const diagnostics = [
    ...validateManifestShape(generatedManifest, {
      checkArtifactFiles: true,
      root: outputRoot,
    }),
    ...(await compareGeneratedArtifacts(artifacts)),
  ];

  if (diagnostics.length > 0) {
    fail("offline terrain sample check failed", diagnostics);
  }

  console.log(
    `offline terrain sample checked: ${generatedManifest.meshes.length} mesh, ${generatedManifest.materialTextures.length} textures, ${generatedManifest.previews.length} preview`,
  );
}

function buildSampleArtifacts() {
  const artifacts = new Map();
  const glb = buildPlaceholderGlb({
    name: "royal-offline-terrain-demo-lod0",
    tileId: config.tileId,
    pageId: config.pageId,
    bounds: sampleBounds(),
    note: "placeholder GLB container; replace with Blender/Infinigen export",
  });
  const albedo = encodePng(1, 1, Buffer.from([96, 132, 72, 255]));
  const normal = encodePng(1, 1, Buffer.from([128, 128, 255, 255]));
  const mask = encodePng(1, 1, Buffer.from([180, 90, 24, 255]));
  const preview = encodePng(1, 1, Buffer.from([118, 150, 92, 255]));
  const ktxSlot = jsonBuffer({
    slot: "albedo",
    intendedFormat: "ktx2-basis-uastc",
    source: "textures/albedo-lod0.png",
    dimensions: [1, 1],
    note: "POC placeholder for a later compressed texture artifact",
  });
  const report = jsonBuffer({
    status: "placeholder",
    vertexCount: 4,
    indexCount: 6,
    renderer: "node-only",
    diagnostics: [
      "No Blender or GPU was used.",
      "Replace these files with high-quality offline artifacts later.",
    ],
  });

  artifacts.set("meshes/tile-lod0.glb", glb);
  artifacts.set("textures/albedo-lod0.png", albedo);
  artifacts.set("textures/normal-lod0.png", normal);
  artifacts.set("textures/material-mask-lod0.png", mask);
  artifacts.set("textures/albedo-lod0.ktx2.placeholder.json", ktxSlot);
  artifacts.set("previews/tile-lod0-preview.png", preview);
  artifacts.set("reports/build-report.json", report);

  return artifacts;
}

function buildManifest(artifacts) {
  const revision = config.revision;
  return {
    manifestVersion: 1,
    world: {
      id: config.worldId,
      coordinateSystem: {
        handedness: "right-handed",
        up: "+Y",
        forward: "-Z",
      },
      units: "meters",
      seed: config.seed,
    },
    tile: {
      id: config.tileId,
      pageId: config.pageId,
      bounds: sampleBounds(),
      sizeMeters: 64,
      heightRangeMeters: [-1, 5],
      grid: {
        x: 0,
        z: 0,
        level: 0,
      },
      revision,
      quality: "placeholder",
    },
    lod: {
      identityPolicy: "stable-tile-page-revision",
      levels: [
        {
          id: "lod0-placeholder",
          level: 0,
          screenSpaceError: 12,
          mesh: "mesh.tile-lod0.glb",
          textures: [
            "texture.albedo-lod0.png",
            "texture.normal-lod0.png",
            "texture.material-mask-lod0.png",
            "texture.albedo-lod0.ktx2-placeholder",
          ],
          preview: "preview.tile-lod0.thumbnail",
          quality: "placeholder",
        },
      ],
    },
    meshes: [
      artifactRecord(artifacts, "mesh.tile-lod0.glb", "meshes/tile-lod0.glb", {
        mediaType: "model/gltf-binary",
        format: "glb2-placeholder",
        bounds: sampleBounds(),
        vertexCount: 4,
        indexCount: 6,
        sourceStage: "node-fixture",
      }),
    ],
    materialTextures: [
      textureRecord(artifacts, "texture.albedo-lod0.png", "textures/albedo-lod0.png", {
        slot: "albedo",
        colorSpace: "srgb",
      }),
      textureRecord(artifacts, "texture.normal-lod0.png", "textures/normal-lod0.png", {
        slot: "normal",
        colorSpace: "linear",
      }),
      textureRecord(artifacts, "texture.material-mask-lod0.png", "textures/material-mask-lod0.png", {
        slot: "material-mask",
        colorSpace: "data",
      }),
      textureRecord(
        artifacts,
        "texture.albedo-lod0.ktx2-placeholder",
        "textures/albedo-lod0.ktx2.placeholder.json",
        {
          slot: "albedo",
          colorSpace: "srgb",
          mediaType: "application/json",
          format: "ktx2-basis-uastc-slot",
        },
      ),
    ],
    previews: [
      {
        ...artifactRecord(
          artifacts,
          "preview.tile-lod0.thumbnail",
          "previews/tile-lod0-preview.png",
          {
            mediaType: "image/png",
            format: "png-rgba8",
          },
        ),
        role: "thumbnail",
        dimensions: [1, 1],
      },
    ],
    reports: [
      artifactRecord(artifacts, "report.build", "reports/build-report.json", {
        mediaType: "application/json",
        format: "json",
      }),
    ],
    provenance: {
      recipe: config.recipe,
      generator: {
        name: "offline-terrain-pipeline.mjs",
        version: "0.1.0",
        command: "node research/offline-terrain-pipeline/offline-terrain-pipeline.mjs --write",
      },
      source: {
        kind: "fixture",
        uri: "research/offline-terrain-pipeline/fixtures/sample-manifest.json",
        revision: "offline-terrain-pipeline@0.1.0",
      },
      inputsHash: sha256(Buffer.from(`${config.worldId}\n${config.tileId}\n${config.seed}\n`)),
      createdAt: config.createdAt,
      machine: "node-only",
      license: "AGPL-3.0-only",
    },
  };

  function artifactRecord(sourceArtifacts, id, uri, overrides = {}) {
    const bytes = sourceArtifacts.get(uri);
    if (!bytes) {
      throw new Error(`missing generated bytes for ${uri}`);
    }
    return {
      id,
      uri,
      mediaType: overrides.mediaType ?? "application/octet-stream",
      format: overrides.format ?? "unknown",
      bytes: bytes.length,
      sha256: sha256(bytes),
      revision,
      quality: "placeholder",
      ...without(overrides, ["mediaType", "format"]),
    };
  }

  function textureRecord(sourceArtifacts, id, uri, options) {
    return {
      ...artifactRecord(sourceArtifacts, id, uri, {
        mediaType: options.mediaType ?? "image/png",
        format: options.format ?? "png-rgba8",
      }),
      slot: options.slot,
      dimensions: [1, 1],
      colorSpace: options.colorSpace,
    };
  }
}

function validateManifestShape(manifest, options) {
  const diagnostics = [];
  expectEqual(diagnostics, "manifestVersion", manifest.manifestVersion, 1);
  expectString(diagnostics, "world.id", manifest.world?.id);
  expectEqual(diagnostics, "world.units", manifest.world?.units, "meters");
  expectEqual(diagnostics, "world.coordinateSystem.handedness", manifest.world?.coordinateSystem?.handedness, "right-handed");
  expectEqual(diagnostics, "world.coordinateSystem.up", manifest.world?.coordinateSystem?.up, "+Y");
  expectEqual(diagnostics, "world.coordinateSystem.forward", manifest.world?.coordinateSystem?.forward, "-Z");
  expectString(diagnostics, "world.seed", manifest.world?.seed);
  expectString(diagnostics, "tile.id", manifest.tile?.id);
  expectString(diagnostics, "tile.pageId", manifest.tile?.pageId);
  expectString(diagnostics, "tile.revision", manifest.tile?.revision);
  expectOneOf(diagnostics, "tile.quality", manifest.tile?.quality, ["placeholder", "preview", "draft", "final"]);
  expectPositiveNumber(diagnostics, "tile.sizeMeters", manifest.tile?.sizeMeters);
  validateBounds(diagnostics, "tile.bounds", manifest.tile?.bounds);
  expectEqual(diagnostics, "lod.identityPolicy", manifest.lod?.identityPolicy, "stable-tile-page-revision");

  const allArtifacts = [
    ...arrayAt(diagnostics, manifest.meshes, "meshes"),
    ...arrayAt(diagnostics, manifest.materialTextures, "materialTextures"),
    ...arrayAt(diagnostics, manifest.previews, "previews"),
    ...(manifest.reports ?? []),
  ];
  const artifactIds = new Set();
  const artifactUris = new Set();

  for (const [index, artifact] of allArtifacts.entries()) {
    const prefix = `artifact[${index}]`;
    expectString(diagnostics, `${prefix}.id`, artifact?.id);
    expectString(diagnostics, `${prefix}.uri`, artifact?.uri);
    expectString(diagnostics, `${prefix}.mediaType`, artifact?.mediaType);
    expectString(diagnostics, `${prefix}.format`, artifact?.format);
    expectPositiveInteger(diagnostics, `${prefix}.bytes`, artifact?.bytes);
    expectSha256(diagnostics, `${prefix}.sha256`, artifact?.sha256);
    expectEqual(diagnostics, `${prefix}.revision`, artifact?.revision, manifest.tile?.revision);

    if (artifact?.id) {
      if (artifactIds.has(artifact.id)) {
        diagnostics.push(`${prefix}.id duplicates ${artifact.id}`);
      }
      artifactIds.add(artifact.id);
    }

    if (artifact?.uri) {
      if (artifactUris.has(artifact.uri)) {
        diagnostics.push(`${prefix}.uri duplicates ${artifact.uri}`);
      }
      artifactUris.add(artifact.uri);
    }
  }

  for (const mesh of arrayAt(diagnostics, manifest.meshes, "meshes")) {
    if (mesh.mediaType !== "model/gltf-binary" && mesh.mediaType !== "model/gltf+json") {
      diagnostics.push(`mesh ${mesh.id} must use glTF/GLB media type`);
    }
    validateBounds(diagnostics, `mesh ${mesh.id}.bounds`, mesh.bounds);
    expectPositiveInteger(diagnostics, `mesh ${mesh.id}.vertexCount`, mesh.vertexCount);
    expectPositiveInteger(diagnostics, `mesh ${mesh.id}.indexCount`, mesh.indexCount);
  }

  for (const texture of arrayAt(diagnostics, manifest.materialTextures, "materialTextures")) {
    expectOneOf(diagnostics, `texture ${texture.id}.slot`, texture.slot, [
      "albedo",
      "normal",
      "roughness",
      "height",
      "material-mask",
    ]);
    validateDimensions(diagnostics, `texture ${texture.id}.dimensions`, texture.dimensions);
  }

  for (const preview of arrayAt(diagnostics, manifest.previews, "previews")) {
    expectOneOf(diagnostics, `preview ${preview.id}.role`, preview.role, [
      "thumbnail",
      "orbit-render",
      "debug-overlay",
      "contact-sheet",
    ]);
    validateDimensions(diagnostics, `preview ${preview.id}.dimensions`, preview.dimensions);
  }

  const lodLevels = arrayAt(diagnostics, manifest.lod?.levels, "lod.levels");
  for (const [index, lod] of lodLevels.entries()) {
    const prefix = `lod.levels[${index}]`;
    expectString(diagnostics, `${prefix}.id`, lod?.id);
    expectPositiveInteger(diagnostics, `${prefix}.level`, lod?.level, { allowZero: true });
    expectPositiveNumber(diagnostics, `${prefix}.screenSpaceError`, lod?.screenSpaceError, {
      allowZero: true,
    });
    if (!artifactIds.has(lod?.mesh)) {
      diagnostics.push(`${prefix}.mesh references missing artifact ${lod?.mesh}`);
    }
    if (!artifactIds.has(lod?.preview)) {
      diagnostics.push(`${prefix}.preview references missing artifact ${lod?.preview}`);
    }
    for (const textureId of arrayAt(diagnostics, lod?.textures, `${prefix}.textures`)) {
      if (!artifactIds.has(textureId)) {
        diagnostics.push(`${prefix}.textures references missing artifact ${textureId}`);
      }
    }
  }

  expectString(diagnostics, "provenance.recipe", manifest.provenance?.recipe);
  expectString(diagnostics, "provenance.generator.name", manifest.provenance?.generator?.name);
  expectString(diagnostics, "provenance.generator.version", manifest.provenance?.generator?.version);
  expectString(diagnostics, "provenance.generator.command", manifest.provenance?.generator?.command);
  expectString(diagnostics, "provenance.source.kind", manifest.provenance?.source?.kind);
  expectString(diagnostics, "provenance.source.uri", manifest.provenance?.source?.uri);
  expectSha256(diagnostics, "provenance.inputsHash", manifest.provenance?.inputsHash);
  expectString(diagnostics, "provenance.createdAt", manifest.provenance?.createdAt);

  if (options.checkArtifactFiles) {
    diagnostics.push(...validateArtifactFiles(allArtifacts, options.root));
  }

  return diagnostics;
}

function validateArtifactFiles(artifacts, root) {
  const diagnostics = [];
  for (const artifact of artifacts) {
    const artifactPath = path.join(root, artifact.uri);
    const bytes = readFileSyncSafe(artifactPath);
    if (!bytes) {
      diagnostics.push(`${artifact.id} missing ${relative(artifactPath)}`);
      continue;
    }
    if (bytes.length !== artifact.bytes) {
      diagnostics.push(`${artifact.id} bytes expected ${artifact.bytes}, actual ${bytes.length}`);
    }
    const actualHash = sha256(bytes);
    if (actualHash !== artifact.sha256) {
      diagnostics.push(`${artifact.id} sha256 expected ${artifact.sha256}, actual ${actualHash}`);
    }
  }
  return diagnostics;
}

async function compareGeneratedArtifacts(expectedArtifacts) {
  const diagnostics = [];
  for (const [uri, expected] of expectedArtifacts) {
    const actualPath = path.join(outputRoot, uri);
    let actual;
    try {
      actual = await readFile(actualPath);
    } catch {
      diagnostics.push(`generated file missing ${relative(actualPath)}; run with --write first`);
      continue;
    }
    if (!actual.equals(expected)) {
      diagnostics.push(`generated file differs from deterministic output: ${relative(actualPath)}`);
    }
  }

  try {
    await stat(path.join(outputRoot, "manifest.json"));
  } catch {
    diagnostics.push(`generated file missing ${relative(path.join(outputRoot, "manifest.json"))}; run with --write first`);
  }

  return diagnostics;
}

async function writeArtifacts(artifacts) {
  for (const [uri, bytes] of artifacts) {
    const target = path.join(outputRoot, uri);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

function buildPlaceholderGlb(extras) {
  const gltf = {
    asset: {
      version: "2.0",
      generator: "royal offline-terrain-pipeline node fixture",
    },
    scene: 0,
    scenes: [{ name: "placeholder terrain tile", nodes: [] }],
    extras,
  };
  const json = Buffer.from(`${JSON.stringify(gltf)} `, "utf8");
  const paddedJson = pad4(json, 0x20);
  const totalLength = 12 + 8 + paddedJson.length;
  const glb = Buffer.alloc(totalLength);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(totalLength, 8);
  glb.writeUInt32LE(paddedJson.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(glb, 20);
  return glb;
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const scanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * stride;
    const targetOffset = y * (stride + 1);
    scanlines[targetOffset] = 0;
    rgba.copy(scanlines, targetOffset + 1, sourceOffset, sourceOffset + stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(width, height)),
    pngChunk("IDAT", deflateSync(scanlines, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function ihdr(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;
  return header;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pad4(bytes, fill) {
  const remainder = bytes.length % 4;
  if (remainder === 0) {
    return bytes;
  }
  return Buffer.concat([bytes, Buffer.alloc(4 - remainder, fill)]);
}

function sampleBounds() {
  return {
    min: [-32, -1, -32],
    max: [32, 5, 32],
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function readFileSyncSafe(filePath) {
  try {
    return readFileSync(filePath);
  } catch {
    return undefined;
  }
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
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

function validateVector3(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== "number")) {
    diagnostics.push(`${label} must be a numeric vec3`);
  }
}

function validateDimensions(diagnostics, label, value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((entry) => !Number.isInteger(entry) || entry < 1)) {
    diagnostics.push(`${label} must be two positive integers`);
  }
}

function arrayAt(diagnostics, value, label) {
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

function expectSha256(diagnostics, label, value) {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    diagnostics.push(`${label} must be a lowercase sha256 hex string`);
  }
}

function expectPositiveInteger(diagnostics, label, value, options = {}) {
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

function without(value, keys) {
  const copy = { ...value };
  for (const key of keys) {
    delete copy[key];
  }
  return copy;
}

function relative(filePath) {
  return path.relative(path.join(here, "../.."), filePath);
}

function fail(message, diagnostics) {
  console.error(JSON.stringify({ status: "failed", message, diagnostics }, null, 2));
  process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

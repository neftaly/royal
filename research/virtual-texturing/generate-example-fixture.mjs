#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(here, "demo-assets");
const outputPath = path.join(assetsRoot, "example-fixture.json");
const mode = process.argv.includes("--check") ? "check" : "write";

async function main() {
  const manifestPath = path.join(assetsRoot, "manifest.json");
  const manifest = await readJson(manifestPath);
  const stats = await readJson(path.join(assetsRoot, manifest.stats.uri));

  await verifyManifestReferences(manifest);

  const fixture = buildFixture({
    manifest,
    manifestSha256: await fileSha256(manifestPath),
    stats,
  });
  const bytes = jsonBuffer(fixture);

  if (mode === "check") {
    await checkOutput(bytes);
    console.log(
      `virtual texturing example fixture checked: ${fixture.example.route}, ${fixture.assets.previewAssets.length} previews`,
    );
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);
  console.log(
    `virtual texturing example fixture generated: ${fixture.example.route}, ${fixture.assets.previewAssets.length} previews`,
  );
}

function buildFixture({ manifest, manifestSha256, stats }) {
  const overview = manifest.previews.find((preview) => preview.role === "virtual-material-overview");
  const overlay = manifest.previews.find((preview) => preview.role === "page-cache-debug-overlay");
  if (!overview) throw new Error("manifest is missing virtual-material-overview preview");
  if (!overlay) throw new Error("manifest is missing page-cache-debug-overlay preview");

  return {
    contractVersion: 1,
    generatedFrom: {
      manifestUri: "manifest.json",
      manifestSha256,
      statsUri: manifest.stats.uri,
      statsSha256: manifest.stats.sha256,
      generator: "research/virtual-texturing/generate-example-fixture.mjs",
    },
    example: {
      route: "/labs/virtual-texturing",
      catalogId: "virtual-texturing-terrain",
      title: "Virtual Texturing Terrain",
      section: "labs-prototypes",
      sourceFile: "apps/examples-react/src/examples/cases/VirtualTexturingTerrain.tsx",
      sourceExport: "VirtualTexturingTerrain",
      mode: "research-fixture-preview",
      rendererStatus: "Research fixture preview; renderer VT hooks are not active in this route.",
      visualSurfaceNow: "image-svg-preview",
      visualSurfaceAfterRendererHooks: "canvas",
    },
    assets: {
      sourceRoot: "research/virtual-texturing/demo-assets",
      suggestedPublicRoot: "apps/examples-react/public/virtual-texturing",
      manifestUri: "manifest.json",
      statsUri: manifest.stats.uri,
      overviewPreviewUri: overview.uri,
      cacheOverlayPreviewUri: overlay.uri,
      previewAssets: [
        {
          role: overview.role,
          uri: overview.uri,
          width: overview.width,
          height: overview.height,
          sha256: overview.sha256,
        },
        {
          role: overlay.role,
          uri: overlay.uri,
          width: overlay.width,
          height: overlay.height,
          sha256: overlay.sha256,
        },
      ],
      optionalPageSet: {
        includeInSimpleExample: false,
        pageCount: manifest.pages.length,
        reason: "The menu/preview/source prototype only needs compact previews and stats.",
      },
    },
    virtualTexture: {
      assetId: manifest.assetId,
      dimensions: manifest.virtualTexture.dimensions,
      usableTileSize: manifest.virtualTexture.usableTileSize,
      borderTexels: manifest.virtualTexture.borderTexels,
      paddedTileSize: manifest.virtualTexture.paddedTileSize,
      mipCount: manifest.virtualTexture.mipCount,
      colorSpace: manifest.virtualTexture.colorSpace,
      sampler: manifest.virtualTexture.sampler,
      variant: manifest.variants[0],
      demoBudget: manifest.demoBudget,
      seamSafety: manifest.seamSafety,
    },
    statsSummary: {
      frameCount: stats.frames.length,
      exactHitRatio: stats.summary.exactHitRatio,
      fallbackRatio: stats.summary.fallbackRatio,
      averageUploads: stats.summary.averageUploads,
      maxUploads: stats.summary.maxUploads,
      averageUploadBytes: stats.summary.averageUploadBytes,
      averageEstimatedUploadMs: stats.summary.averageEstimatedUploadMs,
      totalEvictions: stats.summary.totalEvictions,
      averagePageTableUpdates: stats.summary.averagePageTableUpdates,
      maxQueuedPages: stats.summary.maxQueuedPages,
      maxSeamCandidates: stats.summary.maxSeamCandidates,
      physicalSlots: stats.budget.physicalSlots,
      maxUploadsPerFrame: stats.budget.maxUploadsPerFrame,
    },
    acceptance: [
      {
        id: "route.catalog",
        text: "Route /labs/virtual-texturing appears in the examples menu with title Virtual Texturing Terrain.",
        evidence: "examples app route smoke",
      },
      {
        id: "preview.overview",
        text: "Terrain overview preview renders without distortion at desktop and mobile widths.",
        evidence: overview.uri,
      },
      {
        id: "preview.overlay",
        text: "Cache/debug overlay preview is visible and legible.",
        evidence: overlay.uri,
      },
      {
        id: "stats.fixture",
        text: "Fixture stats are shown for hit ratio, uploads, evictions, dirty page-table entries, and seam candidates.",
        evidence: manifest.stats.uri,
      },
      {
        id: "honesty.no-live-vt",
        text: "Route states that renderer VT hooks are not active and does not claim live page-table sampling.",
        evidence: "rendererStatus",
      },
      {
        id: "api.no-public-node",
        text: "Source does not reference or introduce a public VirtualTextureNode.",
        evidence: "source review",
      },
    ],
    migration: {
      keepStable: [
        "route",
        "catalogId",
        "title",
        "asset manifest shape",
        "material resource shape",
      ],
      replaceWhenRendererHooksExist: [
        "static preview images",
        "fixture-derived stats",
      ],
      privateRendererHooksRequired: [
        "page table texture allocation and dirty texel updates",
        "physical page cache atlas and border-padded uploads",
        "resident fallback lookup from exact page to parent mip",
        "upload budget and eviction scheduler",
        "renderer-produced stats and debug overlay rows",
        "fixed low-mip fallback for unsupported capabilities",
      ],
      publicApiBoundary: "Keep virtual texturing as asset/material resources. Do not add public algorithm nodes.",
    },
  };
}

async function verifyManifestReferences(manifest) {
  for (const page of manifest.pages) {
    await verifySha(path.join(assetsRoot, page.uri), page.sha256);
  }
  for (const preview of manifest.previews) {
    await verifySha(path.join(assetsRoot, preview.uri), preview.sha256);
  }
  await verifySha(path.join(assetsRoot, manifest.stats.uri), manifest.stats.sha256);
}

async function verifySha(filePath, expected) {
  const actual = await fileSha256(filePath);
  if (actual !== expected) {
    throw new Error(`${path.relative(here, filePath)} sha256 mismatch: expected ${expected}, got ${actual}`);
  }
}

async function checkOutput(expected) {
  let actual;
  try {
    actual = await readFile(outputPath);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("example-fixture.json is missing");
    }
    throw error;
  }
  if (!actual.equals(expected)) {
    throw new Error("example-fixture.json differs");
  }
}

async function fileSha256(filePath) {
  return sha256(await readFile(filePath));
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

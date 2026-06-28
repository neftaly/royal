#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const here = path.dirname(fileURLToPath(import.meta.url));
const outputRoot = path.join(here, "demo-assets");

const config = Object.freeze({
  assetId: "royal.generated-terrain-material.vt-demo",
  recipe: "virtual-terrain-pages@0.1.0",
  seed: 0x726f7961,
  virtualSize: 128,
  usableTileSize: 32,
  borderTexels: 4,
  mipCount: 3,
  bytesPerTexel: 4,
  cacheSlots: 12,
  maxUploadsPerFrame: 4,
  uploadBandwidthBytesPerMs: 560 * 1024,
  uploadOverheadMs: 0.028,
});

const mode = process.argv.includes("--check") ? "check" : "write";
const paddedTileSize = config.usableTileSize + config.borderTexels * 2;
const bytesPerPage = paddedTileSize * paddedTileSize * config.bytesPerTexel;

async function main() {
  const pages = buildPages();
  const seamReport = checkSeamSafety(pages);
  const streaming = buildStreamingStats(pages, seamReport);
  const artifacts = buildArtifacts({ pages, seamReport, streaming });

  if (mode === "check") {
    await checkArtifacts(artifacts);
    console.log(
      `virtual texturing demo assets checked: ${pages.length} pages, ${seamReport.pixelComparisons} seam comparisons`,
    );
    return;
  }

  await writeArtifacts(artifacts);
  console.log(
    `virtual texturing demo assets generated: ${pages.length} pages, ${seamReport.pixelComparisons} seam comparisons`,
  );
}

function buildPages() {
  const pages = [];

  for (let mip = 0; mip < config.mipCount; mip += 1) {
    const axis = pagesPerAxisAtMip(mip);
    for (let y = 0; y < axis; y += 1) {
      for (let x = 0; x < axis; x += 1) {
        const rgba = createImage(paddedTileSize, paddedTileSize);
        for (let py = 0; py < paddedTileSize; py += 1) {
          for (let px = 0; px < paddedTileSize; px += 1) {
            const mipX = x * config.usableTileSize + px - config.borderTexels;
            const mipY = y * config.usableTileSize + py - config.borderTexels;
            const worldScale = 1 << mip;
            setPixel(
              rgba,
              paddedTileSize,
              px,
              py,
              sampleTerrainMaterial(mipX * worldScale, mipY * worldScale, mip),
            );
          }
        }

        const uri = `pages/mip-${mip}/x${x}-y${y}.png`;
        const png = encodePng(paddedTileSize, paddedTileSize, rgba);
        pages.push({
          id: pageId(mip, x, y),
          mip,
          x,
          y,
          uri,
          width: paddedTileSize,
          height: paddedTileSize,
          rgba,
          png,
          sha256: sha256(png),
          averageColor: averageColor(rgba),
          sourceRectVirtual: [
            x * config.usableTileSize * (1 << mip),
            y * config.usableTileSize * (1 << mip),
            config.usableTileSize * (1 << mip),
            config.usableTileSize * (1 << mip),
          ],
        });
      }
    }
  }

  return pages;
}

function buildArtifacts({ pages, seamReport, streaming }) {
  const outputs = new Map();
  const overview = buildOverviewPng();
  const overlay = buildOverlaySvg(streaming);
  const manifest = buildManifest({ pages, seamReport, streaming, overview, overlay });

  outputs.set("manifest.json", jsonBuffer(manifest));
  outputs.set("stats/camera-pan-stream.json", jsonBuffer(streaming));
  outputs.set("preview/terrain-pages-overview.png", overview.png);
  outputs.set("preview/page-cache-debug-overlay.svg", Buffer.from(overlay.svg, "utf8"));

  for (const page of pages) {
    outputs.set(page.uri, page.png);
  }

  return outputs;
}

function buildManifest({ pages, seamReport, streaming, overview, overlay }) {
  return {
    contractVersion: 1,
    assetId: config.assetId,
    stage: {
      status: "research-demo",
      recipe: config.recipe,
      seed: `0x${config.seed.toString(16)}`,
      purpose: "first polished virtual-texturing demo slice",
    },
    virtualTexture: {
      dimensions: [config.virtualSize, config.virtualSize],
      usableTileSize: config.usableTileSize,
      borderTexels: config.borderTexels,
      paddedTileSize,
      mipCount: config.mipCount,
      colorSpace: "srgb",
      channelMeaning: {
        rgb: "generated terrain albedo",
        a: "opaque preview channel",
      },
      sampler: {
        wrapS: "repeat",
        wrapT: "repeat",
        minFilter: "linear-mipmap-linear",
        magFilter: "linear",
      },
    },
    variants: [
      {
        id: "png-rgba8-dev",
        format: "png-rgba8",
        uriTemplate: "pages/mip-{mip}/x{x}-y{y}.png",
        bytesPerDecodedPage: bytesPerPage,
      },
    ],
    demoBudget: {
      cacheSlots: config.cacheSlots,
      maxUploadsPerFrame: config.maxUploadsPerFrame,
      maxUploadBytesPerFrame: config.maxUploadsPerFrame * bytesPerPage,
      estimatedUploadBandwidthBytesPerMs: config.uploadBandwidthBytesPerMs,
    },
    seamSafety: seamReport,
    pages: pages.map((page) => ({
      id: page.id,
      mip: page.mip,
      x: page.x,
      y: page.y,
      uri: page.uri,
      width: page.width,
      height: page.height,
      usableRect: [
        config.borderTexels,
        config.borderTexels,
        config.usableTileSize,
        config.usableTileSize,
      ],
      sourceRectVirtual: page.sourceRectVirtual,
      averageColor: page.averageColor,
      sha256: page.sha256,
    })),
    previews: [
      {
        role: "virtual-material-overview",
        uri: "preview/terrain-pages-overview.png",
        width: overview.width,
        height: overview.height,
        sha256: sha256(overview.png),
      },
      {
        role: "page-cache-debug-overlay",
        uri: "preview/page-cache-debug-overlay.svg",
        width: overlay.width,
        height: overlay.height,
        sha256: sha256(Buffer.from(overlay.svg, "utf8")),
      },
    ],
    stats: {
      uri: "stats/camera-pan-stream.json",
      sha256: sha256(jsonBuffer(streaming)),
    },
  };
}

function buildOverviewPng() {
  const scale = 2;
  const margin = 12;
  const imageSize = config.virtualSize * scale + margin * 2;
  const rgba = createImage(imageSize, imageSize, [20, 24, 28, 255]);

  for (let y = 0; y < config.virtualSize * scale; y += 1) {
    for (let x = 0; x < config.virtualSize * scale; x += 1) {
      setPixel(
        rgba,
        imageSize,
        margin + x,
        margin + y,
        sampleTerrainMaterial(x / scale, y / scale, 0),
      );
    }
  }

  const tileStep = config.usableTileSize * scale;
  for (let line = 0; line <= config.virtualSize * scale; line += tileStep) {
    drawLine(rgba, imageSize, margin + line, margin, margin + line, margin + config.virtualSize * scale, [
      10,
      17,
      22,
      210,
    ]);
    drawLine(rgba, imageSize, margin, margin + line, margin + config.virtualSize * scale, margin + line, [
      10,
      17,
      22,
      210,
    ]);
  }

  drawRect(rgba, imageSize, margin - 1, margin - 1, config.virtualSize * scale + 2, config.virtualSize * scale + 2, [
    228,
    214,
    172,
    255,
  ]);

  const png = encodePng(imageSize, imageSize, rgba);
  return { width: imageSize, height: imageSize, png };
}

function buildStreamingStats(pages, seamReport) {
  const pageMap = new Map(pages.map((page) => [page.id, page]));
  const cache = new Map();
  const queue = new Map();
  const frames = [];
  const cameraPath = [
    { x: 34, y: 38, footprint: 54 },
    { x: 44, y: 47, footprint: 54 },
    { x: 58, y: 58, footprint: 58 },
    { x: 76, y: 68, footprint: 62 },
    { x: 91, y: 76, footprint: 58 },
    { x: 104, y: 88, footprint: 54 },
  ];

  for (let frame = 0; frame < cameraPath.length; frame += 1) {
    const previous = cameraPath[Math.max(0, frame - 1)];
    const camera = {
      ...cameraPath[frame],
      velocityX: cameraPath[frame].x - previous.x,
      velocityY: cameraPath[frame].y - previous.y,
    };
    const demand = collectDemoDemand(camera);
    let exactHits = 0;
    let misses = 0;
    let fallbackSamples = 0;

    for (const request of demand.visiblePages.values()) {
      const resident = resolveDemoResident(request, cache);
      if (resident.exact) {
        exactHits += request.samples;
        cache.get(request.id).lastUsedFrame = frame;
      } else {
        misses += request.samples;
        if (resident.page) fallbackSamples += request.samples;
        queuePage(queue, request, 100);
      }
      const parent = parentDemoPage(request);
      if (parent && !cache.has(parent.id)) queuePage(queue, parent, 35);
    }

    for (const page of demand.prefetchPages.values()) {
      if (!cache.has(page.id)) queuePage(queue, page, 8);
    }

    const uploads = drainDemoQueue({ queue, cache, frame, pageMap });
    frames.push({
      frame,
      camera: {
        x: camera.x,
        y: camera.y,
        footprint: camera.footprint,
        velocityX: camera.velocityX,
        velocityY: camera.velocityY,
      },
      visiblePageRequests: demand.visiblePages.size,
      prefetchPageRequests: demand.prefetchPages.size,
      exactHits,
      misses,
      fallbackSamples,
      exactHitRatio: ratio(exactHits, exactHits + misses),
      fallbackRatio: ratio(fallbackSamples, exactHits + misses),
      uploadedPages: uploads.uploaded.length,
      uploadBytes: uploads.uploaded.length * bytesPerPage,
      estimatedUploadMs: round(
        uploads.uploaded.length === 0
          ? 0
          : uploads.uploaded.length * config.uploadOverheadMs +
              (uploads.uploaded.length * bytesPerPage) / config.uploadBandwidthBytesPerMs,
      ),
      evictedPages: uploads.evicted.length,
      pageTableUpdates: uploads.uploaded.length + uploads.evicted.length,
      residentPages: cache.size,
      queuedPagesAfterBudget: queue.size,
      seamCandidates: countDemoSeamCandidates(demand.sampleCells, cache),
      mipRequests: demand.mipRequests,
    });
  }

  const finalSlots = [...cache.values()]
    .sort((a, b) => a.slot - b.slot)
    .map((entry) => ({
      slot: entry.slot,
      pageId: entry.id,
      mip: entry.mip,
      x: entry.x,
      y: entry.y,
      status: entry.lastUsedFrame === frames.at(-1).frame ? "visible" : "resident",
      averageColor: pageMap.get(entry.id)?.averageColor ?? [80, 80, 80],
    }));

  while (finalSlots.length < config.cacheSlots) {
    finalSlots.push({
      slot: finalSlots.length,
      pageId: null,
      mip: null,
      x: null,
      y: null,
      status: "free",
      averageColor: [42, 48, 52],
    });
  }

  const totals = frames.reduce(
    (acc, frame) => {
      acc.exactHits += frame.exactHits;
      acc.misses += frame.misses;
      acc.fallbackSamples += frame.fallbackSamples;
      acc.uploadedPages += frame.uploadedPages;
      acc.uploadBytes += frame.uploadBytes;
      acc.estimatedUploadMs += frame.estimatedUploadMs;
      acc.evictedPages += frame.evictedPages;
      acc.pageTableUpdates += frame.pageTableUpdates;
      acc.maxUploads = Math.max(acc.maxUploads, frame.uploadedPages);
      acc.maxQueuedPages = Math.max(acc.maxQueuedPages, frame.queuedPagesAfterBudget);
      acc.maxSeamCandidates = Math.max(acc.maxSeamCandidates, frame.seamCandidates);
      return acc;
    },
    {
      exactHits: 0,
      misses: 0,
      fallbackSamples: 0,
      uploadedPages: 0,
      uploadBytes: 0,
      estimatedUploadMs: 0,
      evictedPages: 0,
      pageTableUpdates: 0,
      maxUploads: 0,
      maxQueuedPages: 0,
      maxSeamCandidates: 0,
    },
  );
  const totalSamples = totals.exactHits + totals.misses;

  return {
    demoId: "virtual-texturing-first-slice",
    budget: {
      physicalSlots: config.cacheSlots,
      maxUploadsPerFrame: config.maxUploadsPerFrame,
      bytesPerDecodedPage: bytesPerPage,
      maxUploadBytesPerFrame: config.maxUploadsPerFrame * bytesPerPage,
    },
    summary: {
      exactHitRatio: ratio(totals.exactHits, totalSamples),
      fallbackRatio: ratio(totals.fallbackSamples, totalSamples),
      averageUploads: round(totals.uploadedPages / frames.length),
      maxUploads: totals.maxUploads,
      averageUploadBytes: Math.round(totals.uploadBytes / frames.length),
      averageEstimatedUploadMs: round(totals.estimatedUploadMs / frames.length),
      totalEvictions: totals.evictedPages,
      averagePageTableUpdates: round(totals.pageTableUpdates / frames.length),
      maxQueuedPages: totals.maxQueuedPages,
      maxSeamCandidates: totals.maxSeamCandidates,
    },
    probeRows: [
      {
        id: "vt.page_hits.exact_ratio",
        label: "exact page hit ratio",
        value: ratio(totals.exactHits, totalSamples),
        target: ">= 0.72 in tiny cold-pan sample; >= 0.95 in full warm-pan demo",
      },
      {
        id: "vt.uploads.pages_per_frame",
        label: "page uploads per frame",
        value: totals.maxUploads,
        target: `<= ${config.maxUploadsPerFrame}`,
      },
      {
        id: "vt.page_table.dirty_entries",
        label: "dirty page-table entries",
        value: round(totals.pageTableUpdates / frames.length),
        target: "proportional to uploads plus evictions",
      },
      {
        id: "vt.seams.candidates",
        label: "resident-mip seam candidates",
        value: totals.maxSeamCandidates,
        target: "debug pressure row; exact border safety is checked by vt.tile_borders.mismatches",
      },
      {
        id: "vt.tile_borders.mismatches",
        label: "padded tile border mismatches",
        value: seamReport.mismatches,
        target: "0",
      },
    ],
    overlayRows: finalSlots,
    frames,
  };
}

function collectDemoDemand(camera) {
  const visiblePages = new Map();
  const prefetchPages = new Map();
  const sampleCells = [];
  const mipRequests = Object.fromEntries(Array.from({ length: config.mipCount }, (_, mip) => [`mip${mip}`, 0]));

  for (let sy = 0; sy < 6; sy += 1) {
    const row = [];
    for (let sx = 0; sx < 10; sx += 1) {
      const u = sx / 9 - 0.5;
      const v = sy / 5 - 0.5;
      const distance = Math.hypot(u, v) * 2;
      const mip = clamp(Math.floor(distance * 1.9 + Math.log2(camera.footprint / 58)), 0, config.mipCount - 1);
      const page = makeDemoPage(
        mip,
        camera.x + u * camera.footprint * 1.45,
        camera.y + v * camera.footprint,
      );
      addDemand(visiblePages, page, 1);
      mipRequests[`mip${mip}`] += 1;
      row.push(page.id);
    }
    sampleCells.push(row);
  }

  const lead = {
    x: camera.x + camera.velocityX * 1.5,
    y: camera.y + camera.velocityY * 1.5,
  };
  for (const page of visiblePages.values()) {
    for (const offset of [
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const next = offsetDemoPageToward(page, offset[0], offset[1], lead);
      addDemand(prefetchPages, next, 0);
    }
  }

  return { visiblePages, prefetchPages, sampleCells, mipRequests };
}

function addDemand(map, page, samples) {
  const existing = map.get(page.id);
  if (existing) {
    existing.samples += samples;
    return;
  }
  map.set(page.id, { ...page, samples });
}

function makeDemoPage(mip, worldX, worldY) {
  const axis = pagesPerAxisAtMip(mip);
  const pageWorldSize = config.usableTileSize * (1 << mip);
  const x = wrapInt(Math.floor(worldX / pageWorldSize), axis);
  const y = wrapInt(Math.floor(worldY / pageWorldSize), axis);
  return { id: pageId(mip, x, y), mip, x, y };
}

function parentDemoPage(page) {
  if (page.mip >= config.mipCount - 1) return null;
  return {
    id: pageId(page.mip + 1, Math.floor(page.x / 2), Math.floor(page.y / 2)),
    mip: page.mip + 1,
    x: Math.floor(page.x / 2),
    y: Math.floor(page.y / 2),
    samples: 0,
  };
}

function offsetDemoPageToward(page, offsetX, offsetY, lead) {
  const axis = pagesPerAxisAtMip(page.mip);
  const pageWorldSize = config.usableTileSize * (1 << page.mip);
  const leadX = wrapInt(Math.floor(lead.x / pageWorldSize), axis);
  const leadY = wrapInt(Math.floor(lead.y / pageWorldSize), axis);
  const x = wrapInt(page.x + offsetX + Math.sign(leadX - page.x), axis);
  const y = wrapInt(page.y + offsetY + Math.sign(leadY - page.y), axis);
  return { id: pageId(page.mip, x, y), mip: page.mip, x, y, samples: 0 };
}

function queuePage(queue, page, priority) {
  const existing = queue.get(page.id);
  if (existing) {
    existing.priority = Math.max(existing.priority, priority);
    existing.samples += page.samples ?? 0;
    return;
  }
  queue.set(page.id, { ...page, priority, samples: page.samples ?? 0 });
}

function drainDemoQueue({ queue, cache, frame, pageMap }) {
  const uploaded = [];
  const evicted = [];
  const candidates = [...queue.values()].sort(
    (a, b) => b.priority - a.priority || a.mip - b.mip || a.id.localeCompare(b.id),
  );

  for (const candidate of candidates) {
    if (uploaded.length >= config.maxUploadsPerFrame) break;
    queue.delete(candidate.id);
    if (cache.has(candidate.id) || !pageMap.has(candidate.id)) continue;

    let slot = firstFreeSlot(cache);
    if (slot === null) {
      const victim = [...cache.values()].sort((a, b) => a.lastUsedFrame - b.lastUsedFrame || b.mip - a.mip)[0];
      cache.delete(victim.id);
      evicted.push(victim.id);
      slot = victim.slot;
    }

    cache.set(candidate.id, {
      id: candidate.id,
      mip: candidate.mip,
      x: candidate.x,
      y: candidate.y,
      slot,
      lastUsedFrame: frame,
    });
    uploaded.push(candidate.id);
  }

  return { uploaded, evicted };
}

function resolveDemoResident(request, cache) {
  const exact = cache.get(request.id);
  if (exact) return { exact: true, page: exact, mipDelta: 0 };

  let parent = request;
  for (let delta = 1; delta < config.mipCount; delta += 1) {
    parent = parentDemoPage(parent);
    if (!parent) break;
    const resident = cache.get(parent.id);
    if (resident) return { exact: false, page: resident, mipDelta: delta };
  }

  return { exact: false, page: null, mipDelta: null };
}

function countDemoSeamCandidates(sampleCells, cache) {
  let seams = 0;
  const resolved = new Map();
  for (const row of sampleCells) {
    for (const id of row) {
      if (!resolved.has(id)) {
        const [mip, x, y] = id.split(":").slice(1).map(Number);
        resolved.set(id, resolveDemoResident({ id, mip, x, y }, cache));
      }
    }
  }

  for (let y = 0; y < sampleCells.length; y += 1) {
    for (let x = 0; x < sampleCells[y].length; x += 1) {
      const current = resolved.get(sampleCells[y][x]);
      if (x + 1 < sampleCells[y].length && isDemoSeam(current, resolved.get(sampleCells[y][x + 1]))) seams += 1;
      if (y + 1 < sampleCells.length && isDemoSeam(current, resolved.get(sampleCells[y + 1][x]))) seams += 1;
    }
  }
  return seams;
}

function isDemoSeam(a, b) {
  if (!a?.page || !b?.page) return true;
  return a.mipDelta !== b.mipDelta;
}

function firstFreeSlot(cache) {
  const used = new Set([...cache.values()].map((entry) => entry.slot));
  for (let slot = 0; slot < config.cacheSlots; slot += 1) {
    if (!used.has(slot)) return slot;
  }
  return null;
}

function buildOverlaySvg(streaming) {
  const width = 880;
  const height = 540;
  const lastFrame = streaming.frames.at(-1);
  const summary = streaming.summary;
  const slotSize = 76;
  const gap = 10;
  const gridX = 34;
  const gridY = 122;
  const statusColor = {
    visible: "#f2d16b",
    resident: "#5fb3a4",
    free: "#4a5156",
  };
  const rows = streaming.overlayRows
    .map((slot) => {
      const x = gridX + (slot.slot % 4) * (slotSize + gap);
      const y = gridY + Math.floor(slot.slot / 4) * (slotSize + gap);
      const fill = rgbCss(slot.averageColor);
      const label = slot.pageId ? `m${slot.mip} ${slot.x},${slot.y}` : "free";
      return `<g>
  <rect x="${x}" y="${y}" width="${slotSize}" height="${slotSize}" rx="8" fill="${fill}" stroke="${statusColor[slot.status]}" stroke-width="4"/>
  <rect x="${x}" y="${y + slotSize - 22}" width="${slotSize}" height="22" fill="rgba(12,16,18,0.76)"/>
  <text x="${x + 8}" y="${y + slotSize - 8}" class="slot">${escapeXml(label)}</text>
</g>`;
    })
    .join("\n");

  const bars = [
    ["exact hits", summary.exactHitRatio, "#74c69d"],
    ["fallback", summary.fallbackRatio, "#9ec5fe"],
    ["upload budget", summary.maxUploads / config.maxUploadsPerFrame, "#f2d16b"],
    ["residency mismatch", summary.maxSeamCandidates / 90, "#f28482"],
  ]
    .map(([label, value, color], index) => {
      const x = 470;
      const y = 150 + index * 54;
      const clamped = clamp(value, 0, 1);
      return `<g>
  <text x="${x}" y="${y - 10}" class="label">${escapeXml(label)}</text>
  <rect x="${x}" y="${y}" width="332" height="16" rx="8" fill="#293136"/>
  <rect x="${x}" y="${y}" width="${Math.round(332 * clamped)}" height="16" rx="8" fill="${color}"/>
  <text x="${x + 344}" y="${y + 13}" class="metric">${typeof value === "number" ? round(value) : value}</text>
</g>`;
    })
    .join("\n");

  const pathPoints = streaming.frames
    .map((frame, index) => `${500 + index * 48},${422 - frame.camera.y * 1.7 + 118}`)
    .join(" ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<style>
  text { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #edf2f4; }
  .title { font-size: 30px; font-weight: 700; letter-spacing: 0; }
  .subtitle { fill: #aeb7bd; font-size: 15px; }
  .label { fill: #cfd7dc; font-size: 14px; font-weight: 650; }
  .metric { fill: #edf2f4; font-size: 13px; font-variant-numeric: tabular-nums; }
  .slot { fill: #edf2f4; font-size: 12px; font-weight: 700; }
</style>
<rect width="${width}" height="${height}" fill="#14191c"/>
<rect x="18" y="18" width="${width - 36}" height="${height - 36}" rx="12" fill="#1d2327" stroke="#384148"/>
<text x="34" y="58" class="title">Virtual texture page cache</text>
<text x="34" y="86" class="subtitle">resident slots, cold-pan uploads, page-table dirties, and seam pressure</text>
<text x="34" y="116" class="label">physical cache (${config.cacheSlots} slots)</text>
${rows}
<text x="470" y="86" class="label">streaming probes</text>
<text x="470" y="116" class="metric">frame ${lastFrame.frame}: ${lastFrame.visiblePageRequests} visible pages, ${lastFrame.uploadedPages} uploads, ${lastFrame.pageTableUpdates} dirty table entries</text>
${bars}
<text x="470" y="352" class="label">camera pan</text>
<rect x="470" y="370" width="330" height="96" rx="8" fill="#20282d" stroke="#364047"/>
<polyline points="${pathPoints}" fill="none" stroke="#f2d16b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="500" cy="${422 - streaming.frames[0].camera.y * 1.7 + 118}" r="6" fill="#74c69d"/>
<circle cx="${500 + (streaming.frames.length - 1) * 48}" cy="${422 - lastFrame.camera.y * 1.7 + 118}" r="6" fill="#f28482"/>
<text x="470" y="506" class="subtitle">Debug overlay contract: slot id, virtual page id, resident mip, hit/miss/upload/evict counters, and seam candidates.</text>
</svg>
`;
  return { width, height, svg };
}

function checkSeamSafety(pages) {
  const byKey = new Map(pages.map((page) => [pageKey(page.mip, page.x, page.y), page]));
  let adjacentPairs = 0;
  let pixelComparisons = 0;
  const mismatches = [];

  for (let mip = 0; mip < config.mipCount; mip += 1) {
    const axis = pagesPerAxisAtMip(mip);
    for (let y = 0; y < axis; y += 1) {
      for (let x = 0; x < axis; x += 1) {
        const page = byKey.get(pageKey(mip, x, y));
        if (x + 1 < axis) {
          const right = byKey.get(pageKey(mip, x + 1, y));
          adjacentPairs += 1;
          pixelComparisons += compareHorizontalSeam(page, right, mismatches);
        }
        if (y + 1 < axis) {
          const down = byKey.get(pageKey(mip, x, y + 1));
          adjacentPairs += 1;
          pixelComparisons += compareVerticalSeam(page, down, mismatches);
        }
      }
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`Generated page borders are not seam-safe: ${mismatches.slice(0, 5).join("; ")}`);
  }

  return {
    policy: "padding texels are generated by evaluating the terrain material outside each tile",
    adjacentTilePairs: adjacentPairs,
    pixelComparisons,
    mismatches: 0,
  };
}

function compareHorizontalSeam(left, right, mismatches) {
  let comparisons = 0;
  for (let row = 0; row < paddedTileSize; row += 1) {
    for (let offset = 0; offset < config.borderTexels; offset += 1) {
      const leftPadding = getPixel(left.rgba, paddedTileSize, config.borderTexels + config.usableTileSize + offset, row);
      const rightUsable = getPixel(right.rgba, paddedTileSize, config.borderTexels + offset, row);
      const leftUsable = getPixel(
        left.rgba,
        paddedTileSize,
        config.borderTexels + config.usableTileSize - config.borderTexels + offset,
        row,
      );
      const rightPadding = getPixel(right.rgba, paddedTileSize, offset, row);
      if (!sameColor(leftPadding, rightUsable)) mismatches.push(`${left.id} right padding -> ${right.id} usable`);
      if (!sameColor(leftUsable, rightPadding)) mismatches.push(`${left.id} usable -> ${right.id} left padding`);
      comparisons += 2;
    }
  }
  return comparisons;
}

function compareVerticalSeam(up, down, mismatches) {
  let comparisons = 0;
  for (let col = 0; col < paddedTileSize; col += 1) {
    for (let offset = 0; offset < config.borderTexels; offset += 1) {
      const upPadding = getPixel(up.rgba, paddedTileSize, col, config.borderTexels + config.usableTileSize + offset);
      const downUsable = getPixel(down.rgba, paddedTileSize, col, config.borderTexels + offset);
      const upUsable = getPixel(
        up.rgba,
        paddedTileSize,
        col,
        config.borderTexels + config.usableTileSize - config.borderTexels + offset,
      );
      const downPadding = getPixel(down.rgba, paddedTileSize, col, offset);
      if (!sameColor(upPadding, downUsable)) mismatches.push(`${up.id} bottom padding -> ${down.id} usable`);
      if (!sameColor(upUsable, downPadding)) mismatches.push(`${up.id} usable -> ${down.id} top padding`);
      comparisons += 2;
    }
  }
  return comparisons;
}

function sampleTerrainMaterial(x, y, mip) {
  const sx = wrap(x, config.virtualSize);
  const sy = wrap(y, config.virtualSize);
  const nx = sx / config.virtualSize;
  const ny = sy / config.virtualSize;
  const coarse = fbm(sx * 0.72 + 19, sy * 0.72 - 11, 4);
  const ridges = 1 - Math.abs(fbm(sx * 1.4 - 3, sy * 1.4 + 41, 3) * 2 - 1);
  const riverCenter = config.virtualSize * (0.42 + Math.sin(nx * Math.PI * 2.4) * 0.11);
  const river = 1 - smoothstep(4.5, 11.5, Math.abs(sy - riverCenter));
  const roadCenter = config.virtualSize * (0.75 + Math.sin(nx * Math.PI * 3.1 + 0.9) * 0.045);
  const road = 1 - smoothstep(1.4, 4.4, Math.abs(sy - roadCenter));
  const altitude = clamp(coarse * 0.72 + ridges * 0.26 - river * 0.22, 0, 1);
  const detailStrength = 1 / (1 + mip * 0.7);
  const streak = (valueNoise(sx * 2.8, sy * 0.48, 9, 71) - 0.5) * 0.16 * detailStrength;
  const slope = Math.abs(valueNoise(sx + 1, sy, 18, 3) - valueNoise(sx, sy + 1, 18, 3));

  let color = mixColor([74, 102, 72], [128, 142, 86], smoothstep(0.2, 0.56, altitude));
  color = mixColor(color, [91, 86, 78], smoothstep(0.58, 0.82, altitude + slope * 1.4));
  color = mixColor(color, [219, 219, 205], smoothstep(0.84, 0.96, altitude));
  color = mixColor(color, [47, 96, 103], river * 0.9);
  color = mixColor(color, [166, 137, 93], road * (1 - river) * 0.86);

  const decal = sparseDecal(sx, sy);
  if (decal > 0) color = mixColor(color, [206, 180, 116], decal * detailStrength);

  const light = clamp(0.94 + streak - slope * 0.82 + ridges * 0.08, 0.64, 1.16);
  return [
    clampByte(color[0] * light),
    clampByte(color[1] * light),
    clampByte(color[2] * light),
    255,
  ];
}

function sparseDecal(x, y) {
  const cell = 8;
  const cx = Math.floor(x / cell);
  const cy = Math.floor(y / cell);
  const gate = hash2(cx, cy, 123);
  if (gate < 0.9) return 0;
  const px = x / cell - Math.floor(x / cell) - hash2(cx, cy, 233);
  const py = y / cell - Math.floor(y / cell) - hash2(cx, cy, 377);
  return 1 - smoothstep(0.03, 0.17, Math.hypot(px, py));
}

function fbm(x, y, octaves) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, 32, octave * 97 + 17) * amplitude;
    norm += amplitude;
    frequency *= 2;
    amplitude *= 0.52;
  }
  return sum / norm;
}

function valueNoise(x, y, scale, salt) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const tx = smootherstep(gx - x0);
  const ty = smootherstep(gy - y0);
  const a = hash2(x0, y0, salt);
  const b = hash2(x0 + 1, y0, salt);
  const c = hash2(x0, y0 + 1, salt);
  const d = hash2(x0 + 1, y0 + 1, salt);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function hash2(x, y, salt) {
  let h = config.seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(salt, 0xc2b2ae3d);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 0xffffffff;
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rawOffset = y * (width * 4 + 1);
    raw[rawOffset] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, rawOffset + 1);
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", bufferFromUInts(width, height, 8, 6, 0, 0, 0)),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function bufferFromUInts(width, height, bitDepth, colorType, compression, filter, interlace) {
  const buffer = Buffer.alloc(13);
  buffer.writeUInt32BE(width, 0);
  buffer.writeUInt32BE(height, 4);
  buffer[8] = bitDepth;
  buffer[9] = colorType;
  buffer[10] = compression;
  buffer[11] = filter;
  buffer[12] = interlace;
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let c = index;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

async function writeArtifacts(artifacts) {
  for (const [relativePath, contents] of artifacts) {
    const absolutePath = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents);
  }
}

async function checkArtifacts(artifacts) {
  const mismatches = [];
  for (const [relativePath, expected] of artifacts) {
    const absolutePath = path.join(outputRoot, relativePath);
    let actual;
    try {
      actual = await readFile(absolutePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        mismatches.push(`${relativePath} missing`);
        continue;
      }
      throw error;
    }
    if (!actual.equals(expected)) mismatches.push(`${relativePath} differs`);
  }

  if (mismatches.length > 0) {
    throw new Error(`Demo assets are stale:\n${mismatches.map((row) => `- ${row}`).join("\n")}`);
  }
}

function jsonBuffer(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function createImage(width, height, fill = [0, 0, 0, 0]) {
  const image = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(image, width, x, y, fill);
    }
  }
  return image;
}

function setPixel(image, width, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= image.length / width / 4) return;
  const index = (y * width + x) * 4;
  const alpha = color[3] / 255;
  if (alpha >= 1) {
    image[index] = color[0];
    image[index + 1] = color[1];
    image[index + 2] = color[2];
    image[index + 3] = color[3];
    return;
  }
  image[index] = clampByte(color[0] * alpha + image[index] * (1 - alpha));
  image[index + 1] = clampByte(color[1] * alpha + image[index + 1] * (1 - alpha));
  image[index + 2] = clampByte(color[2] * alpha + image[index + 2] * (1 - alpha));
  image[index + 3] = 255;
}

function getPixel(image, width, x, y) {
  const index = (y * width + x) * 4;
  return [image[index], image[index + 1], image[index + 2], image[index + 3]];
}

function drawLine(image, width, x0, y0, x1, y1, color) {
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    setPixel(image, width, x, y, color);
    if (x === x1 && y === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

function drawRect(image, width, x, y, rectWidth, rectHeight, color) {
  drawLine(image, width, x, y, x + rectWidth - 1, y, color);
  drawLine(image, width, x, y + rectHeight - 1, x + rectWidth - 1, y + rectHeight - 1, color);
  drawLine(image, width, x, y, x, y + rectHeight - 1, color);
  drawLine(image, width, x + rectWidth - 1, y, x + rectWidth - 1, y + rectHeight - 1, color);
}

function averageColor(rgba) {
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = rgba.length / 4;
  for (let index = 0; index < rgba.length; index += 4) {
    r += rgba[index];
    g += rgba[index + 1];
    b += rgba[index + 2];
  }
  return [Math.round(r / pixels), Math.round(g / pixels), Math.round(b / pixels)];
}

function sameColor(a, b) {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

function pageId(mip, x, y) {
  return `page:${mip}:${x}:${y}`;
}

function pageKey(mip, x, y) {
  return `${mip}:${x}:${y}`;
}

function pagesPerAxisAtMip(mip) {
  return config.virtualSize / config.usableTileSize / (1 << mip);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function rgbCss(color) {
  return `rgb(${color[0]} ${color[1]} ${color[2]})`;
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function mixColor(a, b, t) {
  const clamped = clamp(t, 0, 1);
  return [
    lerp(a[0], b[0], clamped),
    lerp(a[1], b[1], clamped),
    lerp(a[2], b[2], clamped),
  ];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function smootherstep(value) {
  const x = clamp(value, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function wrap(value, size) {
  return ((value % size) + size) % size;
}

function wrapInt(value, size) {
  return ((value % size) + size) % size;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function ratio(value, total) {
  return total === 0 ? 0 : round(value / total);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const DEFAULT_TEXT = "AV office 108%.";
const DEFAULT_SIZE_CSS_PX = 16;
const DEFAULT_DPR = 2;
const DEFAULT_PADDING_CSS_PX = 2;
const DEFAULT_ATLAS_PX = 256;
const DEFAULT_ITERATIONS = 20_000;

function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.text ?? DEFAULT_TEXT;
  const font = {
    family: args.family ?? "system-ui",
    weight: args.weight ?? "400",
    style: args.style ?? "normal",
    sizeCssPx: numberArg(args.size, DEFAULT_SIZE_CSS_PX),
    dpr: numberArg(args.dpr, DEFAULT_DPR),
    paddingCssPx: numberArg(args.padding, DEFAULT_PADDING_CSS_PX),
    atlasPx: numberArg(args.atlas, DEFAULT_ATLAS_PX),
  };
  const iterations = numberArg(args.iterations, DEFAULT_ITERATIONS);
  const edits = buildEditSequence(text);

  const wholeRun = simulateWholeRunTexture(edits, font);
  const atlas = simulateGlyphAtlas(edits, font);
  const timing = benchmark(edits, font, iterations);

  const report = {
    prototype: "canvas-raster-text-rendering-simulator",
    model: {
      note: "Node-safe deterministic simulator. Browser implementation should replace approximate metrics with CanvasRenderingContext2D.measureText() and actual canvas upload timings.",
      canvasSource: "visual raster comes from browser canvas or OffscreenCanvas; this script estimates bitmap sizes and churn without DOM canvas.",
      shapingApproximation: "The simulator treats ffi as a shaped atlas cluster and applies a small AV kerning adjustment. Real production needs browser shaping or a shaping library before atlas placement.",
    },
    input: {
      text,
      editFrames: edits.length,
      font,
      iterations,
    },
    wholeRunTexture: summarizeWholeRun(wholeRun),
    glyphAtlas: summarizeAtlas(atlas),
    dynamicChurn: compareChurn(wholeRun.frames, atlas.frames),
    finalFrame: {
      text: edits.at(-1),
      wholeRunTexturePx: wholeRun.frames.at(-1).texturePx,
      glyphAtlasEntries: atlas.entries.map((entry) => ({
        key: entry.key,
        texturePx: entry.texturePx,
        advanceCssPx: round(entry.advanceCssPx),
        atlas: { page: entry.page, x: entry.x, y: entry.y },
      })),
    },
    timing,
    recommendation: [
      "Use whole-run textures for short labels that change rarely or need exact browser shaping immediately.",
      "Use a glyph/cluster atlas for editable UI text and repeated labels because uploads scale with new glyphs instead of full run changes.",
      "Keep real outline text as the default for geometric UI examples until raster text has a browser-backed implementation and cache policy.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function numberArg(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function buildEditSequence(text) {
  const typing = [];
  for (let end = 1; end <= text.length; end += 1) typing.push(text.slice(0, end));

  const withoutDot = text.endsWith(".") ? text.slice(0, -1) : text;
  const editOffice = text.replace("office", "offices");
  const restoreOffice = editOffice.replace("offices", "office");
  const percentTweak = text.replace("108%", "109%");

  return compactAdjacentDuplicates([
    ...typing,
    withoutDot,
    text,
    editOffice,
    restoreOffice,
    percentTweak,
    text,
  ]);
}

function compactAdjacentDuplicates(values) {
  const unique = [];
  let previous;
  for (const value of values) {
    if (value === previous) continue;
    unique.push(value);
    previous = value;
  }
  return unique;
}

function simulateWholeRunTexture(edits, font) {
  const cache = new Map();
  const frames = [];
  for (const text of edits) {
    let run = cache.get(text);
    let cacheMiss = false;
    if (run === undefined) {
      const metrics = measureRun(text, font);
      const texturePx = paddedTexture(metrics.advanceCssPx, metrics.heightCssPx, font);
      run = {
        text,
        advanceCssPx: metrics.advanceCssPx,
        texturePx,
        bytes: textureBytes(texturePx),
      };
      cache.set(text, run);
      cacheMiss = true;
    }
    frames.push({
      text,
      run,
      texturePx: run.texturePx,
      uploadedBytesThisFrame: cacheMiss ? run.bytes : 0,
      uploadCountThisFrame: cacheMiss ? 1 : 0,
      drawQuads: text.length === 0 ? 0 : 1,
    });
  }
  return { cache, frames };
}

function simulateGlyphAtlas(edits, font) {
  const packer = createShelfPacker(font.atlasPx);
  const entriesByKey = new Map();
  const frames = [];

  for (const text of edits) {
    const clusters = clusterText(text);
    let uploadedBytesThisFrame = 0;
    let uploadCountThisFrame = 0;

    for (const cluster of clusters) {
      if (entriesByKey.has(cluster.key)) continue;
      const metrics = measureRun(cluster.text, font);
      const texturePx = paddedTexture(metrics.advanceCssPx, metrics.heightCssPx, font);
      const packed = packer.pack(texturePx.width, texturePx.height);
      const entry = {
        key: cluster.key,
        text: cluster.text,
        advanceCssPx: metrics.advanceCssPx,
        texturePx,
        bytes: textureBytes(texturePx),
        ...packed,
      };
      entriesByKey.set(cluster.key, entry);
      uploadedBytesThisFrame += entry.bytes;
      uploadCountThisFrame += 1;
    }

    const positioned = layoutClusters(clusters, font);
    frames.push({
      text,
      clusters: positioned,
      uploadedBytesThisFrame,
      uploadCountThisFrame,
      drawQuads: positioned.length,
    });
  }

  return {
    entries: [...entriesByKey.values()],
    frames,
    pages: packer.pages,
    atlasPx: font.atlasPx,
  };
}

function createShelfPacker(pageSize) {
  const pages = [{ shelves: [], usedArea: 0 }];

  return {
    pages,
    pack(width, height) {
      if (width > pageSize || height > pageSize) {
        throw new Error(`Atlas entry ${width}x${height} exceeds ${pageSize}px atlas page`);
      }

      for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
        const page = pages[pageIndex];
        for (const shelf of page.shelves) {
          if (height <= shelf.height && shelf.x + width <= pageSize) {
            const packed = { page: pageIndex, x: shelf.x, y: shelf.y };
            shelf.x += width;
            page.usedArea += width * height;
            return packed;
          }
        }

        const y = page.shelves.reduce((sum, shelf) => sum + shelf.height, 0);
        if (y + height <= pageSize) {
          page.shelves.push({ x: width, y, height });
          page.usedArea += width * height;
          return { page: pageIndex, x: 0, y };
        }
      }

      pages.push({ shelves: [{ x: width, y: 0, height }], usedArea: width * height });
      return { page: pages.length - 1, x: 0, y: 0 };
    },
  };
}

function clusterText(text) {
  const clusters = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("ffi", index)) {
      clusters.push({ key: "lig:ffi", text: "ffi" });
      index += 2;
      continue;
    }
    const char = text[index];
    clusters.push({ key: `cp:${char.codePointAt(0).toString(16)}`, text: char });
  }
  return clusters;
}

function layoutClusters(clusters, font) {
  let x = 0;
  let previous = "";
  const positioned = [];
  for (const cluster of clusters) {
    const kern = kerningCssPx(previous, cluster.text, font.sizeCssPx);
    x += kern;
    const advance = measureRun(cluster.text, font).advanceCssPx;
    positioned.push({
      key: cluster.key,
      xCssPx: round(x),
      advanceCssPx: round(advance),
    });
    x += advance;
    previous = cluster.text;
  }
  return positioned;
}

function measureRun(text, font) {
  let advanceEm = 0;
  let previous = "";
  for (const cluster of clusterTextForMetrics(text)) {
    advanceEm += glyphWidthEm(cluster);
    advanceEm += kerningEm(previous, cluster);
    previous = cluster;
  }

  const advanceCssPx = Math.max(1, advanceEm * font.sizeCssPx);
  const heightCssPx = font.sizeCssPx * 1.25;
  return { advanceCssPx, heightCssPx };
}

function clusterTextForMetrics(text) {
  const clusters = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text.startsWith("ffi", index)) {
      clusters.push("ffi");
      index += 2;
      continue;
    }
    clusters.push(text[index]);
  }
  return clusters;
}

function glyphWidthEm(cluster) {
  if (cluster === "ffi") return 0.92;
  if (cluster === " ") return 0.31;
  if (cluster === ".") return 0.28;
  if (cluster === "%") return 0.86;
  if (/^[0-9]$/.test(cluster)) return 0.56;
  if (/^[A-Z]$/.test(cluster)) return cluster === "I" ? 0.32 : 0.66;
  if (/^[a-z]$/.test(cluster)) return "il".includes(cluster) ? 0.24 : 0.52;
  return 0.56;
}

function kerningCssPx(left, right, sizeCssPx) {
  return kerningEm(left, right) * sizeCssPx;
}

function kerningEm(left, right) {
  const pair = `${left}${right}`;
  if (pair === "AV") return -0.08;
  if (pair === "To") return -0.06;
  if (pair === "ffii") return -0.02;
  return 0;
}

function paddedTexture(widthCssPx, heightCssPx, font) {
  const pad = font.paddingCssPx * 2;
  return {
    width: Math.ceil((widthCssPx + pad) * font.dpr),
    height: Math.ceil((heightCssPx + pad) * font.dpr),
  };
}

function textureBytes(texturePx) {
  return texturePx.width * texturePx.height * 4;
}

function summarizeWholeRun(result) {
  const frames = result.frames;
  const cachedRuns = [...result.cache.values()];
  return {
    distinctRunTextures: cachedRuns.length,
    uploads: sum(frames, (frame) => frame.uploadCountThisFrame),
    uploadedBytes: sum(frames, (frame) => frame.uploadedBytesThisFrame),
    uploaded: formatBytes(sum(frames, (frame) => frame.uploadedBytesThisFrame)),
    residentBytesCurrentOnly: frames.at(-1).run.bytes,
    residentCurrentOnly: formatBytes(frames.at(-1).run.bytes),
    residentBytesIfAllEditStatesCached: sum(cachedRuns, (run) => run.bytes),
    residentIfAllEditStatesCached: formatBytes(sum(cachedRuns, (run) => run.bytes)),
    peakTexturePx: maxBy(cachedRuns, (run) => run.bytes).texturePx,
    finalDrawQuads: frames.at(-1).drawQuads,
  };
}

function summarizeAtlas(result) {
  const residentBytes = result.pages.length * result.atlasPx * result.atlasPx * 4;
  const usedArea = sum(result.pages, (page) => page.usedArea);
  return {
    uniqueAtlasEntries: result.entries.length,
    atlasPages: result.pages.length,
    atlasPagePx: result.atlasPx,
    residentBytes,
    resident: formatBytes(residentBytes),
    usedAtlasPixels: usedArea,
    occupancy: round(usedArea / (result.pages.length * result.atlasPx * result.atlasPx)),
    subImageUploads: sum(result.frames, (frame) => frame.uploadCountThisFrame),
    uploadedBytes: sum(result.frames, (frame) => frame.uploadedBytesThisFrame),
    uploaded: formatBytes(sum(result.frames, (frame) => frame.uploadedBytesThisFrame)),
    finalDrawQuads: result.frames.at(-1).drawQuads,
    maxDrawQuadsPerFrame: Math.max(...result.frames.map((frame) => frame.drawQuads)),
  };
}

function compareChurn(wholeFrames, atlasFrames) {
  return wholeFrames.map((whole, index) => ({
    frame: index + 1,
    text: whole.text,
    wholeRunUploadBytes: whole.uploadedBytesThisFrame,
    glyphAtlasUploadBytes: atlasFrames[index].uploadedBytesThisFrame,
    glyphAtlasNewEntries: atlasFrames[index].uploadCountThisFrame,
    wholeRunDrawQuads: whole.drawQuads,
    glyphAtlasDrawQuads: atlasFrames[index].drawQuads,
  }));
}

function benchmark(edits, font, iterations) {
  const wholeStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateWholeRunTexture(edits, font);
  const wholeMs = performance.now() - wholeStart;

  const atlasStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateGlyphAtlas(edits, font);
  const atlasMs = performance.now() - atlasStart;

  return {
    iterations,
    wholeRunMs: round(wholeMs),
    glyphAtlasMs: round(atlasMs),
    wholeRunUsPerSimulation: round((wholeMs * 1000) / iterations),
    glyphAtlasUsPerSimulation: round((atlasMs * 1000) / iterations),
  };
}

function sum(values, mapper) {
  return values.reduce((total, value) => total + mapper(value), 0);
}

function maxBy(values, mapper) {
  return values.reduce((best, value) => (mapper(value) > mapper(best) ? value : best), values[0]);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${round(bytes / 1024)} KiB`;
  return `${round(bytes / 1024 / 1024)} MiB`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

main();

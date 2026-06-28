#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const DEFAULT_TEXT = "AV office 108%.";
const DEFAULT_SIZE_CSS_PX = 16;
const DEFAULT_DPR = 2;
const DEFAULT_PADDING_CSS_PX = 2;
const DEFAULT_ATLAS_PX = 256;
const DEFAULT_ITERATIONS = 100;
const DEFAULT_MONO_CELL_EM = 0.62;
const DEFAULT_MONO_LINE_EM = 1.25;
const INVISIBLE_MONO_CELLS = new Set([" ", "\t"]);

const DENSE_UI_LABELS = [
  "File",
  "Edit",
  "View",
  "Arrange",
  "Inspect",
  "Layer 01",
  "Layer 02",
  "Opacity 108%",
  "X 184.5",
  "Y 64.0",
  "W 320",
  "H 44",
  "Blend: Normal",
  "Locked",
  "Office AV",
  "Zoom 108%",
];

const UNICODE_FIXTURES = [
  {
    name: "fixture-latin-kerning",
    description: "Canonical Latin label with AV kerning, office shaping, and percent edits.",
    text: "AV office 108%.",
  },
  {
    name: "fixture-ligatures",
    description: "Latin fi and ffi ligature candidates.",
    text: "fi ffi",
  },
  {
    name: "fixture-combining-marks",
    description: "Base letters with combining marks that must stay in the same visual cluster.",
    text: "Cafe\u0301 A\u030A n\u0303",
  },
  {
    name: "fixture-emoji",
    description: "Color emoji, ZWJ family, and regional indicator flag sequence.",
    text: "Status ✅ family 👨‍👩‍👧‍👦 flag 🇳🇿",
  },
  {
    name: "fixture-bidi-rtl",
    description: "Mixed Latin, Arabic, Hebrew, and digits for bidi and joining risk.",
    text: "LTR مرحبا שלום 123",
  },
  {
    name: "fixture-cjk",
    description: "CJK and Hangul sample for wide glyphs and fallback metrics.",
    text: "漢字かなカナ 한국어",
  },
  {
    name: "fixture-monospace-ui-table",
    description: "Multiline fixed-grid UI text for monospace atlas behavior.",
    text: "CPU  12%\nMEM  64%\nIO   08%",
    family: "ui-monospace",
  },
];

const DECISION_MATRIX = [
  {
    strategy: "whole-run texture",
    correctnessRisk: "low: browser canvas owns shaping, bidi, fallback, emoji, and kerning for the full run",
    drawQuads: "1 per visible run",
    cacheChurn: "high for edits because any changed run is a new bitmap upload",
    memory: "can be high if many edit states or long labels remain cached",
    shapingDataRequired: "run bounds from measureText; no glyph ids or cluster maps required for drawing",
  },
  {
    strategy: "glyph atlas",
    correctnessRisk: "high for ligatures, combining marks, emoji ZWJ, Arabic joining, bidi, and kerning",
    drawQuads: "roughly one per code point or glyph",
    cacheChurn: "low once common glyphs are warm",
    memory: "predictable atlas pages keyed by font, size, DPR, paint, and phase policy",
    shapingDataRequired: "HarfBuzz/fontkit-class shaping records: glyph ids, advances, offsets, GPOS/GSUB effects, and cluster-to-text mapping",
  },
  {
    strategy: "cluster atlas",
    correctnessRisk: "medium only if clusters come from HarfBuzz/fontkit-class shaping; high if inferred from browser canvas or Intl.Segmenter",
    drawQuads: "one per shaped cluster; fewer than glyph atlas for ligatures and emoji sequences",
    cacheChurn: "low to medium; reusable clusters warm well, script-specific clusters churn more",
    memory: "more entries than whole-run, fewer broken entries than glyph atlas for complex text",
    shapingDataRequired: "HarfBuzz/fontkit-class cluster boundaries, visual order, advances, offsets, direction, and fallback font per cluster",
  },
  {
    strategy: "monospace atlas",
    correctnessRisk: "low for restricted ASCII UI/debug/table text with hard diagnostics; reject all broader Unicode/user text",
    drawQuads: "one per non-space cell",
    cacheChurn: "very low for counters and fixed UI chrome",
    memory: "small fixed cell atlas per font, size, DPR, paint, and weight",
    shapingDataRequired: "fixed cell advance, line height, baseline, monospace font policy, and an allowlist proving no shaping-sensitive content",
  },
];

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
    monoCellEm: numberArg(args.monoCellEm, DEFAULT_MONO_CELL_EM),
    monoLineEm: numberArg(args.monoLineEm, DEFAULT_MONO_LINE_EM),
  };
  const iterations = numberArg(args.iterations, DEFAULT_ITERATIONS);

  const scenarios = [
    runScenario({
      name: "single-edit",
      description: "Typing and small edits for the canonical short label.",
      frames: buildEditSequence(text).map((run) => [run]),
      font,
      iterations,
    }),
    runScenario({
      name: "dense-ui-labels",
      description: "A compact inspector/menu label set with repeated letters, numbers, and status edits.",
      frames: buildDenseUiLabelFrames(),
      font,
      iterations,
    }),
    ...UNICODE_FIXTURES.map((fixture) => runScenario({
      name: fixture.name,
      description: fixture.description,
      frames: buildEditSequence(fixture.text).map((run) => [run]),
      font: {
        ...font,
        family: fixture.family ?? font.family,
      },
      iterations,
    })),
  ];

  const report = {
    prototype: "canvas-raster-text-rendering-simulator",
    model: {
      note: "Node-safe deterministic simulator. Browser implementation should replace approximate metrics with CanvasRenderingContext2D.measureText() and actual canvas upload timings.",
      canvasSource: "Visual raster comes from browser canvas or OffscreenCanvas; this script estimates bitmap sizes and churn without DOM canvas.",
      segmentation: segmenterStatus(),
      glyphAtlasApproximation: "The glyph atlas intentionally models code point reuse so Unicode fixtures expose where this is not a valid production glyph atlas.",
      clusterAtlasApproximation: "The cluster atlas uses Intl.Segmenter graphemes plus Latin fi/ffi heuristics for fixture statistics only. Production cluster atlases need HarfBuzz/fontkit-class glyph ids, clusters, advances, offsets, and visual order.",
      monospaceApproximation: "The monospace atlas is a restricted ASCII UI/debug/table path. Unsupported runs are rejected with diagnostics and must fall back to browser whole-run or outline rendering.",
    },
    input: {
      text,
      font,
      iterations,
      cacheKeys: {
        wholeRun: rasterFontCacheKey(font, "whole-run"),
        glyphAtlas: rasterFontCacheKey(font, "glyph-atlas:codepoint"),
        clusterAtlas: rasterFontCacheKey(font, "cluster-atlas:heuristic"),
        monospaceGlyphAtlas: rasterFontCacheKey(font, "glyph-atlas:monospace"),
      },
    },
    fixtureCoverage: UNICODE_FIXTURES.map((fixture) => analyzeFixture(fixture, font)),
    scenarios,
    decisionMatrix: DECISION_MATRIX,
    recommendation: [
      "v1 should support browser whole-run raster text as the correctness fallback for general Unicode, emoji, bidi, combining marks, CJK, and user-authored text.",
      "v1 may support a monospace atlas only for explicitly restricted ASCII UI/debug/table runs, with hard diagnostics and whole-run/outline fallback for unsupported content.",
      "Defer general glyph and cluster atlases until a HarfBuzz/fontkit-class shaping layer provides glyph ids, cluster maps, visual order, advances, offsets, and fallback font identity.",
      "Keep real outline/default paths until browser whole-run tests pass for the full fixture set and atlas paths reject unsupported shaping cases.",
    ],
  };

  console.log(JSON.stringify(report, null, 2));
}

function runScenario({ name, description, frames, font, iterations }) {
  const wholeRun = simulateWholeRunTexture(frames, font);
  const glyphAtlas = simulateGlyphAtlas(frames, font);
  const clusterAtlas = simulateClusterAtlas(frames, font);
  const monospaceFont = isMonospaceFamily(font.family) ? font : { ...font, family: "ui-monospace" };
  const monospaceAtlas = simulateMonospaceGlyphAtlas(frames, monospaceFont);
  const timing = benchmark(frames, font, monospaceFont, iterations);

  return {
    name,
    description,
    frameCount: frames.length,
    finalRuns: frames.at(-1),
    textAnalysis: analyzeRuns(frames.at(-1), monospaceFont),
    wholeRunTexture: summarizeWholeRun(wholeRun),
    glyphAtlas: summarizeAtlas(glyphAtlas),
    clusterAtlas: summarizeAtlas(clusterAtlas),
    monospaceGlyphAtlas: {
      fontFamily: monospaceFont.family,
      ...summarizeAtlas(monospaceAtlas),
    },
    dynamicChurn: compareChurn(wholeRun.frames, glyphAtlas.frames, clusterAtlas.frames, monospaceAtlas.frames),
    finalFrame: {
      wholeRunTexturePx: wholeRun.frames.at(-1).texturePx,
      glyphAtlasEntries: previewAtlasEntries(glyphAtlas.entries),
      clusterAtlasEntries: previewAtlasEntries(clusterAtlas.entries),
      monospaceCell: monospaceAtlas.cellMetrics,
      monospaceAtlasEntries: previewAtlasEntries(monospaceAtlas.entries),
      monospaceDiagnostics: monospaceAtlas.diagnostics,
    },
    timing,
  };
}

function analyzeFixture(fixture, baseFont) {
  const text = fixture.text;
  const family = fixture.family ?? baseFont.family;
  const features = detectTextFeatures(text);
  const riskFlags = Object.entries(features)
    .filter(([, enabled]) => enabled)
    .map(([name]) => name);

  return {
    name: fixture.name,
    description: fixture.description,
    family,
    segmentation: segmentationStats(text),
    features,
    monospaceDiagnostic: diagnoseMonospaceRun(text, { ...baseFont, family }),
    atlasRiskFlags: riskFlags,
  };
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
  const segments = segmentText(text, "grapheme").segments;
  for (let end = 1; end <= segments.length; end += 1) {
    typing.push(segments.slice(0, end).join(""));
  }

  const withoutDot = text.endsWith(".") ? text.slice(0, -1) : text;
  const editOffice = text.replace("office", "offices");
  const restoreOffice = editOffice.replace("offices", "office");
  const percentTweak = text.replace("108%", "109%");
  const tableTweak = text.replace("64%", "65%");

  return compactAdjacentDuplicates([
    ...typing,
    withoutDot,
    text,
    editOffice,
    restoreOffice,
    percentTweak,
    tableTweak,
    text,
  ]);
}

function buildDenseUiLabelFrames() {
  const frames = [DENSE_UI_LABELS];
  frames.push(replaceLabel(frames.at(-1), "Opacity 108%", "Opacity 109%"));
  frames.push(replaceLabel(frames.at(-1), "Zoom 108%", "Zoom 125%"));
  frames.push(replaceLabel(frames.at(-1), "Layer 02", "Layer 03"));
  frames.push(replaceLabel(frames.at(-1), "Locked", "Unlocked"));
  frames.push(replaceLabel(frames.at(-1), "W 320", "W 328"));
  frames.push(replaceLabel(frames.at(-1), "Blend: Normal", "Blend: Multiply"));
  frames.push(DENSE_UI_LABELS);
  return compactAdjacentFrameDuplicates(frames);
}

function replaceLabel(labels, from, to) {
  return labels.map((label) => (label === from ? to : label));
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

function compactAdjacentFrameDuplicates(frames) {
  const unique = [];
  let previousKey = "";
  for (const frame of frames) {
    const key = frame.join("\u0000");
    if (key === previousKey) continue;
    unique.push(frame);
    previousKey = key;
  }
  return unique;
}

function simulateWholeRunTexture(frames, font) {
  const cache = new Map();
  const renderedFrames = [];
  const fontKey = rasterFontCacheKey(font, "whole-run");

  for (const runs of frames) {
    let uploadedBytesThisFrame = 0;
    let uploadCountThisFrame = 0;
    let drawQuads = 0;
    const runRecords = [];

    for (const text of runs) {
      const key = `${fontKey}|text:${text}`;
      let run = cache.get(key);
      let cacheMiss = false;
      if (run === undefined) {
        const metrics = measureRun(text, font);
        const texturePx = paddedTexture(metrics.advanceCssPx, metrics.heightCssPx, font);
        run = {
          key,
          text,
          advanceCssPx: metrics.advanceCssPx,
          texturePx,
          bytes: textureBytes(texturePx),
        };
        cache.set(key, run);
        cacheMiss = true;
      }
      uploadedBytesThisFrame += cacheMiss ? run.bytes : 0;
      uploadCountThisFrame += cacheMiss ? 1 : 0;
      drawQuads += text.length === 0 ? 0 : 1;
      runRecords.push(run);
    }

    renderedFrames.push({
      runs,
      runRecords,
      texturePx: unionTexturePx(runRecords),
      uploadedBytesThisFrame,
      uploadCountThisFrame,
      drawQuads,
    });
  }
  return { cache, frames: renderedFrames };
}

function simulateGlyphAtlas(frames, font) {
  const packer = createShelfPacker(font.atlasPx);
  const entriesByKey = new Map();
  const renderedFrames = [];
  const fontKey = rasterFontCacheKey(font, "glyph-atlas:codepoint");

  for (const runs of frames) {
    let uploadedBytesThisFrame = 0;
    let uploadCountThisFrame = 0;
    let drawQuads = 0;
    const positionedRuns = [];

    for (const text of runs) {
      const clusters = glyphUnits(text);
      for (const cluster of clusters) {
        if (cluster.skipTexture) continue;
        const key = `${fontKey}|${cluster.key}`;
        if (entriesByKey.has(key)) continue;
        const metrics = measureRun(cluster.text, font);
        const texturePx = paddedTexture(metrics.advanceCssPx, metrics.heightCssPx, font);
        const packed = packer.pack(texturePx.width, texturePx.height);
        const entry = {
          key,
          label: cluster.key,
          text: cluster.text,
          advanceCssPx: metrics.advanceCssPx,
          texturePx,
          bytes: textureBytes(texturePx),
          ...packed,
          uvRect: uvRect(packed, texturePx, font.atlasPx),
        };
        entriesByKey.set(key, entry);
        uploadedBytesThisFrame += entry.bytes;
        uploadCountThisFrame += 1;
      }

      const positioned = layoutClusters(clusters, font);
      positionedRuns.push(positioned);
      drawQuads += positioned.length;
    }

    renderedFrames.push({
      runs,
      positionedRuns,
      uploadedBytesThisFrame,
      uploadCountThisFrame,
      drawQuads,
    });
  }

  return {
    mode: "glyph-codepoint",
    entries: [...entriesByKey.values()],
    frames: renderedFrames,
    pages: packer.pages,
    atlasPx: font.atlasPx,
  };
}

function simulateClusterAtlas(frames, font) {
  const packer = createShelfPacker(font.atlasPx);
  const entriesByKey = new Map();
  const renderedFrames = [];
  const fontKey = rasterFontCacheKey(font, "cluster-atlas:heuristic");

  for (const runs of frames) {
    let uploadedBytesThisFrame = 0;
    let uploadCountThisFrame = 0;
    let drawQuads = 0;
    const positionedRuns = [];

    for (const text of runs) {
      const clusters = clusterText(text);
      for (const cluster of clusters) {
        if (cluster.skipTexture) continue;
        const key = `${fontKey}|${cluster.key}`;
        if (entriesByKey.has(key)) continue;
        const metrics = measureRun(cluster.text, font);
        const texturePx = paddedTexture(metrics.advanceCssPx, metrics.heightCssPx, font);
        const packed = packer.pack(texturePx.width, texturePx.height);
        const entry = {
          key,
          label: cluster.key,
          text: cluster.text,
          advanceCssPx: metrics.advanceCssPx,
          texturePx,
          bytes: textureBytes(texturePx),
          ...packed,
          uvRect: uvRect(packed, texturePx, font.atlasPx),
        };
        entriesByKey.set(key, entry);
        uploadedBytesThisFrame += entry.bytes;
        uploadCountThisFrame += 1;
      }

      const positioned = layoutClusters(clusters, font);
      positionedRuns.push(positioned);
      drawQuads += positioned.length;
    }

    renderedFrames.push({
      runs,
      positionedRuns,
      uploadedBytesThisFrame,
      uploadCountThisFrame,
      drawQuads,
    });
  }

  return {
    mode: "cluster-heuristic",
    entries: [...entriesByKey.values()],
    frames: renderedFrames,
    pages: packer.pages,
    atlasPx: font.atlasPx,
  };
}

function simulateMonospaceGlyphAtlas(frames, font) {
  const packer = createShelfPacker(font.atlasPx);
  const entriesByKey = new Map();
  const renderedFrames = [];
  const fontKey = rasterFontCacheKey(font, "glyph-atlas:monospace");
  const cellMetrics = monospaceCellMetrics(font);
  const texturePx = paddedTexture(cellMetrics.advanceCssPx, cellMetrics.heightCssPx, font);
  const diagnostics = [];

  for (const runs of frames) {
    let uploadedBytesThisFrame = 0;
    let uploadCountThisFrame = 0;
    let drawQuads = 0;
    let rejectedRunsThisFrame = 0;
    const positionedRuns = [];

    for (const text of runs) {
      const diagnostic = diagnoseMonospaceRun(text, font);
      if (!diagnostic.eligible) {
        rejectedRunsThisFrame += 1;
        diagnostics.push(diagnostic);
        positionedRuns.push([]);
        continue;
      }

      const cells = monospaceCells(text);
      for (const cell of cells) {
        if (cell.lineBreak || INVISIBLE_MONO_CELLS.has(cell.text)) continue;

        const key = `${fontKey}|${cell.key}`;
        if (entriesByKey.has(key)) continue;
        const packed = packer.pack(texturePx.width, texturePx.height);
        const entry = {
          key,
          label: cell.key,
          text: cell.text,
          advanceCssPx: cellMetrics.advanceCssPx,
          texturePx,
          bytes: textureBytes(texturePx),
          ...packed,
          uvRect: uvRect(packed, texturePx, font.atlasPx),
        };
        entriesByKey.set(key, entry);
        uploadedBytesThisFrame += entry.bytes;
        uploadCountThisFrame += 1;
      }

      const positioned = layoutMonospaceCells(cells, cellMetrics);
      positionedRuns.push(positioned);
      drawQuads += positioned.filter((cell) => !cell.invisible).length;
    }

    renderedFrames.push({
      runs,
      positionedRuns,
      uploadedBytesThisFrame,
      uploadCountThisFrame,
      drawQuads,
      rejectedRunsThisFrame,
    });
  }

  return {
    mode: "monospace",
    entries: [...entriesByKey.values()],
    frames: renderedFrames,
    pages: packer.pages,
    atlasPx: font.atlasPx,
    cellMetrics: {
      advanceCssPx: round(cellMetrics.advanceCssPx),
      heightCssPx: round(cellMetrics.heightCssPx),
      texturePx,
    },
    diagnostics,
  };
}

function createShelfPacker(pageSize) {
  const pages = [{ shelves: [], usedArea: 0, slots: 0 }];

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
            const packed = { page: pageIndex, slot: page.slots, x: shelf.x, y: shelf.y };
            shelf.x += width;
            page.usedArea += width * height;
            page.slots += 1;
            return packed;
          }
        }

        const y = page.shelves.reduce((sum, shelf) => sum + shelf.height, 0);
        if (y + height <= pageSize) {
          const packed = { page: pageIndex, slot: page.slots, x: 0, y };
          page.shelves.push({ x: width, y, height });
          page.usedArea += width * height;
          page.slots += 1;
          return packed;
        }
      }

      pages.push({ shelves: [{ x: width, y: 0, height }], usedArea: width * height, slots: 1 });
      return { page: pages.length - 1, slot: 0, x: 0, y: 0 };
    },
  };
}

function glyphUnits(text) {
  return Array.from(text, (char) => {
    if (char === "\n") return lineBreakUnit();
    return { key: `cp:${stableCodeKey(char)}`, text: char };
  });
}

function clusterText(text) {
  const clusters = [];
  const graphemes = segmentText(text, "grapheme").segments;
  for (let index = 0; index < graphemes.length; index += 1) {
    const current = graphemes[index];
    const next = graphemes[index + 1];
    const third = graphemes[index + 2];
    if (current === "\n") {
      clusters.push(lineBreakUnit());
      continue;
    }
    if (current === "f" && next === "f" && third === "i") {
      clusters.push({ key: "lig:ffi", text: "ffi" });
      index += 2;
      continue;
    }
    if (current === "f" && next === "i") {
      clusters.push({ key: "lig:fi", text: "fi" });
      index += 1;
      continue;
    }
    clusters.push({ key: `cl:${stableCodeKey(current)}`, text: current });
  }
  return clusters;
}

function lineBreakUnit() {
  return { key: "newline", text: "\n", lineBreak: true, skipTexture: true };
}

function monospaceCells(text) {
  return Array.from(text, (char) => {
    if (char === "\n") return lineBreakUnit();
    return {
      key: `mono:${stableCodeKey(char)}`,
      text: char,
      source: char,
    };
  });
}

function layoutClusters(clusters, font) {
  let x = 0;
  let y = 0;
  let previous = "";
  const lineHeight = font.sizeCssPx * 1.25;
  const positioned = [];
  for (const cluster of clusters) {
    if (cluster.lineBreak) {
      x = 0;
      y += lineHeight;
      previous = "";
      continue;
    }
    const kern = kerningCssPx(previous, cluster.text, font.sizeCssPx);
    x += kern;
    const advance = measureRun(cluster.text, font).advanceCssPx;
    if (!cluster.skipTexture) {
      positioned.push({
        key: cluster.key,
        xCssPx: round(x),
        yCssPx: round(y),
        advanceCssPx: round(advance),
      });
    }
    x += advance;
    previous = cluster.text;
  }
  return positioned;
}

function layoutMonospaceCells(cells, metrics) {
  let column = 0;
  let row = 0;
  const positioned = [];
  for (const cell of cells) {
    if (cell.lineBreak) {
      column = 0;
      row += 1;
      continue;
    }
    positioned.push({
      key: cell.key,
      source: cell.source,
      xCssPx: round(column * metrics.advanceCssPx),
      yCssPx: round(row * metrics.heightCssPx),
      advanceCssPx: round(metrics.advanceCssPx),
      invisible: INVISIBLE_MONO_CELLS.has(cell.text),
    });
    column += 1;
  }
  return positioned;
}

function measureRun(text, font) {
  const lines = text.split("\n");
  if (lines.length > 1) {
    const lineMetrics = lines.map((line) => measureRun(line, font));
    return {
      advanceCssPx: Math.max(1, ...lineMetrics.map((metrics) => metrics.advanceCssPx)),
      heightCssPx: font.sizeCssPx * 1.25 * lines.length,
    };
  }

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
  const graphemes = segmentText(text, "grapheme").segments;
  for (let index = 0; index < graphemes.length; index += 1) {
    const current = graphemes[index];
    const next = graphemes[index + 1];
    const third = graphemes[index + 2];
    if (current === "f" && next === "f" && third === "i") {
      clusters.push("ffi");
      index += 2;
      continue;
    }
    if (current === "f" && next === "i") {
      clusters.push("fi");
      index += 1;
      continue;
    }
    clusters.push(current);
  }
  return clusters;
}

function glyphWidthEm(cluster) {
  if (cluster === "") return 0;
  if (cluster === "ffi") return 0.92;
  if (cluster === "fi") return 0.58;
  if (cluster === " ") return 0.31;
  if (cluster === ".") return 0.28;
  if (cluster === "%") return 0.86;
  if (isOnlyCombiningMarks(cluster)) return 0;
  if (containsEmoji(cluster)) return 1;
  if (containsCjk(cluster)) return 1;
  if (containsRtl(cluster)) return 0.58;
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
  if (pair === "ffi") return -0.02;
  return 0;
}

function diagnoseMonospaceRun(text, font) {
  const reasons = [];
  if (!isMonospaceFamily(font.family)) reasons.push("font-family-not-declared-monospace");
  if (!/^[\x20-\x7E\n]*$/u.test(text)) reasons.push("non-ascii-or-control-codepoint");
  if (/fi|ffi/u.test(text)) reasons.push("ligature-sensitive-text");
  if (isCombiningMark(text)) reasons.push("combining-mark");
  if (containsEmoji(text)) reasons.push("emoji-or-color-glyph");
  if (containsRtl(text)) reasons.push("rtl-or-bidi-script");
  if (containsCjk(text)) reasons.push("cjk-or-wide-script");
  return {
    text,
    eligible: reasons.length === 0,
    reasons,
  };
}

function isMonospaceFamily(family) {
  return /\bmono(space)?\b|ui-monospace|Menlo|Consolas|Courier/u.test(family);
}

function analyzeRuns(runs, font) {
  return runs.map((text) => ({
    text,
    segmentation: segmentationStats(text),
    features: detectTextFeatures(text),
    monospaceDiagnostic: diagnoseMonospaceRun(text, font),
  }));
}

function segmenterStatus() {
  return {
    intlSegmenterAvailable: typeof Intl?.Segmenter === "function",
    fallback: "graphemes fall back to Array.from(code points); word stats fall back to whitespace tokens",
  };
}

function segmentText(text, granularity) {
  if (typeof Intl?.Segmenter === "function") {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity });
      const parts = [...segmenter.segment(text)];
      return {
        available: true,
        granularity,
        segments: parts.map((part) => part.segment),
        raw: parts,
      };
    } catch {
      // Fall through to deterministic fallback.
    }
  }

  if (granularity === "word") {
    const words = text.trim() === "" ? [] : text.trim().split(/\s+/u);
    return {
      available: false,
      granularity,
      segments: words,
      raw: words.map((segment) => ({ segment, isWordLike: true })),
    };
  }

  return {
    available: false,
    granularity,
    segments: Array.from(text),
    raw: Array.from(text, (segment) => ({ segment })),
  };
}

function segmentationStats(text) {
  const grapheme = segmentText(text, "grapheme");
  const word = segmentText(text, "word");
  const wordLikeCount = word.raw.filter((part) => part.isWordLike === true).length;
  return {
    intlSegmenter: grapheme.available && word.available,
    utf16CodeUnits: text.length,
    codePoints: Array.from(text).length,
    graphemes: grapheme.segments.length,
    words: wordLikeCount || word.segments.filter((part) => /\S/u.test(part)).length,
    sampleGraphemes: grapheme.segments.slice(0, 12),
  };
}

function detectTextFeatures(text) {
  return {
    hasKerningPair: /AV|To/u.test(text),
    hasLigatureCandidate: /ffi|fi/u.test(text),
    hasCombiningMarks: isCombiningMark(text),
    hasEmoji: containsEmoji(text),
    hasRtlOrBidi: containsRtl(text),
    hasCjk: containsCjk(text),
    hasLineBreaks: text.includes("\n"),
  };
}

function stableCodeKey(text) {
  return Array.from(text, (char) => char.codePointAt(0).toString(16)).join("-");
}

function isCombiningMark(text) {
  return /\p{Mark}/u.test(text);
}

function isOnlyCombiningMarks(text) {
  return /^\p{Mark}+$/u.test(text);
}

function containsEmoji(text) {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(text);
}

function containsRtl(text) {
  return /\p{Script=Arabic}|\p{Script=Hebrew}/u.test(text);
}

function containsCjk(text) {
  return /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text);
}

function monospaceCellMetrics(font) {
  return {
    advanceCssPx: font.sizeCssPx * font.monoCellEm,
    heightCssPx: font.sizeCssPx * font.monoLineEm,
  };
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

function uvRect(packed, texturePx, atlasPx) {
  return {
    u0: round(packed.x / atlasPx),
    v0: round(packed.y / atlasPx),
    u1: round((packed.x + texturePx.width) / atlasPx),
    v1: round((packed.y + texturePx.height) / atlasPx),
  };
}

function rasterFontCacheKey(font, mode) {
  return [
    `mode=${mode}`,
    `family=${font.family}`,
    `weight=${font.weight}`,
    `style=${font.style}`,
    `size=${font.sizeCssPx}`,
    `dpr=${font.dpr}`,
    `pad=${font.paddingCssPx}`,
    `atlas=${font.atlasPx}`,
    mode.includes("monospace") ? `cell=${font.monoCellEm}/${font.monoLineEm}` : "",
  ]
    .filter(Boolean)
    .join(";");
}

function summarizeWholeRun(result) {
  const frames = result.frames;
  const cachedRuns = [...result.cache.values()];
  return {
    distinctRunTextures: cachedRuns.length,
    uploads: sum(frames, (frame) => frame.uploadCountThisFrame),
    uploadedBytes: sum(frames, (frame) => frame.uploadedBytesThisFrame),
    uploaded: formatBytes(sum(frames, (frame) => frame.uploadedBytesThisFrame)),
    residentBytesCurrentFrameOnly: sum(frames.at(-1).runRecords, (run) => run.bytes),
    residentCurrentFrameOnly: formatBytes(sum(frames.at(-1).runRecords, (run) => run.bytes)),
    residentBytesIfAllEditStatesCached: sum(cachedRuns, (run) => run.bytes),
    residentIfAllEditStatesCached: formatBytes(sum(cachedRuns, (run) => run.bytes)),
    peakTexturePx: maxBy(cachedRuns, (run) => run.bytes).texturePx,
    finalDrawQuads: frames.at(-1).drawQuads,
    maxDrawQuadsPerFrame: Math.max(...frames.map((frame) => frame.drawQuads)),
  };
}

function summarizeAtlas(result) {
  const residentBytes = result.pages.length * result.atlasPx * result.atlasPx * 4;
  const usedArea = sum(result.pages, (page) => page.usedArea);
  return {
    mode: result.mode,
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
    rejectedRuns: sum(result.frames, (frame) => frame.rejectedRunsThisFrame ?? 0),
    diagnosticCount: result.diagnostics?.length ?? 0,
    diagnosticReasons: summarizeDiagnosticReasons(result.diagnostics ?? []),
  };
}

function summarizeDiagnosticReasons(diagnostics) {
  const counts = new Map();
  for (const diagnostic of diagnostics) {
    for (const reason of diagnostic.reasons) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function compareChurn(wholeFrames, glyphFrames, clusterFrames, monospaceFrames) {
  return wholeFrames.map((whole, index) => ({
    frame: index + 1,
    runs: whole.runs.length,
    wholeRunUploadBytes: whole.uploadedBytesThisFrame,
    glyphAtlasUploadBytes: glyphFrames[index].uploadedBytesThisFrame,
    glyphAtlasNewEntries: glyphFrames[index].uploadCountThisFrame,
    clusterAtlasUploadBytes: clusterFrames[index].uploadedBytesThisFrame,
    clusterAtlasNewEntries: clusterFrames[index].uploadCountThisFrame,
    monospaceAtlasUploadBytes: monospaceFrames[index].uploadedBytesThisFrame,
    monospaceAtlasNewEntries: monospaceFrames[index].uploadCountThisFrame,
    monospaceAtlasRejectedRuns: monospaceFrames[index].rejectedRunsThisFrame,
    wholeRunDrawQuads: whole.drawQuads,
    glyphAtlasDrawQuads: glyphFrames[index].drawQuads,
    clusterAtlasDrawQuads: clusterFrames[index].drawQuads,
    monospaceAtlasDrawQuads: monospaceFrames[index].drawQuads,
  }));
}

function previewAtlasEntries(entries, limit = 12) {
  return {
    total: entries.length,
    shown: Math.min(entries.length, limit),
    omitted: Math.max(0, entries.length - limit),
    entries: entries.slice(0, limit).map(publicAtlasEntry),
  };
}

function publicAtlasEntry(entry) {
  return {
    label: entry.label,
    text: entry.text,
    texturePx: entry.texturePx,
    advanceCssPx: round(entry.advanceCssPx),
    atlas: {
      page: entry.page,
      slot: entry.slot,
      x: entry.x,
      y: entry.y,
      uvRect: entry.uvRect,
    },
  };
}

function unionTexturePx(runs) {
  return {
    width: runs.length === 0 ? 0 : Math.max(...runs.map((run) => run.texturePx.width)),
    height: sum(runs, (run) => run.texturePx.height),
  };
}

function benchmark(frames, font, monospaceFont, iterations) {
  const wholeStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateWholeRunTexture(frames, font);
  const wholeMs = performance.now() - wholeStart;

  const glyphStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateGlyphAtlas(frames, font);
  const glyphMs = performance.now() - glyphStart;

  const clusterStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateClusterAtlas(frames, font);
  const clusterMs = performance.now() - clusterStart;

  const monospaceStart = performance.now();
  for (let index = 0; index < iterations; index += 1) simulateMonospaceGlyphAtlas(frames, monospaceFont);
  const monospaceMs = performance.now() - monospaceStart;

  return {
    iterations,
    wholeRunMs: round(wholeMs),
    glyphAtlasMs: round(glyphMs),
    clusterAtlasMs: round(clusterMs),
    monospaceGlyphAtlasMs: round(monospaceMs),
    wholeRunUsPerSimulation: round((wholeMs * 1000) / iterations),
    glyphAtlasUsPerSimulation: round((glyphMs * 1000) / iterations),
    clusterAtlasUsPerSimulation: round((clusterMs * 1000) / iterations),
    monospaceGlyphAtlasUsPerSimulation: round((monospaceMs * 1000) / iterations),
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

#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

const defaultText = "AV office Royal 123";
const defaultSize = 1;
const defaultTolerance = 0.006;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fontPath = args.font ?? findFontPath();
  const text = args.text ?? defaultText;
  const size = numberArg(args.size, defaultSize);
  const tolerance = numberArg(args.tolerance, defaultTolerance);
  const edits = [
    text,
    `${text}.`,
    text.replace("office", "offline"),
    text.replace("Royal", "Royal vector"),
  ];

  const started = performance.now();
  const font = parseTrueTypeFont(readFileSync(fontPath), fontPath);
  const parsedMs = performance.now() - started;
  const run = measureRealFontRun(font, text, size, tolerance);
  const churn = measureEditChurn(font, edits, size, tolerance);
  const current = await measureCurrentRenderer(text);

  const report = {
    prototype: "real-font-vector-path-text",
    input: {
      fontPath,
      text,
      size,
      tolerance,
      atkinsonHyperlegible: /atkinson|hyperlegible/i.test(fontPath),
    },
    font: {
      family: font.names.fullName ?? font.names.family ?? "unknown",
      unitsPerEm: font.unitsPerEm,
      ascender: font.ascender,
      descender: font.descender,
      lineGap: font.lineGap,
      glyphs: font.numGlyphs,
      kerningPairs: font.kerning.size,
      parsedMs: round(parsedMs),
    },
    outlineParsing: run.outlineParsing,
    curveFlattening: run.curveFlattening,
    triangulation: {
      status: "estimated-only",
      estimatedTriangles: run.estimatedTriangles,
      note: "Production needs a hole-aware triangulator; this prototype does not fill counters or overlapping contours.",
    },
    metricsAndKerning: run.metricsAndKerning,
    vertexCounts: {
      realFont: run.vertexCounts,
      currentRenderer: current.vertexCounts,
    },
    crispness: {
      status: "vector-outline",
      note: "Flattened font curves preserve glyph identity at arbitrary world scale; crisp edges should be handled with coverage/MSAA, not raster text.",
    },
    dynamicChurn: churn,
    currentSyntheticPath: current,
    pruningRecommendation: [
      "Replace synthetic bar/stem/dot/fill text with real outline glyph meshes.",
      "Keep glyph outline geometry cached by font/glyph/size/tolerance and treat layout as cheap dynamic state.",
      "Do not add raster text support unless paragraph text, emoji/color glyphs, LCD subpixel parity, or browser font fidelity becomes a hard requirement.",
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

function findFontPath() {
  const explicit = process.env.ATKINSON_FONT_PATH;
  if (explicit !== undefined && existsSync(explicit)) return explicit;

  const roots = [
    join(homedir(), ".local/share/fonts"),
    join(homedir(), ".fonts"),
    "/usr/share/fonts",
  ];
  const atkinson = findFirstFont(roots, /atkinson|hyperlegible/i);
  if (atkinson !== undefined) return atkinson;

  const fallbacks = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
  ];
  const fallback = fallbacks.find((candidate) => existsSync(candidate));
  if (fallback !== undefined) return fallback;
  throw new Error("No local TrueType font found. Pass --font /path/to/font.ttf.");
}

function findFirstFont(roots, pattern) {
  for (const root of roots) {
    const found = walkFonts(root, pattern);
    if (found !== undefined) return found;
  }
  return undefined;
}

function walkFonts(root, pattern) {
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      const found = walkFonts(path, pattern);
      if (found !== undefined) return found;
      continue;
    }
    if (stat.isFile() && /\.ttf$/i.test(name) && pattern.test(path)) return path;
  }
  return undefined;
}

function parseTrueTypeFont(buffer, source) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const tables = readTableDirectory(view);
  const required = ["head", "hhea", "hmtx", "maxp", "loca", "glyf", "cmap"];
  for (const tag of required) {
    if (tables.get(tag) === undefined) throw new Error(`Font ${source} is missing required ${tag} table`);
  }

  const head = tables.get("head");
  const hhea = tables.get("hhea");
  const maxp = tables.get("maxp");
  const hmtx = tables.get("hmtx");
  const loca = tables.get("loca");
  const name = tables.get("name");
  const kern = tables.get("kern");

  const unitsPerEm = u16(view, head.offset + 18);
  const indexToLocFormat = i16(view, head.offset + 50);
  const ascender = i16(view, hhea.offset + 4);
  const descender = i16(view, hhea.offset + 6);
  const lineGap = i16(view, hhea.offset + 8);
  const numberOfHMetrics = u16(view, hhea.offset + 34);
  const numGlyphs = u16(view, maxp.offset + 4);
  const locaOffsets = readLoca(view, loca.offset, numGlyphs, indexToLocFormat);
  const hMetrics = readHMetrics(view, hmtx.offset, numGlyphs, numberOfHMetrics);
  const cmap = readCmap(view, tables.get("cmap").offset);
  const kerning = kern === undefined ? new Map() : readKern(view, kern.offset);

  return {
    source,
    view,
    tables,
    unitsPerEm,
    ascender,
    descender,
    lineGap,
    numGlyphs,
    locaOffsets,
    hMetrics,
    cmap,
    kerning,
    names: name === undefined ? {} : readNames(view, name.offset),
    glyphCache: new Map(),
  };
}

function readTableDirectory(view) {
  const numTables = u16(view, 4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const offset = 12 + index * 16;
    const tag = tagAt(view, offset);
    tables.set(tag, {
      offset: u32(view, offset + 8),
      length: u32(view, offset + 12),
    });
  }
  return tables;
}

function readLoca(view, offset, numGlyphs, indexToLocFormat) {
  const locations = [];
  for (let index = 0; index <= numGlyphs; index += 1) {
    locations.push(indexToLocFormat === 0 ? u16(view, offset + index * 2) * 2 : u32(view, offset + index * 4));
  }
  return locations;
}

function readHMetrics(view, offset, numGlyphs, numberOfHMetrics) {
  const metrics = [];
  let lastAdvance = 0;
  for (let index = 0; index < numGlyphs; index += 1) {
    if (index < numberOfHMetrics) {
      const metricOffset = offset + index * 4;
      lastAdvance = u16(view, metricOffset);
      metrics.push({ advanceWidth: lastAdvance, leftSideBearing: i16(view, metricOffset + 2) });
      continue;
    }
    const lsbOffset = offset + numberOfHMetrics * 4 + (index - numberOfHMetrics) * 2;
    metrics.push({ advanceWidth: lastAdvance, leftSideBearing: i16(view, lsbOffset) });
  }
  return metrics;
}

function readCmap(view, cmapOffset) {
  const numTables = u16(view, cmapOffset + 2);
  const subtables = [];
  for (let index = 0; index < numTables; index += 1) {
    const record = cmapOffset + 4 + index * 8;
    const platformId = u16(view, record);
    const encodingId = u16(view, record + 2);
    const offset = cmapOffset + u32(view, record + 4);
    const format = u16(view, offset);
    subtables.push({ platformId, encodingId, offset, format });
  }

  const format12 = subtables.find((table) => table.format === 12 && table.platformId === 3);
  if (format12 !== undefined) return codePointToGlyphFormat12(view, format12.offset);

  const format4 = subtables.find((table) => table.format === 4 && table.platformId === 3)
    ?? subtables.find((table) => table.format === 4);
  if (format4 !== undefined) return codePointToGlyphFormat4(view, format4.offset);

  throw new Error("No usable cmap format 4 or 12 table found");
}

function codePointToGlyphFormat12(view, offset) {
  const groups = [];
  const nGroups = u32(view, offset + 12);
  for (let index = 0; index < nGroups; index += 1) {
    const group = offset + 16 + index * 12;
    groups.push({
      startCharCode: u32(view, group),
      endCharCode: u32(view, group + 4),
      startGlyphId: u32(view, group + 8),
    });
  }
  return (codePoint) => {
    for (const group of groups) {
      if (codePoint < group.startCharCode || codePoint > group.endCharCode) continue;
      return group.startGlyphId + codePoint - group.startCharCode;
    }
    return 0;
  };
}

function codePointToGlyphFormat4(view, offset) {
  const segCount = u16(view, offset + 6) / 2;
  const endCodeOffset = offset + 14;
  const startCodeOffset = endCodeOffset + segCount * 2 + 2;
  const idDeltaOffset = startCodeOffset + segCount * 2;
  const idRangeOffsetOffset = idDeltaOffset + segCount * 2;

  return (codePoint) => {
    if (codePoint > 0xffff) return 0;
    for (let index = 0; index < segCount; index += 1) {
      const endCode = u16(view, endCodeOffset + index * 2);
      const startCode = u16(view, startCodeOffset + index * 2);
      if (codePoint < startCode || codePoint > endCode) continue;

      const idDelta = i16(view, idDeltaOffset + index * 2);
      const rangeOffsetAddress = idRangeOffsetOffset + index * 2;
      const rangeOffset = u16(view, rangeOffsetAddress);
      if (rangeOffset === 0) return (codePoint + idDelta) & 0xffff;

      const glyphAddress = rangeOffsetAddress + rangeOffset + (codePoint - startCode) * 2;
      const glyphId = u16(view, glyphAddress);
      return glyphId === 0 ? 0 : (glyphId + idDelta) & 0xffff;
    }
    return 0;
  };
}

function readKern(view, offset) {
  const pairs = new Map();
  const version = u16(view, offset);
  const nTables = u16(view, offset + 2);
  if (version !== 0) return pairs;

  let tableOffset = offset + 4;
  for (let table = 0; table < nTables; table += 1) {
    const length = u16(view, tableOffset + 2);
    const coverage = u16(view, tableOffset + 4);
    const format = coverage >> 8;
    if (format === 0) {
      const nPairs = u16(view, tableOffset + 6);
      for (let index = 0; index < nPairs; index += 1) {
        const pairOffset = tableOffset + 14 + index * 6;
        const left = u16(view, pairOffset);
        const right = u16(view, pairOffset + 2);
        pairs.set(`${left}/${right}`, i16(view, pairOffset + 4));
      }
    }
    tableOffset += length;
  }
  return pairs;
}

function readNames(view, offset) {
  const count = u16(view, offset + 2);
  const stringOffset = offset + u16(view, offset + 4);
  const names = {};
  for (let index = 0; index < count; index += 1) {
    const record = offset + 6 + index * 12;
    const platformId = u16(view, record);
    const nameId = u16(view, record + 6);
    const length = u16(view, record + 8);
    const valueOffset = stringOffset + u16(view, record + 10);
    if (nameId !== 1 && nameId !== 4) continue;
    const value = platformId === 0 || platformId === 3
      ? readUtf16be(view, valueOffset, length)
      : readAscii(view, valueOffset, length);
    if (nameId === 1 && names.family === undefined) names.family = value;
    if (nameId === 4 && names.fullName === undefined) names.fullName = value;
  }
  return names;
}

function measureRealFontRun(font, text, size, tolerance) {
  const scale = size / font.unitsPerEm;
  const started = performance.now();
  const glyphRuns = [];
  let cursor = 0;
  let previousGlyphId = undefined;
  let missingGlyphs = 0;
  let totalKerning = 0;

  for (const char of text) {
    const codePoint = char.codePointAt(0);
    const glyphId = font.cmap(codePoint);
    if (glyphId === 0 && char !== "\u0000") missingGlyphs += 1;
    const kern = previousGlyphId === undefined ? 0 : font.kerning.get(`${previousGlyphId}/${glyphId}`) ?? 0;
    const metric = font.hMetrics[glyphId] ?? font.hMetrics[0];
    const glyph = readGlyph(font, glyphId);
    glyphRuns.push({
      char,
      codePoint,
      glyphId,
      x: cursor + kern * scale,
      advance: metric.advanceWidth * scale,
      kerning: kern * scale,
      contourCount: glyph.contours.length,
      composite: glyph.composite,
    });
    cursor += (metric.advanceWidth + kern) * scale;
    previousGlyphId = glyphId;
    totalKerning += kern * scale;
  }

  const layoutMs = performance.now() - started;
  const flattenStarted = performance.now();
  let rawContours = 0;
  let flattenedContours = 0;
  let flattenedVertices = 0;
  let estimatedTriangles = 0;
  let positiveWindingContours = 0;
  let negativeWindingContours = 0;
  let compositeGlyphs = 0;
  const glyphKeys = new Set();

  for (const run of glyphRuns) {
    const glyph = readGlyph(font, run.glyphId);
    if (glyph.composite) compositeGlyphs += 1;
    glyphKeys.add(cacheKey(run.glyphId, size, tolerance));
    rawContours += glyph.contours.length;

    for (const contour of glyph.contours) {
      const flattened = flattenContour(contour, tolerance / scale);
      if (flattened.length < 3) continue;
      flattenedContours += 1;
      flattenedVertices += flattened.length;
      estimatedTriangles += Math.max(0, flattened.length - 2);
      if (signedArea(flattened) < 0) negativeWindingContours += 1;
      else positiveWindingContours += 1;
    }
  }
  const flattenMs = performance.now() - flattenStarted;

  return {
    outlineParsing: {
      status: "local-ttf-glyf",
      glyphsSeen: glyphRuns.length,
      uniqueGlyphs: glyphKeys.size,
      rawContours,
      compositeGlyphs,
      missingGlyphs,
      layoutMs: round(layoutMs),
    },
    curveFlattening: {
      tolerance,
      flattenedContours,
      flattenedVertices,
      winding: {
        positive: positiveWindingContours,
        negative: negativeWindingContours,
      },
      flattenMs: round(flattenMs),
    },
    estimatedTriangles,
    metricsAndKerning: {
      advance: round(cursor),
      proportional: true,
      kerningPairsApplied: glyphRuns.filter((run) => run.kerning !== 0).length,
      totalKerning: round(totalKerning),
      glyphs: glyphRuns.map((run) => ({
        char: run.char,
        glyphId: run.glyphId,
        x: round(run.x),
        advance: round(run.advance),
        kerning: round(run.kerning),
        contours: run.contourCount,
      })),
    },
    vertexCounts: {
      vertices: flattenedVertices,
      indices: estimatedTriangles * 3,
      uint16Safe: flattenedVertices <= 65535,
    },
  };
}

function measureEditChurn(font, edits, size, tolerance) {
  const frames = [];
  let previousKeys = new Set();
  const seenKeys = new Set();
  for (const text of edits) {
    const glyphIds = [...text].map((char) => font.cmap(char.codePointAt(0)));
    const keys = new Set(glyphIds.map((glyphId) => cacheKey(glyphId, size, tolerance)));
    const added = [...keys].filter((key) => !previousKeys.has(key)).length;
    const removed = [...previousKeys].filter((key) => !keys.has(key)).length;
    const cacheMisses = [...keys].filter((key) => !seenKeys.has(key)).length;
    for (const key of keys) seenKeys.add(key);
    frames.push({
      text,
      glyphs: glyphIds.length,
      uniqueGlyphOutlines: keys.size,
      geometryCacheMisses: cacheMisses,
      geometryCacheHits: keys.size - cacheMisses,
      changedOutlinesFromPrevious: added + removed,
    });
    previousKeys = keys;
  }
  return {
    policy: "cache glyph outlines; rebuild layout records per text edit",
    frames,
  };
}

async function measureCurrentRenderer(text) {
  try {
    const renderer = await import("../../packages/renderer-core/dist/index.js");
    const node = renderer.text({ color: [1, 1, 1, 1], text });
    const mesh = renderer.textMesh(node);
    return {
      status: "measured-from-dist",
      family: node.layout.font.family,
      diagnostics: node.diagnostics.map((diagnostic) => diagnostic.code),
      contours: mesh.contours.length,
      roles: countBy(mesh.contours.map((contour) => contour.role)),
      vertexCounts: {
        vertices: mesh.vertices.length,
        indices: mesh.indices.length,
        uint16Safe: mesh.vertices.length <= 65535,
      },
      pruningNote: "Current mesh is assembled from synthetic rectangle roles, not real glyph outlines.",
    };
  } catch (error) {
    return {
      status: "unavailable",
      error: error instanceof Error ? error.message : String(error),
      vertexCounts: null,
      pruningNote: "renderer-core dist import was unavailable; inspect packages/renderer-core/src/text.ts for synthetic rectangle roles.",
    };
  }
}

function readGlyph(font, glyphId, depth = 0) {
  const key = `${glyphId}`;
  if (font.glyphCache.has(key)) return font.glyphCache.get(key);
  if (depth > 8) return { contours: [], composite: true };

  const glyf = font.tables.get("glyf");
  const start = glyf.offset + font.locaOffsets[glyphId];
  const end = glyf.offset + font.locaOffsets[glyphId + 1];
  if (start === end) {
    const empty = { contours: [], composite: false };
    font.glyphCache.set(key, empty);
    return empty;
  }

  const numberOfContours = i16(font.view, start);
  const glyph = numberOfContours >= 0
    ? readSimpleGlyph(font.view, start, numberOfContours)
    : readCompositeGlyph(font, start, depth);
  font.glyphCache.set(key, glyph);
  return glyph;
}

function readSimpleGlyph(view, offset, numberOfContours) {
  if (numberOfContours === 0) return { contours: [], composite: false };
  const endPts = [];
  for (let index = 0; index < numberOfContours; index += 1) {
    endPts.push(u16(view, offset + 10 + index * 2));
  }

  const pointCount = endPts.at(-1) + 1;
  let cursor = offset + 10 + numberOfContours * 2;
  const instructionLength = u16(view, cursor);
  cursor += 2 + instructionLength;

  const flags = [];
  while (flags.length < pointCount) {
    const flag = u8(view, cursor);
    cursor += 1;
    flags.push(flag);
    if ((flag & 0x08) === 0) continue;
    const repeat = u8(view, cursor);
    cursor += 1;
    for (let count = 0; count < repeat; count += 1) flags.push(flag);
  }

  const xs = [];
  let x = 0;
  for (const flag of flags) {
    let delta = 0;
    if ((flag & 0x02) !== 0) {
      const value = u8(view, cursor);
      cursor += 1;
      delta = (flag & 0x10) !== 0 ? value : -value;
    } else if ((flag & 0x10) === 0) {
      delta = i16(view, cursor);
      cursor += 2;
    }
    x += delta;
    xs.push(x);
  }

  const ys = [];
  let y = 0;
  for (const flag of flags) {
    let delta = 0;
    if ((flag & 0x04) !== 0) {
      const value = u8(view, cursor);
      cursor += 1;
      delta = (flag & 0x20) !== 0 ? value : -value;
    } else if ((flag & 0x20) === 0) {
      delta = i16(view, cursor);
      cursor += 2;
    }
    y += delta;
    ys.push(y);
  }

  const points = xs.map((pointX, index) => ({
    x: pointX,
    y: ys[index],
    on: (flags[index] & 0x01) !== 0,
  }));
  const contours = [];
  let first = 0;
  for (const last of endPts) {
    contours.push(points.slice(first, last + 1));
    first = last + 1;
  }
  return { contours, composite: false };
}

function readCompositeGlyph(font, offset, depth) {
  const contours = [];
  let cursor = offset + 10;
  let flags = 0;
  do {
    flags = u16(font.view, cursor);
    const componentGlyphId = u16(font.view, cursor + 2);
    cursor += 4;

    let arg1 = 0;
    let arg2 = 0;
    if ((flags & 0x0001) !== 0) {
      arg1 = i16(font.view, cursor);
      arg2 = i16(font.view, cursor + 2);
      cursor += 4;
    } else {
      arg1 = i8(font.view, cursor);
      arg2 = i8(font.view, cursor + 1);
      cursor += 2;
    }

    let a = 1;
    let b = 0;
    let c = 0;
    let d = 1;
    if ((flags & 0x0008) !== 0) {
      a = fixed2dot14(font.view, cursor);
      d = a;
      cursor += 2;
    } else if ((flags & 0x0040) !== 0) {
      a = fixed2dot14(font.view, cursor);
      d = fixed2dot14(font.view, cursor + 2);
      cursor += 4;
    } else if ((flags & 0x0080) !== 0) {
      a = fixed2dot14(font.view, cursor);
      b = fixed2dot14(font.view, cursor + 2);
      c = fixed2dot14(font.view, cursor + 4);
      d = fixed2dot14(font.view, cursor + 6);
      cursor += 8;
    }

    const dx = (flags & 0x0002) !== 0 ? arg1 : 0;
    const dy = (flags & 0x0002) !== 0 ? arg2 : 0;
    const component = readGlyph(font, componentGlyphId, depth + 1);
    for (const contour of component.contours) {
      contours.push(contour.map((point) => ({
        x: point.x * a + point.y * c + dx,
        y: point.x * b + point.y * d + dy,
        on: point.on,
      })));
    }
  } while ((flags & 0x0020) !== 0);

  return { contours, composite: true };
}

function flattenContour(contour, tolerance) {
  if (contour.length === 0) return [];
  const expanded = [];
  for (let index = 0; index < contour.length; index += 1) {
    const point = contour[index];
    const next = contour[(index + 1) % contour.length];
    expanded.push(point);
    if (!point.on && !next.on) expanded.push(midpoint(point, next));
  }

  const firstOn = expanded.findIndex((point) => point.on);
  if (firstOn === -1) return [];
  const ordered = expanded.slice(firstOn).concat(expanded.slice(0, firstOn));
  const result = [{ x: ordered[0].x, y: ordered[0].y }];
  let current = ordered[0];

  for (let index = 1; index <= ordered.length; index += 1) {
    const point = ordered[index % ordered.length];
    if (point.on) {
      pushDistinct(result, point);
      current = point;
      continue;
    }

    const next = ordered[(index + 1) % ordered.length];
    if (!next.on) continue;
    flattenQuadratic(result, current, point, next, tolerance);
    current = next;
    index += 1;
  }

  if (result.length > 1 && samePoint(result[0], result.at(-1))) result.pop();
  return result;
}

function flattenQuadratic(result, p0, p1, p2, tolerance) {
  if (quadraticFlatness(p0, p1, p2) <= tolerance) {
    pushDistinct(result, p2);
    return;
  }

  const p01 = midpoint(p0, p1);
  const p12 = midpoint(p1, p2);
  const p012 = midpoint(p01, p12);
  flattenQuadratic(result, p0, p01, p012, tolerance);
  flattenQuadratic(result, p012, p12, p2, tolerance);
}

function quadraticFlatness(p0, p1, p2) {
  const dx = p2.x - p0.x;
  const dy = p2.y - p0.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(p1.x - p0.x, p1.y - p0.y);
  return Math.abs(dy * p1.x - dx * p1.y + p2.x * p0.y - p2.y * p0.x) / length;
}

function pushDistinct(points, point) {
  if (points.length === 0 || !samePoint(points.at(-1), point)) {
    points.push({ x: point.x, y: point.y });
  }
}

function samePoint(a, b) {
  return a !== undefined && b !== undefined && a.x === b.x && a.y === b.y;
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function cacheKey(glyphId, size, tolerance) {
  return `${glyphId}@${size}@${tolerance}`;
}

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function tagAt(view, offset) {
  return String.fromCharCode(u8(view, offset), u8(view, offset + 1), u8(view, offset + 2), u8(view, offset + 3));
}

function readAscii(view, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) text += String.fromCharCode(u8(view, offset + index));
  return text;
}

function readUtf16be(view, offset, length) {
  let text = "";
  for (let index = 0; index < length; index += 2) text += String.fromCharCode(u16(view, offset + index));
  return text;
}

function round(value) {
  return Math.round(value * 1000000) / 1000000;
}

function u8(view, offset) {
  return view.getUint8(offset);
}

function i8(view, offset) {
  return view.getInt8(offset);
}

function u16(view, offset) {
  return view.getUint16(offset, false);
}

function i16(view, offset) {
  return view.getInt16(offset, false);
}

function u32(view, offset) {
  return view.getUint32(offset, false);
}

function fixed2dot14(view, offset) {
  return i16(view, offset) / 16384;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});

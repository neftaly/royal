#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsRoot = path.join(here, "demo-assets");
const reportRoot = path.join(assetsRoot, "report");
const mode = process.argv.includes("--check") ? "check" : "write";

async function main() {
  const manifest = await readJson(path.join(assetsRoot, "manifest.json"));
  const stream = await readJson(path.join(assetsRoot, manifest.stats.uri));

  await verifyReferencedArtifacts(manifest);

  const outputs = buildReportArtifacts(manifest, stream);
  if (mode === "check") {
    await checkArtifacts(outputs);
    console.log(
      `virtual texturing demo report checked: ${manifest.pages.length} pages, ${stream.frames.length} camera frames`,
    );
    return;
  }

  await writeArtifacts(outputs);
  console.log(
    `virtual texturing demo report generated: ${manifest.pages.length} pages, ${stream.frames.length} camera frames`,
  );
}

function buildReportArtifacts(manifest, stream) {
  const outputs = new Map();
  outputs.set("virtual-texturing-demo-readiness.svg", Buffer.from(buildSvg(manifest, stream), "utf8"));
  outputs.set("index.html", Buffer.from(buildHtml(manifest, stream), "utf8"));
  return outputs;
}

function buildSvg(manifest, stream) {
  const width = 1120;
  const height = 760;
  const pagesByMip = groupPagesByMip(manifest.pages);
  const summaryCards = [
    ["Pages", String(manifest.pages.length), `${manifest.virtualTexture.mipCount} mips`],
    ["Cache slots", String(stream.budget.physicalSlots), `${formatBytes(stream.budget.maxUploadBytesPerFrame)} frame cap`],
    ["Exact hits", percent(stream.summary.exactHitRatio), "tiny cold pan"],
    ["Seams", String(manifest.seamSafety.mismatches), `${manifest.seamSafety.pixelComparisons} border samples`],
  ];
  const probeRows = stream.probeRows.map((row) => ({
    ...row,
    status: probeStatus(row, stream),
  }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
  <title id="title">Royal virtual texturing demo readiness report</title>
  <desc id="desc">Summary of page table coverage, cache residency, camera pan stats, and seam checks generated from the research fixture.</desc>
  <style>
    text { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #172026; }
    .caption { fill: #50606a; font-size: 13px; }
    .small { fill: #50606a; font-size: 12px; }
    .label { fill: #24313a; font-size: 14px; font-weight: 700; }
    .value { fill: #11191f; font-size: 30px; font-weight: 800; }
    .panel { fill: #f7f4ed; stroke: #cfc4ac; stroke-width: 1; rx: 8; }
    .ink { fill: #172026; }
    .muted { fill: #6c7a82; }
    .pass { fill: #2d7d4f; }
    .warn { fill: #a35f00; }
    .info { fill: #315f8d; }
    .grid-line { stroke: #172026; stroke-opacity: 0.32; stroke-width: 1; }
    .axis { stroke: #7d8a91; stroke-width: 1; }
  </style>
  <rect width="${width}" height="${height}" fill="#e8e1d1"/>
  <text x="40" y="50" class="ink" font-size="31" font-weight="850">Virtual Texturing Demo Readiness</text>
  <text x="40" y="76" class="caption">${escapeXml(manifest.assetId)} - ${escapeXml(manifest.stage.recipe)}</text>
  <text x="810" y="52" class="label">Public shape</text>
  <text x="810" y="76" class="caption">asset/material resources, no public VirtualTextureNode</text>

  ${summaryCards.map((card, index) => metricCard(40 + index * 265, 108, 245, 112, card)).join("\n")}

  <rect x="40" y="250" width="420" height="320" class="panel"/>
  <text x="62" y="284" class="label">Page Table Overview</text>
  <text x="62" y="306" class="caption">${manifest.virtualTexture.dimensions.join(" x ")} virtual texels, ${manifest.virtualTexture.usableTileSize}px pages, ${manifest.virtualTexture.borderTexels}px border</text>
  ${pageTableSvg(pagesByMip)}

  <rect x="492" y="250" width="588" height="320" class="panel"/>
  <text x="514" y="284" class="label">Camera Pan Stats</text>
  <text x="514" y="306" class="caption">${stream.frames.length} frames, ${stream.summary.averageUploads} average uploads, ${stream.summary.totalEvictions} evictions</text>
  ${chartSvg(stream.frames, {
    x: 532,
    y: 334,
    width: 500,
    height: 138,
    series: [
      { key: "exactHitRatio", label: "exact hit ratio", color: "#2d7d4f", scale: 1 },
      { key: "uploadedPages", label: "uploads", color: "#315f8d", scale: stream.budget.maxUploadsPerFrame },
      { key: "seamCandidates", label: "seam candidates", color: "#a35f00", scale: Math.max(1, stream.summary.maxSeamCandidates) },
    ],
  })}
  ${probeRows.map((row, index) => probeRowSvg(522, 504 + index * 28, row)).join("\n")}

  <rect x="40" y="602" width="500" height="116" class="panel"/>
  <text x="62" y="636" class="label">Cache Overlay Snapshot</text>
  <text x="62" y="658" class="caption">${stream.overlayRows.filter((row) => row.status === "visible").length} visible slots, ${stream.overlayRows.filter((row) => row.status === "resident").length} resident slots</text>
  ${cacheOverlaySvg(stream.overlayRows)}

  <rect x="580" y="602" width="500" height="116" class="panel"/>
  <text x="602" y="636" class="label">Demo Gate</text>
  <text x="602" y="662" class="caption">Fixture is ready for renderer integration when hooks exist.</text>
  <text x="602" y="690" class="small">Next route: /labs/virtual-texturing in apps/examples-react.</text>
  <text x="602" y="710" class="small">First renderer work remains private: page table, physical cache, material binding.</text>
</svg>
`;
}

function metricCard(x, y, width, height, [label, value, caption]) {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" class="panel"/>
  <text x="${x + 20}" y="${y + 32}" class="label">${escapeXml(label)}</text>
  <text x="${x + 20}" y="${y + 72}" class="value">${escapeXml(value)}</text>
  <text x="${x + 20}" y="${y + 96}" class="caption">${escapeXml(caption)}</text>`;
}

function pageTableSvg(pagesByMip) {
  let out = "";
  let x = 62;
  const y = 332;
  for (const [mip, pages] of pagesByMip) {
    const axis = Math.max(...pages.map((page) => page.x)) + 1;
    const cell = mip === 0 ? 35 : mip === 1 ? 31 : 54;
    out += `<text x="${x}" y="${y - 14}" class="small">mip ${mip}</text>`;
    for (const page of pages) {
      const px = x + page.x * cell;
      const py = y + page.y * cell;
      out += `<rect x="${px}" y="${py}" width="${cell - 2}" height="${cell - 2}" fill="rgb(${page.averageColor.join(",")})" stroke="#172026" stroke-opacity="0.36"/>`;
    }
    out += `<rect x="${x}" y="${y}" width="${axis * cell - 2}" height="${axis * cell - 2}" fill="none" class="grid-line"/>`;
    x += Math.max(120, axis * cell + 44);
  }
  return out;
}

function chartSvg(frames, { x, y, width, height, series }) {
  const maxFrame = Math.max(1, frames.length - 1);
  const grid = [0, 0.25, 0.5, 0.75, 1]
    .map((tick) => `<line x1="${x}" y1="${y + height * tick}" x2="${x + width}" y2="${y + height * tick}" class="axis" opacity="0.28"/>`)
    .join("\n");
  const paths = series.map((row) => {
    const d = frames.map((frame, index) => {
      const px = x + (index / maxFrame) * width;
      const py = y + height - clamp(frame[row.key] / row.scale, 0, 1) * height;
      return `${index === 0 ? "M" : "L"} ${round(px)} ${round(py)}`;
    }).join(" ");
    return `<path d="${d}" fill="none" stroke="${row.color}" stroke-width="3" stroke-linejoin="round"/>`;
  }).join("\n");
  const legend = series.map((row, index) => {
    const lx = x + index * 154;
    return `<rect x="${lx}" y="${y + height + 26}" width="12" height="12" fill="${row.color}"/>
      <text x="${lx + 18}" y="${y + height + 37}" class="small">${escapeXml(row.label)}</text>`;
  }).join("\n");
  return `${grid}
  <rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" class="axis"/>
  ${paths}
  ${legend}`;
}

function probeRowSvg(x, y, row) {
  const colorClass = row.status === "pass" ? "pass" : row.status === "warn" ? "warn" : "info";
  return `<circle cx="${x}" cy="${y - 4}" r="5" class="${colorClass}"/>
  <text x="${x + 16}" y="${y}" class="small">${escapeXml(row.label)}: ${escapeXml(String(row.value))}</text>
  <text x="${x + 300}" y="${y}" class="small">${escapeXml(row.target)}</text>`;
}

function cacheOverlaySvg(rows) {
  const cell = 29;
  const x = 62;
  const y = 676;
  return rows.map((row, index) => {
    const color = `rgb(${row.averageColor.join(",")})`;
    const stroke = row.status === "visible" ? "#f4c542" : row.status === "resident" ? "#315f8d" : "#6c7a82";
    const opacity = row.status === "free" ? 0.45 : 1;
    return `<rect x="${x + index * (cell + 7)}" y="${y}" width="${cell}" height="${cell}" fill="${color}" opacity="${opacity}" stroke="${stroke}" stroke-width="3"/>
    <text x="${x + index * (cell + 7) + cell / 2}" y="${y + cell + 15}" text-anchor="middle" class="small">${index}</text>`;
  }).join("\n");
}

function buildHtml(manifest, stream) {
  const probeRows = stream.probeRows.map((row) => ({
    ...row,
    status: probeStatus(row, stream),
  }));
  const previewOverview = "../preview/terrain-pages-overview.png";
  const previewOverlay = "../preview/page-cache-debug-overlay.svg";
  const reportSvg = "./virtual-texturing-demo-readiness.svg";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Royal Virtual Texturing Demo Readiness</title>
  <style>
    :root { color-scheme: light; --ink: #172026; --muted: #50606a; --line: #cfc4ac; --paper: #f7f4ed; --bg: #e8e1d1; --pass: #2d7d4f; --warn: #a35f00; --info: #315f8d; }
    body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1120px; margin: 0 auto; padding: 32px 24px 48px; }
    h1 { margin: 0; font-size: 34px; line-height: 1.1; }
    h2 { margin: 0 0 12px; font-size: 18px; }
    p { margin: 8px 0 0; color: var(--muted); }
    a { color: var(--info); }
    .grid { display: grid; gap: 18px; }
    .cards { grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 26px 0; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .panel, .card { background: var(--paper); border: 1px solid var(--line); border-radius: 8px; padding: 18px; }
    .card strong { display: block; font-size: 30px; line-height: 1.1; margin: 8px 0; }
    .thumb { width: 100%; height: auto; border: 1px solid var(--line); background: #fff; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 7px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .pass { color: var(--pass); font-weight: 700; }
    .warn { color: var(--warn); font-weight: 700; }
    .info { color: var(--info); font-weight: 700; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.92em; }
    @media (max-width: 840px) { .cards, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <header>
      <h1>Virtual Texturing Demo Readiness</h1>
      <p><code>${escapeHtml(manifest.assetId)}</code> generated from <code>${escapeHtml(manifest.stage.recipe)}</code>. Public API stays asset/material shaped; there is no public <code>VirtualTextureNode</code>.</p>
    </header>

    <section class="grid cards" aria-label="Summary">
      ${summaryCardHtml("Pages", manifest.pages.length, `${manifest.virtualTexture.mipCount} mips`)}
      ${summaryCardHtml("Cache slots", stream.budget.physicalSlots, `${formatBytes(stream.budget.maxUploadBytesPerFrame)} frame cap`)}
      ${summaryCardHtml("Exact hits", percent(stream.summary.exactHitRatio), "tiny cold pan")}
      ${summaryCardHtml("Border mismatches", manifest.seamSafety.mismatches, `${manifest.seamSafety.pixelComparisons} samples`)}
    </section>

    <section class="grid two">
      <article class="panel">
        <h2>Page Table Overview</h2>
        <img class="thumb" src="${previewOverview}" alt="Generated terrain pages overview">
        <p>${manifest.virtualTexture.dimensions.join(" x ")} virtual texels, ${manifest.virtualTexture.usableTileSize}px usable pages, ${manifest.virtualTexture.borderTexels}px generated borders.</p>
      </article>
      <article class="panel">
        <h2>Cache Overlay</h2>
        <img class="thumb" src="${previewOverlay}" alt="Page cache debug overlay">
        <p>${stream.overlayRows.filter((row) => row.status === "visible").length} visible slots, ${stream.overlayRows.filter((row) => row.status === "resident").length} resident slots, ${stream.summary.totalEvictions} evictions.</p>
      </article>
    </section>

    <section class="panel" style="margin-top: 18px">
      <h2>Compact SVG Report</h2>
      <img class="thumb" src="${reportSvg}" alt="Generated virtual texturing SVG report">
    </section>

    <section class="panel" style="margin-top: 18px">
      <h2>Camera Pan And Seam Checks</h2>
      <table>
        <thead><tr><th>Status</th><th>Probe</th><th>Value</th><th>Target</th></tr></thead>
        <tbody>
          ${probeRows.map((row) => `<tr><td class="${row.status}">${row.status}</td><td><code>${escapeHtml(row.id)}</code><br>${escapeHtml(row.label)}</td><td>${escapeHtml(String(row.value))}</td><td>${escapeHtml(row.target)}</td></tr>`).join("\n")}
        </tbody>
      </table>
    </section>

    <section class="panel" style="margin-top: 18px">
      <h2>Royal Example Route Contract</h2>
      <p>When renderer hooks exist, add <code>VirtualTexturingTerrain</code> to <code>apps/examples-react/src/examples/cases</code>, register it at <code>/labs/virtual-texturing</code>, and bind the scene through virtual texture asset and material resources.</p>
    </section>
  </main>
</body>
</html>
`;
}

function summaryCardHtml(label, value, caption) {
  return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong><p>${escapeHtml(caption)}</p></article>`;
}

function probeStatus(row, stream) {
  if (row.id === "vt.tile_borders.mismatches") return row.value === 0 ? "pass" : "warn";
  if (row.id === "vt.uploads.pages_per_frame") return row.value <= stream.budget.maxUploadsPerFrame ? "pass" : "warn";
  if (row.id === "vt.page_hits.exact_ratio") return row.value >= 0.72 ? "pass" : "warn";
  if (row.id === "vt.seams.candidates") return "info";
  return "pass";
}

function groupPagesByMip(pages) {
  const groups = new Map();
  for (const page of pages) {
    const rows = groups.get(page.mip) ?? [];
    rows.push(page);
    groups.set(page.mip, rows);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([mip, rows]) => [mip, rows.sort((a, b) => a.y - b.y || a.x - b.x)]);
}

async function verifyReferencedArtifacts(manifest) {
  for (const page of manifest.pages) {
    await verifySha(path.join(assetsRoot, page.uri), page.sha256);
  }
  for (const preview of manifest.previews) {
    await verifySha(path.join(assetsRoot, preview.uri), preview.sha256);
  }
  await verifySha(path.join(assetsRoot, manifest.stats.uri), manifest.stats.sha256);
}

async function verifySha(filePath, expected) {
  const bytes = await readFile(filePath);
  const actual = sha256(bytes);
  if (actual !== expected) {
    throw new Error(`${path.relative(here, filePath)} sha256 mismatch: expected ${expected}, got ${actual}`);
  }
}

async function checkArtifacts(outputs) {
  const mismatches = [];
  for (const [relativePath, expected] of outputs) {
    const target = path.join(reportRoot, relativePath);
    let actual;
    try {
      actual = await readFile(target);
    } catch (error) {
      if (error && error.code === "ENOENT") {
        mismatches.push(`${relativePath} is missing`);
        continue;
      }
      throw error;
    }
    if (!actual.equals(expected)) mismatches.push(`${relativePath} differs`);
  }

  if (mismatches.length > 0) {
    throw new Error(`demo report check failed:\n${mismatches.map((row) => `- ${row}`).join("\n")}`);
  }
}

async function writeArtifacts(outputs) {
  await mkdir(reportRoot, { recursive: true });
  for (const [relativePath, bytes] of outputs) {
    const target = path.join(reportRoot, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
  return `${round(bytes / 1024 / 1024)} MiB`;
}

function percent(value) {
  return `${Math.round(value * 1000) / 10}%`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeXml(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});

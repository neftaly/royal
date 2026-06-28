#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const defaultFixture = new URL("./fixtures/tiny-scene.svg", import.meta.url);
const commandCodes = { M: 0, L: 1, Q: 2, C: 3, Z: 4 };
const commandCoordCount = { M: 2, L: 2, Q: 4, C: 6, Z: 0 };
const kappa = 0.5522847498307936;

export function parseSvgToPaths(svg, options = {}) {
  const resolvedOptions = {
    curveMode: options.curveMode ?? "retain",
    flattenTolerance: numberOr(options.flattenTolerance, 0.25),
    transformFlattening: options.transformFlattening ?? true,
    styleExtraction: options.styleExtraction ?? true,
    simplify: options.simplify ?? "none",
    simplifyTolerance: numberOr(options.simplifyTolerance, 0.02),
    quantize: numberOr(options.quantize, 0),
    packed: options.packed ?? false,
  };

  const warnings = [];
  const started = performance.now();
  const parsedStarted = performance.now();
  const document = parseXml(svg, warnings);
  const xmlParseMs = performance.now() - parsedStarted;
  const svgNode = findSvgNode(document);
  if (svgNode === undefined) {
    throw new Error("No <svg> root found in input.");
  }

  const extractionStarted = performance.now();
  const paths = [];
  const stats = {
    inputBytes: byteLength(svg),
    xmlParseMs: round(xmlParseMs),
    extractionMs: 0,
    flattenMs: 0,
    simplifyMs: 0,
    quantizeMs: 0,
    packMs: 0,
    pathElements: 0,
    shapeElements: 0,
    unsupportedElements: 0,
    transformFlattened: resolvedOptions.transformFlattening,
  };

  const viewBox = readViewBox(svgNode.attrs);
  const initialState = {
    transform: identityMatrix(),
    style: defaultStyle(),
  };

  walkSvg(svgNode, initialState, {
    paths,
    warnings,
    stats,
    options: resolvedOptions,
  });

  stats.flattenMs = round(stats.flattenMs);
  stats.simplifyMs = round(stats.simplifyMs);
  stats.quantizeMs = round(stats.quantizeMs);
  stats.extractionMs = round(performance.now() - extractionStarted);
  stats.paths = paths.length;
  stats.commands = countCommands(paths);
  stats.coordinateScalars = countCoordinateScalars(paths);
  stats.outputJsonBytes = estimateJsonBytes({ viewBox, paths, warnings });

  let result = {
    viewBox,
    paths,
    warnings,
    stats,
  };

  if (resolvedOptions.packed) {
    const packStarted = performance.now();
    result = packResult(result);
    result.stats.packMs = round(performance.now() - packStarted);
    result.stats.outputPackedBytes = packedByteLength(result);
    result.stats.outputJsonBytes = estimateJsonBytes(toSerializableReport(result));
  }

  result.stats.totalMs = round(performance.now() - started);
  result.stats.options = resolvedOptions;
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const svgPath = resolve(args.svg ?? filePathFromUrl(defaultFixture));
  const svg = readFileSync(svgPath, "utf8");

  if (args.dump === true) {
    const result = parseSvgToPaths(svg, optionsFromArgs(args));
    console.log(JSON.stringify(toSerializableReport(result), null, 2));
    return;
  }

  const iterations = integerOr(args.iterations, 250);
  const tolerance = numberOr(args.tolerance, 0.25);
  const simplifyTolerance = numberOr(args["simplify-tolerance"], tolerance * 0.25);
  const quantize = numberOr(args.quantize, 0.001);
  const scenarios = [
    {
      name: "retain-json",
      options: {
        curveMode: "retain",
        flattenTolerance: tolerance,
        simplify: "none",
        packed: false,
      },
    },
    {
      name: "flatten-json",
      options: {
        curveMode: "flatten",
        flattenTolerance: tolerance,
        simplify: "none",
        packed: false,
      },
    },
    {
      name: "flatten-simplified-json",
      options: {
        curveMode: "flatten",
        flattenTolerance: tolerance,
        simplify: "collinear",
        simplifyTolerance,
        packed: false,
      },
    },
    {
      name: "flatten-packed-f32",
      options: {
        curveMode: "flatten",
        flattenTolerance: tolerance,
        simplify: "collinear",
        simplifyTolerance,
        quantize,
        packed: true,
      },
    },
  ];

  const scenarioReports = [];
  for (const scenario of scenarios) {
    scenarioReports.push(runScenario(svg, scenario.name, scenario.options, iterations));
  }

  const packedForTransfer = parseSvgToPaths(svg, scenarios.at(-1).options);
  const workerTransfer = await measureWorkerTransfer(packedForTransfer);

  const report = {
    prototype: "pathfinder-svg-loading",
    fixture: {
      path: svgPath,
      name: basename(svgPath),
      bytes: byteLength(svg),
    },
    runtime: {
      node: process.version,
      gcAvailable: typeof globalThis.gc === "function",
      iterations,
    },
    api: "parseSvgToPaths(svg, options) -> { viewBox, paths, warnings, stats }",
    scenarios: scenarioReports,
    workerTransfer,
    recommendation: {
      parser: "Use usvg/resvg directly for production SVG parsing and normalization.",
      pathfinder:
        "Use Pathfinder as renderer/reference only unless product needs its scene renderer; pathfinder_svg depends on old usvg plus renderer/content crates and converts into a Pathfinder Scene rather than exposing a clean SVG-to-path API.",
    },
  };

  console.log(JSON.stringify(report, null, 2));
}

function runScenario(svg, name, options, iterations) {
  const warmup = Math.min(20, Math.max(3, Math.floor(iterations / 10)));
  for (let index = 0; index < warmup; index += 1) {
    parseSvgToPaths(svg, options);
  }

  if (typeof globalThis.gc === "function") globalThis.gc();
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.resourceUsage();
  const timings = [];
  let last;

  for (let index = 0; index < iterations; index += 1) {
    const started = performance.now();
    last = parseSvgToPaths(svg, options);
    timings.push(performance.now() - started);
  }

  const cpuAfter = process.resourceUsage(cpuBefore);
  if (typeof globalThis.gc === "function") globalThis.gc();
  const memoryAfter = process.memoryUsage();
  const sorted = [...timings].sort((a, b) => a - b);

  return {
    name,
    options,
    meanMs: round(average(timings)),
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    totalMs: round(sum(timings)),
    paths: last.stats.paths,
    commands: last.stats.commands,
    coordinateScalars: last.stats.coordinateScalars,
    outputJsonBytes: last.stats.outputJsonBytes,
    outputPackedBytes: last.stats.outputPackedBytes ?? 0,
    warnings: last.warnings.length,
    lastStageMs: {
      xmlParse: last.stats.xmlParseMs,
      extraction: last.stats.extractionMs,
      flatten: last.stats.flattenMs,
      simplify: last.stats.simplifyMs,
      quantize: last.stats.quantizeMs,
      pack: last.stats.packMs,
    },
    memory: {
      heapDeltaBytes: memoryAfter.heapUsed - memoryBefore.heapUsed,
      heapDeltaPerIterationBytes: Math.round((memoryAfter.heapUsed - memoryBefore.heapUsed) / iterations),
      rssBytes: memoryAfter.rss,
      heapUsedBytes: memoryAfter.heapUsed,
      arrayBuffersBytes: memoryAfter.arrayBuffers,
    },
    cpu: {
      userMicros: cpuAfter.userCPUTime,
      systemMicros: cpuAfter.systemCPUTime,
      maxRssKb: cpuAfter.maxRSS,
    },
  };
}

async function measureWorkerTransfer(result) {
  if (result.packed === undefined) return { status: "skipped", reason: "packed output required" };
  const payload = {
    opcodes: result.packed.opcodes,
    coords: result.packed.coords,
    pathRanges: result.packed.pathRanges,
  };
  const bytes = payload.opcodes.byteLength + payload.coords.byteLength + payload.pathRanges.byteLength;
  const workerSource = `
    const { parentPort } = require("node:worker_threads");
    parentPort.on("message", (payload) => {
      parentPort.postMessage({
        opcodesBytes: payload.opcodes.byteLength,
        coordsBytes: payload.coords.byteLength,
        pathRangesBytes: payload.pathRanges.byteLength
      });
    });
  `;
  const worker = new Worker(workerSource, { eval: true });

  try {
    const started = performance.now();
    const response = await new Promise((resolveMessage, rejectMessage) => {
      worker.once("message", resolveMessage);
      worker.once("error", rejectMessage);
      worker.postMessage(payload, [payload.opcodes.buffer, payload.coords.buffer, payload.pathRanges.buffer]);
    });
    return {
      status: "ok",
      bytes,
      roundTripMs: round(performance.now() - started),
      sourceBuffersDetached:
        payload.opcodes.byteLength === 0 && payload.coords.byteLength === 0 && payload.pathRanges.byteLength === 0,
      response,
      note: "Packed typed arrays transfer without cloning; JSON path output would structured-clone object graphs.",
    };
  } finally {
    await worker.terminate();
  }
}

function walkSvg(node, inheritedState, context) {
  const localState = stateForNode(node, inheritedState);
  if (isHidden(localState.style)) return;

  const lowerName = localName(node.name);
  if (lowerName === "defs" || lowerName === "lineargradient" || lowerName === "radialgradient") return;

  const commands = commandsForNode(node, context);
  if (commands !== undefined) {
    const normalized = normalizeCommands(commands, localState.transform, localState.style, node, context);
    if (normalized !== undefined) context.paths.push(normalized);
  }

  for (const child of node.children) {
    walkSvg(child, localState, context);
  }
}

function stateForNode(node, inheritedState) {
  const transform = multiplyMatrices(inheritedState.transform, parseTransform(node.attrs.transform));
  const style = mergeStyle(inheritedState.style, node.attrs);
  return { transform, style };
}

function commandsForNode(node, context) {
  const name = localName(node.name);
  const attrs = node.attrs;
  switch (name) {
    case "path": {
      context.stats.pathElements += 1;
      if (attrs.d === undefined) return undefined;
      return parsePathData(attrs.d, context.warnings, attrs.id);
    }
    case "rect":
      context.stats.shapeElements += 1;
      return rectCommands(attrs);
    case "circle":
      context.stats.shapeElements += 1;
      return ellipseCommands(lengthValue(attrs.cx), lengthValue(attrs.cy), lengthValue(attrs.r), lengthValue(attrs.r));
    case "ellipse":
      context.stats.shapeElements += 1;
      return ellipseCommands(lengthValue(attrs.cx), lengthValue(attrs.cy), lengthValue(attrs.rx), lengthValue(attrs.ry));
    case "line":
      context.stats.shapeElements += 1;
      return [
        { op: "M", x: lengthValue(attrs.x1), y: lengthValue(attrs.y1) },
        { op: "L", x: lengthValue(attrs.x2), y: lengthValue(attrs.y2) },
      ];
    case "polyline":
      context.stats.shapeElements += 1;
      return pointListCommands(attrs.points, false);
    case "polygon":
      context.stats.shapeElements += 1;
      return pointListCommands(attrs.points, true);
    case "svg":
    case "g":
      return undefined;
    case "use":
    case "image":
    case "text":
    case "filter":
    case "mask":
    case "pattern":
      context.stats.unsupportedElements += 1;
      context.warnings.push({ code: "unsupported-element", element: name, id: attrs.id });
      return undefined;
    default:
      return undefined;
  }
}

function normalizeCommands(commands, transform, style, node, context) {
  let output = commands;
  const options = context.options;

  if (options.transformFlattening) {
    output = transformCommands(output, transform);
  }

  if (options.curveMode === "flatten") {
    const started = performance.now();
    output = flattenCommands(output, options.flattenTolerance);
    context.stats.flattenMs += performance.now() - started;
  }

  if (options.simplify !== "none") {
    const started = performance.now();
    output = simplifyCommands(output, options.simplifyTolerance, options.simplify);
    context.stats.simplifyMs += performance.now() - started;
  }

  if (options.quantize > 0) {
    const started = performance.now();
    output = quantizeCommands(output, options.quantize);
    if (options.simplify !== "none") output = simplifyCommands(output, options.quantize, "dedupe");
    context.stats.quantizeMs += performance.now() - started;
  }

  const source = localName(node.name);
  const paint = context.options.styleExtraction ? styleForPath(style, source) : {};
  return {
    id: node.attrs.id ?? `${source}-${context.paths.length}`,
    source,
    ...paint,
    transform: options.transformFlattening ? undefined : matrixToObject(transform),
    commands: output,
  };
}

function parseXml(input, warnings) {
  const root = { name: "#document", attrs: {}, children: [] };
  const stack = [root];
  const tags = input.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g);

  for (const match of tags) {
    const tag = match[0];
    if (tag.startsWith("<!--") || tag.startsWith("<!") || tag.startsWith("<?")) continue;
    if (tag.startsWith("</")) {
      const closingName = localName(tag.slice(2, -1).trim());
      while (stack.length > 1) {
        const popped = stack.pop();
        if (localName(popped.name) === closingName) break;
      }
      continue;
    }

    const selfClosing = /\/\s*>$/.test(tag);
    const content = tag.slice(1, selfClosing ? tag.search(/\/\s*>$/) : -1).trim();
    const nameMatch = /^([^\s/>]+)/.exec(content);
    if (nameMatch === null) continue;
    const name = nameMatch[1];
    const attrs = parseAttributes(content.slice(name.length));
    const node = { name, attrs, children: [] };
    stack.at(-1).children.push(node);
    if (!selfClosing) stack.push(node);
  }

  if (stack.length > 1) {
    warnings.push({ code: "xml-unbalanced-tags", openElements: stack.length - 1 });
  }
  return root;
}

function parseAttributes(input) {
  const attrs = {};
  const pattern = /([:\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of input.matchAll(pattern)) {
    attrs[match[1]] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

function decodeEntities(value) {
  return value
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function findSvgNode(document) {
  const stack = [...document.children];
  while (stack.length > 0) {
    const node = stack.shift();
    if (localName(node.name) === "svg") return node;
    stack.unshift(...node.children);
  }
  return undefined;
}

function readViewBox(attrs) {
  if (attrs.viewBox !== undefined) {
    const values = numbers(attrs.viewBox);
    if (values.length >= 4) {
      return { x: values[0], y: values[1], width: values[2], height: values[3] };
    }
  }
  return {
    x: 0,
    y: 0,
    width: lengthValue(attrs.width, 0),
    height: lengthValue(attrs.height, 0),
  };
}

function parsePathData(data, warnings, id) {
  const tokens = [...data.matchAll(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)].map((match) => match[0]);
  const commands = [];
  let index = 0;
  let command;
  let current = point(0, 0);
  let subpathStart = point(0, 0);
  let previousCubicControl;
  let previousQuadControl;
  let previousCommand = "";

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index];
      index += 1;
    }
    if (command === undefined) {
      warnings.push({ code: "path-data-without-command", id });
      break;
    }

    const relative = command === command.toLowerCase();
    const op = command.toLowerCase();

    if (op === "z") {
      commands.push({ op: "Z" });
      current = { ...subpathStart };
      previousCubicControl = undefined;
      previousQuadControl = undefined;
      previousCommand = "Z";
      command = undefined;
      continue;
    }

    if (!hasNumber(tokens, index)) {
      warnings.push({ code: "path-command-missing-args", command, id });
      break;
    }

    switch (op) {
      case "m": {
        let first = true;
        while (hasNumbers(tokens, index, 2)) {
          const target = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          index += 2;
          if (first) {
            commands.push({ op: "M", x: target.x, y: target.y });
            subpathStart = { ...target };
            first = false;
          } else {
            commands.push({ op: "L", x: target.x, y: target.y });
          }
          current = target;
        }
        command = relative ? "l" : "L";
        previousCommand = first ? previousCommand : "M";
        previousCubicControl = undefined;
        previousQuadControl = undefined;
        break;
      }
      case "l":
        while (hasNumbers(tokens, index, 2)) {
          const target = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          index += 2;
          commands.push({ op: "L", x: target.x, y: target.y });
          current = target;
        }
        previousCommand = "L";
        previousCubicControl = undefined;
        previousQuadControl = undefined;
        break;
      case "h":
        while (hasNumbers(tokens, index, 1)) {
          const x = numberToken(tokens[index]);
          index += 1;
          current = { x: relative ? current.x + x : x, y: current.y };
          commands.push({ op: "L", x: current.x, y: current.y });
        }
        previousCommand = "L";
        previousCubicControl = undefined;
        previousQuadControl = undefined;
        break;
      case "v":
        while (hasNumbers(tokens, index, 1)) {
          const y = numberToken(tokens[index]);
          index += 1;
          current = { x: current.x, y: relative ? current.y + y : y };
          commands.push({ op: "L", x: current.x, y: current.y });
        }
        previousCommand = "L";
        previousCubicControl = undefined;
        previousQuadControl = undefined;
        break;
      case "c":
        while (hasNumbers(tokens, index, 6)) {
          const c1 = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          const c2 = absolutize(point(numberToken(tokens[index + 2]), numberToken(tokens[index + 3])), current, relative);
          const target = absolutize(point(numberToken(tokens[index + 4]), numberToken(tokens[index + 5])), current, relative);
          index += 6;
          commands.push({ op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: target.x, y: target.y });
          current = target;
          previousCubicControl = c2;
          previousQuadControl = undefined;
          previousCommand = "C";
        }
        break;
      case "s":
        while (hasNumbers(tokens, index, 4)) {
          const c1 = previousCommand === "C" || previousCommand === "S"
            ? reflect(previousCubicControl, current)
            : { ...current };
          const c2 = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          const target = absolutize(point(numberToken(tokens[index + 2]), numberToken(tokens[index + 3])), current, relative);
          index += 4;
          commands.push({ op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: target.x, y: target.y });
          current = target;
          previousCubicControl = c2;
          previousQuadControl = undefined;
          previousCommand = "S";
        }
        break;
      case "q":
        while (hasNumbers(tokens, index, 4)) {
          const c1 = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          const target = absolutize(point(numberToken(tokens[index + 2]), numberToken(tokens[index + 3])), current, relative);
          index += 4;
          commands.push({ op: "Q", x1: c1.x, y1: c1.y, x: target.x, y: target.y });
          current = target;
          previousQuadControl = c1;
          previousCubicControl = undefined;
          previousCommand = "Q";
        }
        break;
      case "t":
        while (hasNumbers(tokens, index, 2)) {
          const c1 = previousCommand === "Q" || previousCommand === "T"
            ? reflect(previousQuadControl, current)
            : { ...current };
          const target = absolutize(point(numberToken(tokens[index]), numberToken(tokens[index + 1])), current, relative);
          index += 2;
          commands.push({ op: "Q", x1: c1.x, y1: c1.y, x: target.x, y: target.y });
          current = target;
          previousQuadControl = c1;
          previousCubicControl = undefined;
          previousCommand = "T";
        }
        break;
      case "a":
        while (hasNumbers(tokens, index, 7)) {
          const rx = numberToken(tokens[index]);
          const ry = numberToken(tokens[index + 1]);
          const angle = numberToken(tokens[index + 2]);
          const largeArc = numberToken(tokens[index + 3]) !== 0;
          const sweep = numberToken(tokens[index + 4]) !== 0;
          const target = absolutize(point(numberToken(tokens[index + 5]), numberToken(tokens[index + 6])), current, relative);
          index += 7;
          const cubics = arcToCubics(current, rx, ry, angle, largeArc, sweep, target);
          if (cubics.length === 0) {
            commands.push({ op: "L", x: target.x, y: target.y });
          } else {
            for (const cubic of cubics) commands.push(cubic);
          }
          current = target;
          previousCubicControl = cubics.at(-1) === undefined ? undefined : point(cubics.at(-1).x2, cubics.at(-1).y2);
          previousQuadControl = undefined;
          previousCommand = "C";
        }
        break;
      default:
        warnings.push({ code: "unsupported-path-command", command, id });
        index += 1;
        previousCubicControl = undefined;
        previousQuadControl = undefined;
        previousCommand = command.toUpperCase();
        break;
    }
  }

  return commands;
}

function rectCommands(attrs) {
  const x = lengthValue(attrs.x);
  const y = lengthValue(attrs.y);
  const width = Math.max(0, lengthValue(attrs.width));
  const height = Math.max(0, lengthValue(attrs.height));
  const rx = Math.min(width / 2, Math.max(0, lengthValue(attrs.rx, lengthValue(attrs.ry))));
  const ry = Math.min(height / 2, Math.max(0, lengthValue(attrs.ry, lengthValue(attrs.rx))));

  if (rx === 0 || ry === 0) {
    return [
      { op: "M", x, y },
      { op: "L", x: x + width, y },
      { op: "L", x: x + width, y: y + height },
      { op: "L", x, y: y + height },
      { op: "Z" },
    ];
  }

  return [
    { op: "M", x: x + rx, y },
    { op: "L", x: x + width - rx, y },
    { op: "C", x1: x + width - rx + rx * kappa, y1: y, x2: x + width, y2: y + ry - ry * kappa, x: x + width, y: y + ry },
    { op: "L", x: x + width, y: y + height - ry },
    { op: "C", x1: x + width, y1: y + height - ry + ry * kappa, x2: x + width - rx + rx * kappa, y2: y + height, x: x + width - rx, y: y + height },
    { op: "L", x: x + rx, y: y + height },
    { op: "C", x1: x + rx - rx * kappa, y1: y + height, x2: x, y2: y + height - ry + ry * kappa, x, y: y + height - ry },
    { op: "L", x, y: y + ry },
    { op: "C", x1: x, y1: y + ry - ry * kappa, x2: x + rx - rx * kappa, y2: y, x: x + rx, y },
    { op: "Z" },
  ];
}

function ellipseCommands(cx, cy, rx, ry) {
  if (!(rx > 0) || !(ry > 0)) return [];
  return [
    { op: "M", x: cx + rx, y: cy },
    { op: "C", x1: cx + rx, y1: cy + ry * kappa, x2: cx + rx * kappa, y2: cy + ry, x: cx, y: cy + ry },
    { op: "C", x1: cx - rx * kappa, y1: cy + ry, x2: cx - rx, y2: cy + ry * kappa, x: cx - rx, y: cy },
    { op: "C", x1: cx - rx, y1: cy - ry * kappa, x2: cx - rx * kappa, y2: cy - ry, x: cx, y: cy - ry },
    { op: "C", x1: cx + rx * kappa, y1: cy - ry, x2: cx + rx, y2: cy - ry * kappa, x: cx + rx, y: cy },
    { op: "Z" },
  ];
}

function pointListCommands(points, close) {
  const values = numbers(points ?? "");
  const commands = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    commands.push({ op: commands.length === 0 ? "M" : "L", x: values[index], y: values[index + 1] });
  }
  if (close && commands.length > 0) commands.push({ op: "Z" });
  return commands;
}

function transformCommands(commands, matrix) {
  if (isIdentityMatrix(matrix)) return commands.map((command) => ({ ...command }));
  return commands.map((command) => {
    switch (command.op) {
      case "M":
      case "L": {
        const p = transformPoint(matrix, command);
        return { op: command.op, x: p.x, y: p.y };
      }
      case "Q": {
        const c1 = transformPoint(matrix, { x: command.x1, y: command.y1 });
        const p = transformPoint(matrix, command);
        return { op: "Q", x1: c1.x, y1: c1.y, x: p.x, y: p.y };
      }
      case "C": {
        const c1 = transformPoint(matrix, { x: command.x1, y: command.y1 });
        const c2 = transformPoint(matrix, { x: command.x2, y: command.y2 });
        const p = transformPoint(matrix, command);
        return { op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: p.x, y: p.y };
      }
      case "Z":
        return { op: "Z" };
      default:
        return { ...command };
    }
  });
}

function flattenCommands(commands, tolerance) {
  const output = [];
  let current = point(0, 0);
  let subpathStart = point(0, 0);

  for (const command of commands) {
    switch (command.op) {
      case "M":
        current = point(command.x, command.y);
        subpathStart = { ...current };
        output.push({ ...command });
        break;
      case "L":
        current = point(command.x, command.y);
        output.push({ ...command });
        break;
      case "Q": {
        const c1 = {
          x: current.x + (2 / 3) * (command.x1 - current.x),
          y: current.y + (2 / 3) * (command.y1 - current.y),
        };
        const c2 = {
          x: command.x + (2 / 3) * (command.x1 - command.x),
          y: command.y + (2 / 3) * (command.y1 - command.y),
        };
        for (const p of flattenCubic(current, c1, c2, point(command.x, command.y), tolerance)) {
          output.push({ op: "L", x: p.x, y: p.y });
        }
        current = point(command.x, command.y);
        break;
      }
      case "C":
        for (const p of flattenCubic(
          current,
          point(command.x1, command.y1),
          point(command.x2, command.y2),
          point(command.x, command.y),
          tolerance,
        )) {
          output.push({ op: "L", x: p.x, y: p.y });
        }
        current = point(command.x, command.y);
        break;
      case "Z":
        current = { ...subpathStart };
        output.push({ op: "Z" });
        break;
      default:
        break;
    }
  }

  return output;
}

function flattenCubic(p0, p1, p2, p3, tolerance) {
  const output = [];
  const maxDepth = 18;

  function visit(a, b, c, d, depth) {
    if (depth >= maxDepth || cubicFlatEnough(a, b, c, d, tolerance)) {
      output.push(d);
      return;
    }
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const cd = midpoint(c, d);
    const abbc = midpoint(ab, bc);
    const bccd = midpoint(bc, cd);
    const center = midpoint(abbc, bccd);
    visit(a, ab, abbc, center, depth + 1);
    visit(center, bccd, cd, d, depth + 1);
  }

  visit(p0, p1, p2, p3, 0);
  return output;
}

function cubicFlatEnough(p0, p1, p2, p3, tolerance) {
  return Math.max(distancePointToLine(p1, p0, p3), distancePointToLine(p2, p0, p3)) <= tolerance;
}

function simplifyCommands(commands, tolerance, mode) {
  const output = [];
  for (const command of commands) {
    if (command.op === "L") {
      const last = output.at(-1);
      if ((last?.op === "M" || last?.op === "L") && distance(command, last) <= tolerance) {
        continue;
      }
    }
    output.push({ ...command });

    if (mode === "collinear") {
      while (output.length >= 3) {
        const c = output.at(-1);
        const b = output.at(-2);
        const a = output.at(-3);
        if (c.op !== "L" || b.op !== "L" || (a.op !== "L" && a.op !== "M")) break;
        if (distancePointToLine(b, a, c) > tolerance) break;
        output.splice(output.length - 2, 1);
      }
    }
  }
  return output;
}

function quantizeCommands(commands, step) {
  return commands.map((command) => {
    switch (command.op) {
      case "M":
      case "L":
        return { op: command.op, x: quantize(command.x, step), y: quantize(command.y, step) };
      case "Q":
        return {
          op: "Q",
          x1: quantize(command.x1, step),
          y1: quantize(command.y1, step),
          x: quantize(command.x, step),
          y: quantize(command.y, step),
        };
      case "C":
        return {
          op: "C",
          x1: quantize(command.x1, step),
          y1: quantize(command.y1, step),
          x2: quantize(command.x2, step),
          y2: quantize(command.y2, step),
          x: quantize(command.x, step),
          y: quantize(command.y, step),
        };
      default:
        return { op: "Z" };
    }
  });
}

function packResult(result) {
  const commandTotal = countCommands(result.paths);
  const coordTotal = countCoordinateScalars(result.paths);
  const opcodes = new Uint8Array(commandTotal);
  const coords = new Float32Array(coordTotal);
  const pathRanges = new Uint32Array(result.paths.length * 4);
  let commandOffset = 0;
  let coordOffset = 0;

  const packedPaths = result.paths.map((path, pathIndex) => {
    const pathCommandOffset = commandOffset;
    const pathCoordOffset = coordOffset;
    for (const command of path.commands) {
      opcodes[commandOffset] = commandCodes[command.op];
      commandOffset += 1;
      switch (command.op) {
        case "M":
        case "L":
          coords[coordOffset++] = command.x;
          coords[coordOffset++] = command.y;
          break;
        case "Q":
          coords[coordOffset++] = command.x1;
          coords[coordOffset++] = command.y1;
          coords[coordOffset++] = command.x;
          coords[coordOffset++] = command.y;
          break;
        case "C":
          coords[coordOffset++] = command.x1;
          coords[coordOffset++] = command.y1;
          coords[coordOffset++] = command.x2;
          coords[coordOffset++] = command.y2;
          coords[coordOffset++] = command.x;
          coords[coordOffset++] = command.y;
          break;
        default:
          break;
      }
    }
    const rangeIndex = pathIndex * 4;
    pathRanges[rangeIndex] = pathCommandOffset;
    pathRanges[rangeIndex + 1] = commandOffset - pathCommandOffset;
    pathRanges[rangeIndex + 2] = pathCoordOffset;
    pathRanges[rangeIndex + 3] = coordOffset - pathCoordOffset;
    const { commands, ...metadata } = path;
    return {
      ...metadata,
      commandOffset: pathCommandOffset,
      commandCount: commandOffset - pathCommandOffset,
      coordOffset: pathCoordOffset,
      coordCount: coordOffset - pathCoordOffset,
    };
  });

  return {
    ...result,
    paths: packedPaths,
    packed: {
      opcodes,
      coords,
      pathRanges,
      commandStride: "variable",
      commandCodes,
      commandCoordCount,
    },
  };
}

function parseTransform(value) {
  if (value === undefined || value.trim() === "") return identityMatrix();
  let matrix = identityMatrix();
  const pattern = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (const match of value.matchAll(pattern)) {
    const name = match[1].toLowerCase();
    const args = numbers(match[2]);
    let next = identityMatrix();
    switch (name) {
      case "matrix":
        if (args.length >= 6) next = [args[0], args[1], args[2], args[3], args[4], args[5]];
        break;
      case "translate":
        next = [1, 0, 0, 1, args[0] ?? 0, args[1] ?? 0];
        break;
      case "scale":
        next = [args[0] ?? 1, 0, 0, args[1] ?? args[0] ?? 1, 0, 0];
        break;
      case "rotate": {
        const angle = radians(args[0] ?? 0);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rotate = [cos, sin, -sin, cos, 0, 0];
        if (args.length >= 3) {
          next = multiplyMatrices(
            multiplyMatrices([1, 0, 0, 1, args[1], args[2]], rotate),
            [1, 0, 0, 1, -args[1], -args[2]],
          );
        } else {
          next = rotate;
        }
        break;
      }
      case "skewx": {
        next = [1, 0, Math.tan(radians(args[0] ?? 0)), 1, 0, 0];
        break;
      }
      case "skewy": {
        next = [1, Math.tan(radians(args[0] ?? 0)), 0, 1, 0, 0];
        break;
      }
      default:
        break;
    }
    matrix = multiplyMatrices(matrix, next);
  }
  return matrix;
}

function multiplyMatrices(left, right) {
  const [a1, b1, c1, d1, e1, f1] = left;
  const [a2, b2, c2, d2, e2, f2] = right;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function transformPoint(matrix, p) {
  return {
    x: matrix[0] * p.x + matrix[2] * p.y + matrix[4],
    y: matrix[1] * p.x + matrix[3] * p.y + matrix[5],
  };
}

function identityMatrix() {
  return [1, 0, 0, 1, 0, 0];
}

function isIdentityMatrix(matrix) {
  return matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && matrix[4] === 0 && matrix[5] === 0;
}

function matrixToObject(matrix) {
  return { a: matrix[0], b: matrix[1], c: matrix[2], d: matrix[3], e: matrix[4], f: matrix[5] };
}

function arcToCubics(start, rxInput, ryInput, angle, largeArc, sweep, end) {
  let rx = Math.abs(rxInput);
  let ry = Math.abs(ryInput);
  if (rx === 0 || ry === 0 || distance(start, end) === 0) return [];

  const phi = radians(angle);
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (start.x - end.x) / 2;
  const dy = (start.y - end.y) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }

  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const sign = largeArc === sweep ? -1 : 1;
  const denominator = rx2 * y1p2 + ry2 * x1p2;
  const coefficient = denominator === 0
    ? 0
    : sign * Math.sqrt(Math.max(0, (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / denominator));
  const cxp = coefficient * (rx * y1p) / ry;
  const cyp = coefficient * (-ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (start.x + end.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (start.y + end.y) / 2;
  const theta1 = angleBetween(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let deltaTheta = angleBetween(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );

  if (!sweep && deltaTheta > 0) deltaTheta -= Math.PI * 2;
  if (sweep && deltaTheta < 0) deltaTheta += Math.PI * 2;

  const segmentCount = Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2));
  const delta = deltaTheta / segmentCount;
  const cubics = [];
  for (let index = 0; index < segmentCount; index += 1) {
    cubics.push(arcSegmentToCubic(cx, cy, rx, ry, phi, theta1 + index * delta, delta));
  }
  return cubics;
}

function arcSegmentToCubic(cx, cy, rx, ry, phi, theta, delta) {
  const theta2 = theta + delta;
  const alpha = (4 / 3) * Math.tan(delta / 4);
  const p0 = point(Math.cos(theta), Math.sin(theta));
  const p3 = point(Math.cos(theta2), Math.sin(theta2));
  const p1 = point(p0.x - p0.y * alpha, p0.y + p0.x * alpha);
  const p2 = point(p3.x + p3.y * alpha, p3.y - p3.x * alpha);
  const c1 = mapArcPoint(cx, cy, rx, ry, phi, p1);
  const c2 = mapArcPoint(cx, cy, rx, ry, phi, p2);
  const end = mapArcPoint(cx, cy, rx, ry, phi, p3);
  return { op: "C", x1: c1.x, y1: c1.y, x2: c2.x, y2: c2.y, x: end.x, y: end.y };
}

function mapArcPoint(cx, cy, rx, ry, phi, p) {
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  return {
    x: cx + rx * (cosPhi * p.x - sinPhi * p.y),
    y: cy + ry * (sinPhi * p.x + cosPhi * p.y),
  };
}

function angleBetween(ux, uy, vx, vy) {
  const dot = ux * vx + uy * vy;
  const length = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const sign = ux * vy - uy * vx < 0 ? -1 : 1;
  return sign * Math.acos(clamp(dot / length, -1, 1));
}

function defaultStyle() {
  return {
    fill: "#000000",
    stroke: "none",
    strokeWidth: "1",
    opacity: "1",
    fillOpacity: "1",
    strokeOpacity: "1",
    fillRule: "nonzero",
    strokeLinecap: "butt",
    strokeLinejoin: "miter",
    strokeMiterlimit: "4",
    strokeDasharray: "none",
    strokeDashoffset: "0",
    visibility: "visible",
    display: "inline",
  };
}

function mergeStyle(parent, attrs) {
  const next = { ...parent };
  const presentation = {
    fill: "fill",
    stroke: "stroke",
    "stroke-width": "strokeWidth",
    opacity: "opacity",
    "fill-opacity": "fillOpacity",
    "stroke-opacity": "strokeOpacity",
    "fill-rule": "fillRule",
    "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin",
    "stroke-miterlimit": "strokeMiterlimit",
    "stroke-dasharray": "strokeDasharray",
    "stroke-dashoffset": "strokeDashoffset",
    visibility: "visibility",
    display: "display",
  };

  for (const [attr, key] of Object.entries(presentation)) {
    if (attrs[attr] !== undefined) next[key] = attrs[attr];
  }
  for (const [attr, value] of Object.entries(parseStyleAttribute(attrs.style))) {
    const key = presentation[attr];
    if (key !== undefined) next[key] = value;
  }
  return next;
}

function parseStyleAttribute(value) {
  const result = {};
  if (value === undefined) return result;
  for (const declaration of value.split(";")) {
    const [rawKey, ...rawValue] = declaration.split(":");
    if (rawKey === undefined || rawValue.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const propertyValue = rawValue.join(":").trim();
    if (key !== "") result[key] = propertyValue;
  }
  return result;
}

function styleForPath(style, source) {
  const fill = source === "line" || source === "polyline"
    ? "none"
    : normalizePaint(style.fill);
  return {
    fill,
    stroke: normalizePaint(style.stroke),
    fillRule: style.fillRule,
    opacity: numberOr(style.opacity, 1),
    fillOpacity: numberOr(style.fillOpacity, 1),
    strokeOpacity: numberOr(style.strokeOpacity, 1),
    strokeWidth: lengthValue(style.strokeWidth, 1),
    strokeLinecap: style.strokeLinecap,
    strokeLinejoin: style.strokeLinejoin,
    strokeMiterlimit: numberOr(style.strokeMiterlimit, 4),
    strokeDasharray: style.strokeDasharray,
    strokeDashoffset: lengthValue(style.strokeDashoffset, 0),
  };
}

function normalizePaint(value) {
  if (value === undefined) return "none";
  return value.trim();
}

function isHidden(style) {
  return style.display === "none" || style.visibility === "hidden" || numberOr(style.opacity, 1) <= 0;
}

function toSerializableReport(result) {
  if (result.packed === undefined) return result;
  return {
    ...result,
    packed: {
      opcodes: {
        type: "Uint8Array",
        length: result.packed.opcodes.length,
        byteLength: result.packed.opcodes.byteLength,
        sample: [...result.packed.opcodes.slice(0, 16)],
      },
      coords: {
        type: "Float32Array",
        length: result.packed.coords.length,
        byteLength: result.packed.coords.byteLength,
        sample: [...result.packed.coords.slice(0, 24)].map(round),
      },
      pathRanges: {
        type: "Uint32Array",
        length: result.packed.pathRanges.length,
        byteLength: result.packed.pathRanges.byteLength,
        sample: [...result.packed.pathRanges.slice(0, 16)],
      },
      commandStride: result.packed.commandStride,
      commandCodes: result.packed.commandCodes,
      commandCoordCount: result.packed.commandCoordCount,
    },
  };
}

function countCommands(paths) {
  return paths.reduce((total, path) => total + (path.commands?.length ?? path.commandCount ?? 0), 0);
}

function countCoordinateScalars(paths) {
  return paths.reduce((total, path) => {
    if (path.commands === undefined) return total + (path.coordCount ?? 0);
    return total + path.commands.reduce((inner, command) => inner + commandCoordCount[command.op], 0);
  }, 0);
}

function estimateJsonBytes(value) {
  return byteLength(JSON.stringify(value));
}

function packedByteLength(result) {
  return result.packed.opcodes.byteLength + result.packed.coords.byteLength + result.packed.pathRanges.byteLength;
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
  }
  return args;
}

function optionsFromArgs(args) {
  return {
    curveMode: args.flatten === true ? "flatten" : args["curve-mode"] ?? "retain",
    flattenTolerance: numberOr(args.tolerance, 0.25),
    transformFlattening: args["keep-transforms"] !== true,
    simplify: args.simplify ?? "none",
    simplifyTolerance: numberOr(args["simplify-tolerance"], 0.02),
    quantize: numberOr(args.quantize, 0),
    packed: args.packed === true,
  };
}

function localName(name) {
  return name.toLowerCase().split(":").at(-1);
}

function isCommand(token) {
  return /^[a-zA-Z]$/.test(token);
}

function hasNumber(tokens, index) {
  return tokens[index] !== undefined && !isCommand(tokens[index]);
}

function hasNumbers(tokens, index, count) {
  for (let offset = 0; offset < count; offset += 1) {
    if (!hasNumber(tokens, index + offset)) return false;
  }
  return true;
}

function numberToken(token) {
  const value = Number(token);
  return Number.isFinite(value) ? value : 0;
}

function numbers(value) {
  return [...String(value).matchAll(/[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g)].map((match) => Number(match[0]));
}

function lengthValue(value, fallback = 0) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integerOr(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function point(x, y) {
  return { x, y };
}

function absolutize(p, current, relative) {
  return relative ? { x: current.x + p.x, y: current.y + p.y } : p;
}

function reflect(control, current) {
  if (control === undefined) return { ...current };
  return { x: current.x * 2 - control.x, y: current.y * 2 - control.y };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToLine(pointToMeasure, lineStart, lineEnd) {
  const length = distance(lineStart, lineEnd);
  if (length === 0) return distance(pointToMeasure, lineStart);
  return Math.abs(
    (lineEnd.y - lineStart.y) * pointToMeasure.x -
      (lineEnd.x - lineStart.x) * pointToMeasure.y +
      lineEnd.x * lineStart.y -
      lineEnd.y * lineStart.x,
  ) / length;
}

function quantize(value, step) {
  return Math.round(value / step) * step;
}

function radians(degrees) {
  return (degrees * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values) {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * p)));
  return sortedValues[index];
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function filePathFromUrl(url) {
  return new URL(url).pathname;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

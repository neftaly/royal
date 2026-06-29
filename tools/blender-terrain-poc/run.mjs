#!/usr/bin/env node

import { access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolDir, "../..");
const defaults = {
  config: path.join(toolDir, "config/low.json"),
  out: path.join(toolDir, "out/low"),
  script: path.join(toolDir, "export_terrain.py"),
};

const parsed = parseArgs(process.argv.slice(2));

await ensureReadable(parsed.config, "config");
await ensureReadable(defaults.script, "Blender exporter");

const blender = parsed.blender ?? process.env.BLENDER ?? "blender";
const blenderArgs = [
  "--background",
  "--factory-startup",
  "--python",
  defaults.script,
  "--",
  "--config",
  parsed.config,
  "--out",
  parsed.out,
  ...parsed.blenderScriptArgs,
];

if (parsed.dryRun) {
  console.log(renderCommand(blender, blenderArgs));
  process.exit(0);
}

const versionProbe = spawnSync(blender, ["--version"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});

if (versionProbe.error?.code === "ENOENT") {
  console.error(
    [
      `Blender executable not found: ${blender}`,
      "Install Blender, put it on PATH, set BLENDER=/path/to/blender, or pass --blender /path/to/blender.",
      `Command that would run: ${renderCommand(blender, blenderArgs)}`,
    ].join("\n"),
  );
  process.exit(2);
}

if (versionProbe.status !== 0) {
  console.error(versionProbe.stderr || versionProbe.stdout || `Blender probe failed with status ${versionProbe.status}`);
  process.exit(versionProbe.status ?? 1);
}

console.log(`Using ${firstLine(versionProbe.stdout)}`);
console.log(renderCommand(blender, blenderArgs));

const result = spawnSync(blender, blenderArgs, {
  cwd: repoRoot,
  encoding: "utf8",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 0);

function parseArgs(args) {
  const result = {
    config: defaults.config,
    out: defaults.out,
    blender: undefined,
    dryRun: false,
    blenderScriptArgs: [],
  };
  const passthroughIndex = args.indexOf("--");
  const ownArgs = passthroughIndex === -1 ? args : args.slice(0, passthroughIndex);
  result.blenderScriptArgs = passthroughIndex === -1 ? [] : args.slice(passthroughIndex + 1);

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = ownArgs[index];
    if (arg === "--config") {
      result.config = resolveFromRoot(requireValue(ownArgs, ++index, arg));
    } else if (arg === "--out") {
      result.out = resolveFromRoot(requireValue(ownArgs, ++index, arg));
    } else if (arg === "--blender") {
      result.blender = requireValue(ownArgs, ++index, arg);
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function requireValue(args, index, flag) {
  if (index >= args.length || args[index].startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return args[index];
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
}

async function ensureReadable(filePath, label) {
  try {
    await access(filePath);
  } catch {
    console.error(`${label} not found or not readable: ${filePath}`);
    process.exit(2);
  }
}

function renderCommand(command, args) {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function firstLine(value) {
  return value.split(/\r?\n/, 1)[0] || "Blender";
}

function printHelp() {
  console.log(`Usage: node tools/blender-terrain-poc/run.mjs [options] [-- Blender script options]

Options:
  --config <path>   Config JSON. Default: tools/blender-terrain-poc/config/low.json
  --out <path>      Output directory. Default: tools/blender-terrain-poc/out/low
  --blender <path>  Blender executable. Default: BLENDER env or blender on PATH
  --dry-run         Print the Blender command without probing or running Blender

Blender script options after -- include:
  --quality preview|draft|high
  --segments <n>
  --texture-size <n>
  --preview-size <n>`);
}

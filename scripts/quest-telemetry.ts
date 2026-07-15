#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const schema = "royal-quest-telemetry";
const schemaVersion = 1;
const defaultLogLimit = 64;
const maxDiagnosticLength = 600;

type TelemetryPhase = "after" | "before" | "run";

export type BatteryTelemetry = {
  readonly charging: boolean | null;
  readonly levelPct: number | null;
  readonly poweredBy: readonly string[];
  readonly temperatureC: number | null;
};

export type ThermalTemperature = {
  readonly name: string;
  readonly status: string;
  readonly statusCode: number;
  readonly type: number;
  readonly valueC: number;
};

export type ThermalTelemetry = {
  readonly status: string;
  readonly statusCode: number;
  readonly temperatures: readonly ThermalTemperature[];
};

export type SystemMemoryTelemetry = {
  readonly availableKiB: number | null;
  readonly cachedKiB: number | null;
  readonly freeKiB: number | null;
  readonly swapFreeKiB: number | null;
  readonly swapTotalKiB: number | null;
  readonly totalKiB: number | null;
};

export type BrowserMemoryTelemetry = {
  readonly pssKiB: number | null;
  readonly rssKiB: number | null;
  readonly swapPssKiB: number | null;
};

export type DeviceTelemetry = {
  readonly androidRelease: string | null;
  readonly androidSdk: number | null;
  readonly buildFingerprint: string | null;
  readonly buildIncremental: string | null;
  readonly device: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
};

export type QuestTelemetrySnapshot = {
  readonly battery: BatteryTelemetry | null;
  readonly capturedAt: string;
  readonly memory: {
    readonly browser: BrowserMemoryTelemetry | null;
    readonly system: SystemMemoryTelemetry | null;
  };
  readonly thermal: ThermalTelemetry | null;
};

export type QuestTelemetryLogEntry = {
  readonly level: "assert" | "error" | "fatal" | "info" | "warning";
  readonly message: string;
  readonly pid: number;
  readonly tag: string;
  readonly timestamp: number;
  readonly tid: number;
};

export type QuestTelemetryProbeFailure = {
  readonly message: string;
  readonly phase: TelemetryPhase;
  readonly probe: string;
};

type CommandOutcome = {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly spawnError?: string;
};

type RecordOptions = {
  readonly adbPath: string;
  readonly command: readonly string[];
  readonly logLimit: number;
  readonly outputPath: string;
  readonly serial?: string;
};

type AdbResult = {
  readonly error?: string;
  readonly stdout: string;
};

const thermalStatuses = [
  "none",
  "light",
  "moderate",
  "severe",
  "critical",
  "emergency",
  "shutdown",
] as const;

const batteryChargingStatuses = new Set([2, 5]);
const relevantLogPattern = /(?:adreno|am_anr|am_crash|anr in|chromium|crash|fatal signal|gl_invalid|gpu|oculus\.browser|opengl|openxr|thermal|vr\s*runtime|vrapi|vrruntime|webgl)/iu;

const finiteNumber = (value: string | undefined): number | null => {
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const integer = (value: string | undefined): number | null => {
  const parsed = finiteNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
};

const truncate = (value: string, length = maxDiagnosticLength): string =>
  value.length <= length ? value : `${value.slice(0, Math.max(0, length - 1))}…`;

const keyedLines = (output: string): Map<string, string> => {
  const values = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\s*([^:]+):\s*(.*?)\s*$/u);
    if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1].trim(), match[2]);
  }
  return values;
};

export const parseBatteryDumpsys = (output: string): BatteryTelemetry | null => {
  const values = keyedLines(output);
  const level = finiteNumber(values.get("level"));
  const scale = finiteNumber(values.get("scale"));
  const temperatureTenthsC = finiteNumber(values.get("temperature"));
  const status = integer(values.get("status"));
  const poweredBy = [
    ["AC powered", "ac"],
    ["USB powered", "usb"],
    ["Wireless powered", "wireless"],
  ] as const;
  const activePower = poweredBy
    .filter(([key]) => values.get(key)?.toLowerCase() === "true")
    .map(([, label]) => label);

  if (level === null && temperatureTenthsC === null && status === null && activePower.length === 0) return null;

  return {
    charging: status === null ? null : batteryChargingStatuses.has(status),
    levelPct: level === null
      ? null
      : scale !== null && scale > 0
        ? Math.round((level / scale) * 10_000) / 100
        : level,
    poweredBy: activePower,
    temperatureC: temperatureTenthsC === null ? null : temperatureTenthsC / 10,
  };
};

const thermalStatusName = (statusCode: number): string => thermalStatuses[statusCode] ?? `unknown-${statusCode}`;

export const parseThermalDumpsys = (output: string): ThermalTelemetry | null => {
  const statusMatch = output.match(/(?:Thermal Status|Current Thermal Status):\s*(\d+)/iu);
  const statusCode = integer(statusMatch?.[1]);
  const hottestByType = new Map<number, ThermalTemperature>();
  let highestTemperatureStatus = 0;
  const temperaturePattern = /Temperature\{[^}]*?mValue=([-+]?\d+(?:\.\d+)?)[^}]*?mType=(\d+)[^}]*?mName=([^,}]+)[^}]*?mStatus=(\d+)[^}]*?\}/giu;

  for (const match of output.matchAll(temperaturePattern)) {
    const valueC = finiteNumber(match[1]);
    const type = integer(match[2]);
    const name = match[3]?.trim();
    const temperatureStatusCode = integer(match[4]);
    if (valueC === null || type === null || name === undefined || temperatureStatusCode === null) continue;
    const temperature = {
      name: truncate(name, 120),
      status: thermalStatusName(temperatureStatusCode),
      statusCode: temperatureStatusCode,
      type,
      valueC,
    };
    highestTemperatureStatus = Math.max(highestTemperatureStatus, temperatureStatusCode);
    const previous = hottestByType.get(type);
    if (previous === undefined || temperature.valueC > previous.valueC) hottestByType.set(type, temperature);
  }

  const temperatures = [...hottestByType.values()].sort((left, right) => left.type - right.type);
  if (statusCode === null && temperatures.length === 0) return null;
  const derivedStatusCode = statusCode ?? highestTemperatureStatus;
  return {
    status: thermalStatusName(derivedStatusCode),
    statusCode: derivedStatusCode,
    temperatures,
  };
};

const meminfoValue = (output: string, key: string): number | null => {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return finiteNumber(output.match(new RegExp(`^${escapedKey}:\\s+(\\d+)\\s+kB`, "imu"))?.[1]);
};

export const parseProcMeminfo = (output: string): SystemMemoryTelemetry | null => {
  const result: SystemMemoryTelemetry = {
    availableKiB: meminfoValue(output, "MemAvailable"),
    cachedKiB: meminfoValue(output, "Cached"),
    freeKiB: meminfoValue(output, "MemFree"),
    swapFreeKiB: meminfoValue(output, "SwapFree"),
    swapTotalKiB: meminfoValue(output, "SwapTotal"),
    totalKiB: meminfoValue(output, "MemTotal"),
  };
  return Object.values(result).every((value) => value === null) ? null : result;
};

export const parseBrowserMeminfo = (output: string): BrowserMemoryTelemetry | null => {
  const summary = output.match(/TOTAL PSS:\s*(\d+)(?:\s+TOTAL RSS:\s*(\d+))?(?:\s+TOTAL SWAP PSS:\s*(\d+))?/iu);
  const totalRow = output.match(/^\s*TOTAL\s+(\d+)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+/imu);
  const pssKiB = finiteNumber(summary?.[1] ?? totalRow?.[1]);
  const rssKiB = finiteNumber(summary?.[2]);
  const swapPssKiB = finiteNumber(summary?.[3]);
  if (pssKiB === null && rssKiB === null && swapPssKiB === null) return null;
  return { pssKiB, rssKiB, swapPssKiB };
};

export const parseGetprop = (output: string): DeviceTelemetry => {
  const properties = new Map<string, string>();
  for (const line of output.split(/\r?\n/u)) {
    const match = line.match(/^\[([^[]+)\]\s*:\s*\[(.*)\]\s*$/u);
    if (match?.[1] !== undefined && match[2] !== undefined) properties.set(match[1], match[2]);
  }
  return {
    androidRelease: properties.get("ro.build.version.release") || null,
    androidSdk: integer(properties.get("ro.build.version.sdk")),
    buildFingerprint: properties.get("ro.build.fingerprint") || null,
    buildIncremental: properties.get("ro.build.version.incremental") || null,
    device: properties.get("ro.product.device") || null,
    manufacturer: properties.get("ro.product.manufacturer") || null,
    model: properties.get("ro.product.model") || null,
  };
};

const logLevel = (priority: string): QuestTelemetryLogEntry["level"] | null => {
  if (priority === "I") return "info";
  if (priority === "W") return "warning";
  if (priority === "E") return "error";
  if (priority === "F") return "fatal";
  if (priority === "A") return "assert";
  return null;
};

export const parseLogcatLine = (line: string): QuestTelemetryLogEntry | null => {
  const match = line.match(/^\s*(\d+(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+([VDIWEFAS])\s+([^:]+):\s?(.*)$/u);
  if (match === null) return null;
  const timestamp = finiteNumber(match[1]);
  const pid = integer(match[2]);
  const tid = integer(match[3]);
  const level = match[4] === undefined ? null : logLevel(match[4]);
  const tag = match[5]?.trim();
  const message = match[6]?.trim();
  if (
    timestamp === null ||
    pid === null ||
    tid === null ||
    level === null ||
    tag === undefined ||
    message === undefined ||
    !relevantLogPattern.test(`${tag} ${message}`)
  ) return null;
  return {
    level,
    message: truncate(message),
    pid,
    tag: truncate(tag, 120),
    timestamp,
    tid,
  };
};

export const collectLogcatEntries = (
  output: string,
  limit: number,
  sinceEpochSeconds = 0,
): { readonly dropped: number; readonly entries: readonly QuestTelemetryLogEntry[] } => {
  const entries: QuestTelemetryLogEntry[] = [];
  let dropped = 0;
  for (const line of output.split(/\r?\n/u)) {
    const entry = parseLogcatLine(line);
    if (entry === null || entry.timestamp < sinceEpochSeconds) continue;
    if (entries.length < limit) entries.push(entry);
    else dropped += 1;
  }
  return { dropped, entries };
};

const usage = (): string => [
  "usage: pnpm quest:telemetry record --output <file> [options] -- <command> [args...]",
  "",
  "options:",
  "  --adb <path>       adb executable (default: ADB or adb)",
  "  --log-limit <n>    maximum retained filtered log entries (default: 64)",
  "  --serial <serial>  device serial (default: ANDROID_SERIAL or the sole connected device)",
  "  --output <file>    telemetry sidecar path",
].join("\n");

export const parseRecordArgs = (argv: readonly string[], environment: NodeJS.ProcessEnv = process.env): RecordOptions => {
  if (argv[0] !== "record") throw new Error(usage());
  let adbPath = environment.ADB?.trim() || "adb";
  let logLimit = defaultLogLimit;
  let outputPath: string | undefined;
  let serial = environment.ANDROID_SERIAL?.trim() || undefined;
  let index = 1;

  for (; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      index += 1;
      break;
    }
    const value = argv[index + 1];
    if (argument === "--adb" && value !== undefined) adbPath = value;
    else if (argument === "--log-limit" && value !== undefined) {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000) {
        throw new Error("--log-limit must be an integer from 0 through 1000");
      }
      logLimit = parsed;
    } else if (argument === "--output" && value !== undefined) outputPath = value;
    else if (argument === "--serial" && value !== undefined) serial = value;
    else throw new Error(`Unknown or incomplete option ${JSON.stringify(argument)}\n\n${usage()}`);
    index += 1;
  }

  const command = argv.slice(index);
  if (outputPath === undefined || outputPath.trim() === "") throw new Error(`--output is required\n\n${usage()}`);
  if (command.length === 0) throw new Error(`A command is required after --\n\n${usage()}`);
  const basePath = environment.INIT_CWD?.trim() || process.cwd();
  return {
    adbPath,
    command,
    logLimit,
    outputPath: path.resolve(basePath, outputPath),
    ...(serial === undefined || serial === "" ? {} : { serial }),
  };
};

const adbArgs = (serial: string | undefined, args: readonly string[]): string[] =>
  serial === undefined ? [...args] : ["-s", serial, ...args];

const runAdb = (adbPath: string, serial: string | undefined, args: readonly string[]): AdbResult => {
  const result = spawnSync(adbPath, adbArgs(serial, args), {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    timeout: 8_000,
  });
  if (result.error !== undefined) return { error: truncate(result.error.message), stdout: result.stdout ?? "" };
  if (result.status !== 0) {
    const diagnostic = (result.stderr || result.stdout || `${adbPath} ${args.join(" ")} exited ${String(result.status)}`).trim();
    return { error: truncate(diagnostic), stdout: result.stdout ?? "" };
  }
  return { stdout: result.stdout };
};

const resolveSerial = (
  adbPath: string,
  requestedSerial: string | undefined,
): { readonly failure?: string; readonly serial?: string } => {
  if (requestedSerial !== undefined) return { serial: requestedSerial };
  const result = runAdb(adbPath, undefined, ["devices"]);
  if (result.error !== undefined) return { failure: result.error };
  const devices = result.stdout
    .split(/\r?\n/u)
    .map((line) => line.match(/^(\S+)\s+device(?:\s|$)/u)?.[1])
    .filter((value): value is string => value !== undefined);
  const [device] = devices;
  if (devices.length === 1 && device !== undefined) return { serial: device };
  if (devices.length === 0) return { failure: "No authorized ADB device is connected" };
  return { failure: "Multiple ADB devices are connected; set ANDROID_SERIAL or pass --serial" };
};

const probe = <T>(
  adbPath: string,
  serial: string,
  phase: TelemetryPhase,
  name: string,
  args: readonly string[],
  parse: (output: string) => T | null,
  failures: QuestTelemetryProbeFailure[],
): T | null => {
  const result = runAdb(adbPath, serial, args);
  if (result.error !== undefined) {
    failures.push({ message: result.error, phase, probe: name });
    return null;
  }
  const parsed = parse(result.stdout);
  if (parsed === null) failures.push({ message: "Probe returned no recognized telemetry", phase, probe: name });
  return parsed;
};

const captureDevice = (
  adbPath: string,
  serial: string,
  failures: QuestTelemetryProbeFailure[],
): DeviceTelemetry | null => probe(
  adbPath,
  serial,
  "before",
  "getprop",
  ["shell", "getprop"],
  (output) => {
    const device = parseGetprop(output);
    return Object.values(device).every((value) => value === null) ? null : device;
  },
  failures,
);

const captureSnapshot = (
  adbPath: string,
  serial: string,
  phase: "after" | "before",
  failures: QuestTelemetryProbeFailure[],
): QuestTelemetrySnapshot => ({
  battery: probe(adbPath, serial, phase, "battery", ["shell", "dumpsys", "battery"], parseBatteryDumpsys, failures),
  capturedAt: new Date().toISOString(),
  memory: {
    browser: probe(
      adbPath,
      serial,
      phase,
      "browser-meminfo",
      ["shell", "dumpsys", "meminfo", "com.oculus.browser"],
      parseBrowserMeminfo,
      failures,
    ),
    system: probe(adbPath, serial, phase, "proc-meminfo", ["shell", "cat", "/proc/meminfo"], parseProcMeminfo, failures),
  },
  thermal: probe(
    adbPath,
    serial,
    phase,
    "thermalservice",
    ["shell", "dumpsys", "thermalservice"],
    parseThermalDumpsys,
    failures,
  ),
});

const captureLogcat = (
  adbPath: string,
  serial: string,
  limit: number,
  sinceEpochSeconds: number,
  failures: QuestTelemetryProbeFailure[],
): { readonly dropped: number; readonly entries: readonly QuestTelemetryLogEntry[] } => {
  const result = runAdb(adbPath, serial, [
    "logcat",
    "-d",
    "-v",
    "epoch",
    "-T",
    sinceEpochSeconds.toFixed(3),
  ]);
  if (result.error !== undefined) {
    failures.push({ message: result.error, phase: "run", probe: "logcat" });
    return { dropped: 0, entries: [] };
  }
  return collectLogcatEntries(result.stdout, limit, sinceEpochSeconds);
};

const runCommand = (command: readonly string[]): Promise<CommandOutcome> => new Promise((resolve) => {
  const [executable, ...args] = command;
  if (executable === undefined) {
    resolve({ exitCode: 1, signal: null, spawnError: "Missing command executable" });
    return;
  }
  const child = spawn(executable, args, { stdio: "inherit" });
  let spawnError: string | undefined;
  child.once("error", (error) => {
    spawnError = truncate(error.message);
  });
  child.once("close", (exitCode, signal) => {
    resolve({
      exitCode,
      signal,
      ...(spawnError === undefined ? {} : { spawnError }),
    });
  });
});

const record = async (options: RecordOptions): Promise<number> => {
  const failures: QuestTelemetryProbeFailure[] = [];
  const selection = resolveSerial(options.adbPath, options.serial);
  const serial = selection.serial;
  if (selection.failure !== undefined) failures.push({ message: selection.failure, phase: "before", probe: "adb-device" });

  const device = serial === undefined ? null : captureDevice(options.adbPath, serial, failures);
  const before = serial === undefined ? null : captureSnapshot(options.adbPath, serial, "before", failures);
  const startedAtMs = Date.now();
  const command = await runCommand(options.command);
  const endedAtMs = Date.now();
  const events = serial === undefined
    ? { dropped: 0, entries: [] as readonly QuestTelemetryLogEntry[] }
    : captureLogcat(options.adbPath, serial, options.logLimit, startedAtMs / 1_000, failures);
  const after = serial === undefined ? null : captureSnapshot(options.adbPath, serial, "after", failures);

  const report = {
    schema,
    version: schemaVersion,
    available: serial !== undefined,
    run: {
      startedAt: new Date(startedAtMs).toISOString(),
      endedAt: new Date(endedAtMs).toISOString(),
      durationMs: endedAtMs - startedAtMs,
      commandExitCode: command.exitCode,
      commandSignal: command.signal,
      ...(command.spawnError === undefined ? {} : { commandSpawnError: command.spawnError }),
    },
    device,
    before,
    after,
    events: {
      dropped: events.dropped,
      entries: events.entries,
    },
    probeFailures: failures,
  };

  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await writeFile(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote ${options.outputPath}`);
  if (command.exitCode !== null) return command.exitCode;
  return 1;
};

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const options = parseRecordArgs(process.argv.slice(2));
    process.exitCode = await record(options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}

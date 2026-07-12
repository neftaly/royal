export type FuzzCaseContext = {
  readonly caseIndex: number;
  readonly label: string;
  readonly random: SeededRandom;
  readonly replayLabel?: string;
  readonly replay?: unknown;
  readonly seed: number;
};
export type FuzzCaseOptions = {
  readonly cases?: number;
  readonly envName?: string;
  readonly replays?: readonly FuzzReplay[];
  readonly seed: number;
};
export type FuzzReplay = {
  readonly label: string;
  readonly seed?: number;
  readonly value: unknown;
};
export type FuzzTraceReplay<Operation> = {
  readonly label: string;
  readonly value: readonly Operation[];
};

export type FuzzTraceOptions<Operation> = {
  readonly cases?: number;
  readonly envName?: string;
  readonly maxShrinkAttempts?: number;
  readonly operation: (random: SeededRandom, step: number) => Operation;
  readonly replayEnvName?: string;
  readonly replays?: readonly FuzzTraceReplay<Operation>[];
  readonly run: (trace: readonly Operation[], label: string) => Promise<void> | void;
  readonly seed: number;
  readonly shrinkOperation?: (operation: Operation) => readonly Operation[];
  readonly steps: number;
};

const defaultFuzzCasesEnvName = "ROYAL_FUZZ_CASES";

export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
    if (this.#state === 0) this.#state = 0x9e3779b9;
  }
  boolean(probability = 0.5): boolean {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      throw new Error("fuzz probability must be between 0 and 1");
    }
    return this.float() < probability;
  }
  float(): number {
    this.#state = (Math.imul(this.#state, 1664525) + 1013904223) >>> 0;
    return this.#state / 0x100000000;
  }
  int(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive) || maxExclusive <= minInclusive) {
      throw new Error("fuzz integer range must be non-empty integers");
    }
    return minInclusive + Math.floor(this.float() * (maxExclusive - minInclusive));
  }
  number(minInclusive: number, maxExclusive: number): number {
    if (!Number.isFinite(minInclusive) || !Number.isFinite(maxExclusive) || maxExclusive <= minInclusive) {
      throw new Error("fuzz number range must be finite and non-empty");
    }
    return minInclusive + this.float() * (maxExclusive - minInclusive);
  }
  pick<T>(values: readonly T[]): T {
    if (values.length < 1) throw new Error("fuzz pick requires at least one value");
    return values[this.int(0, values.length)] as T;
  }
  array<T>(length: number, item: (index: number) => T): readonly T[] {
    if (!Number.isInteger(length) || length < 0) {
      throw new Error("fuzz array length must be a non-negative integer");
    }
    return Array.from({ length }, (_value, index) => item(index));
  }
}
export const fuzzCaseCount = (
  defaultCases: number,
  envName = defaultFuzzCasesEnvName,
): number => {
  if (!Number.isInteger(defaultCases) || defaultCases < 1) {
    throw new Error("default fuzz case count must be a positive integer");
  }
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return defaultCases;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${envName} must be a positive integer when set`);
  }
  return parsed;
};
export const forEachFuzzCase = (
  options: FuzzCaseOptions,
  run: (context: FuzzCaseContext) => void,
): void => {
  for (const [replayIndex, replay] of (options.replays ?? []).entries()) {
    const seed = replay.seed ?? seedForCase(options.seed, replayIndex);
    const label = `replay=${replay.label} seed=0x${seed.toString(16).padStart(8, "0")}`;
    try {
      run({
        caseIndex: -1 - replayIndex,
        label,
        random: new SeededRandom(seed),
        replay: replay.value,
        replayLabel: replay.label,
        seed,
      });
    } catch (error) {
      throw new Error(`Fuzz replay failed (${label})`, { cause: error });
    }
  }
  const count = fuzzCaseCount(options.cases ?? 16, options.envName);
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const seed = seedForCase(options.seed, caseIndex);
    const label = `seed=0x${seed.toString(16).padStart(8, "0")} case=${caseIndex}`;
    try {
      run({
        caseIndex,
        label,
        random: new SeededRandom(seed),
        seed,
      });
    } catch (error) {
      throw new Error(`Fuzz case failed (${label})`, { cause: error });
    }
  }
};
const seedForCase = (baseSeed: number, caseIndex: number): number => {
  let state = (baseSeed ^ Math.imul(caseIndex + 1, 0x9e3779b9)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0;
  return (state ^ (state >>> 16)) >>> 0;
};
const traceFailure = async <Operation>(
  run: FuzzTraceOptions<Operation>["run"],
  trace: readonly Operation[],
  label: string,
): Promise<unknown | undefined> => {
  try {
    await run(trace, label);
    return undefined;
  } catch (error) {
    return { error };
  }
};

const shrinkTrace = async <Operation>(
  options: FuzzTraceOptions<Operation>,
  original: readonly Operation[],
  label: string,
): Promise<readonly Operation[]> => {
  let attempts = 0;
  const maximum = options.maxShrinkAttempts ?? 128;
  let trace = [...original];
  for (let chunks = 2; trace.length > 1 && attempts < maximum;) {
    const width = Math.ceil(trace.length / chunks);
    let reduced = false;
    for (let start = 0; start < trace.length && attempts < maximum; start += width) {
      const candidate = [...trace.slice(0, start), ...trace.slice(start + width)];
      if (candidate.length === 0) continue;
      attempts += 1;
      if (await traceFailure(options.run, candidate, `${label} shrink=${attempts}`) !== undefined) {
        trace = candidate;
        chunks = Math.max(2, chunks - 1);
        reduced = true;
        break;
      }
    }
    if (!reduced && chunks >= trace.length) break;
    if (!reduced) chunks = Math.min(trace.length, chunks * 2);
  }
  if (options.shrinkOperation === undefined) return trace;
  for (let index = 0; index < trace.length && attempts < maximum; index += 1) {
    for (const simpler of options.shrinkOperation(trace[index]!)) {
      const candidate = [...trace];
      candidate[index] = simpler;
      attempts += 1;
      if (await traceFailure(options.run, candidate, `${label} shrink=${attempts}`) !== undefined) {
        trace = candidate;
        break;
      }
      if (attempts >= maximum) break;
    }
  }
  return trace;
};
/** Runs serializable state-machine traces with bounded deterministic shrinking and replay. */
export const runFuzzTraces = async <Operation>(options: FuzzTraceOptions<Operation>): Promise<void> => {
  if (!Number.isInteger(options.steps) || options.steps < 1) {
    throw new Error("fuzz trace steps must be positive");
  }
  const replayEnvName = options.replayEnvName ?? "ROYAL_FUZZ_REPLAY";
  const envReplay = process.env[replayEnvName];
  const replays = [...(options.replays ?? [])];
  if (envReplay !== undefined && envReplay.trim() !== "") {
    const parsed: unknown = JSON.parse(envReplay);
    if (!Array.isArray(parsed)) throw new Error(`${replayEnvName} must contain a JSON operation array`);
    replays.push({ label: replayEnvName, value: parsed as Operation[] });
  }
  const traces: Array<{ readonly label: string; readonly trace: readonly Operation[] }> = replays.map((replay) => (
    { label: `replay=${replay.label}`, trace: replay.value }
  ));
  const count = envReplay === undefined || envReplay.trim() === ""
    ? fuzzCaseCount(options.cases ?? 12, options.envName)
    : 0;
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const seed = seedForCase(options.seed, caseIndex);
    const random = new SeededRandom(seed);
    traces.push({
      label: `seed=0x${seed.toString(16).padStart(8, "0")} case=${caseIndex}`,
      trace: random.array(options.steps, (step) => options.operation(random, step)),
    });
  }
  for (const { label, trace } of traces) {
    const failure = await traceFailure(options.run, trace, label);
    if (failure === undefined) continue;
    const minimized = await shrinkTrace(options, trace, label);
    let finalCause: unknown;
    try {
      await options.run(minimized, `${label} minimized`);
    } catch (error) {
      finalCause = error;
    }
    throw new Error(`Fuzz trace failed (${label}) trace=${JSON.stringify(minimized)}`, { cause: finalCause });
  }
};

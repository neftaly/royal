type FuzzCaseContext = {
  readonly caseIndex: number;
  readonly label: string;
  readonly random: SeededRandom;
  readonly replayLabel?: string;
  readonly replay?: unknown;
  readonly seed: number;
};
type FuzzCaseOptions = {
  readonly cases?: number;
  readonly envName?: string;
  readonly replays?: readonly FuzzReplay[];
  readonly seed: number;
};
type FuzzReplay = {
  readonly label: string;
  readonly seed?: number;
  readonly value: unknown;
};
/** Low-overhead assertions for hot property-test loops. The fuzz runner adds seed context. */
export const assertFuzz: (condition: boolean, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const assertFuzzEqual = <Value>(
  actual: Value,
  expected: Value,
  message: string,
): void => {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
  }
};

export const assertFuzzArrayEqual = (
  actual: ArrayLike<unknown>,
  expected: ArrayLike<unknown>,
  message: string,
): void => {
  assertFuzzEqual(actual.length, expected.length, `${message} length`);
  for (let index = 0; index < actual.length; index += 1) {
    assertFuzzEqual(actual[index], expected[index], `${message}[${index}]`);
  }
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
const fuzzCaseCount = (
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
const seedForCase = (baseSeed: number, caseIndex: number): number => {
  let state = (baseSeed ^ Math.imul(caseIndex + 1, 0x9e3779b9)) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x85ebca6b) >>> 0;
  state = Math.imul(state ^ (state >>> 13), 0xc2b2ae35) >>> 0;
  return (state ^ (state >>> 16)) >>> 0;
};
const fuzzCases = function* (options: FuzzCaseOptions): Generator<FuzzCaseContext> {
  for (const [replayIndex, replay] of (options.replays ?? []).entries()) {
    const seed = replay.seed ?? seedForCase(options.seed, replayIndex);
    yield {
      caseIndex: -1 - replayIndex,
      label: `replay=${replay.label} seed=0x${seed.toString(16).padStart(8, "0")}`,
      random: new SeededRandom(seed),
      replay: replay.value,
      replayLabel: replay.label,
      seed,
    };
  }
  const count = fuzzCaseCount(options.cases ?? 16, options.envName);
  for (let caseIndex = 0; caseIndex < count; caseIndex += 1) {
    const seed = seedForCase(options.seed, caseIndex);
    yield {
      caseIndex,
      label: `seed=0x${seed.toString(16).padStart(8, "0")} case=${caseIndex}`,
      random: new SeededRandom(seed),
      seed,
    };
  }
};
const wrapFuzzFailure = (context: FuzzCaseContext, error: unknown): Error => new Error(
  `Fuzz ${context.replayLabel === undefined ? "case" : "replay"} failed (${context.label})`,
  { cause: error },
);
export const forEachFuzzCase = (
  options: FuzzCaseOptions,
  run: (context: FuzzCaseContext) => void,
): void => {
  for (const context of fuzzCases(options)) {
    try {
      run(context);
    } catch (error) {
      throw wrapFuzzFailure(context, error);
    }
  }
};

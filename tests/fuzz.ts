export type FuzzCaseContext = {
  readonly caseIndex: number;
  readonly label: string;
  readonly random: SeededRandom;
  readonly seed: number;
};

export type FuzzCaseOptions = {
  readonly cases?: number;
  readonly envName?: string;
  readonly seed: number;
};

const defaultFuzzCasesEnvName = "ROYAL_FUZZ_CASES";

export class SeededRandom {
  #state: number;

  constructor(seed: number) {
    this.#state = seed >>> 0;
    if (this.#state === 0) this.#state = 0x9e3779b9;
  }

  boolean(probability = 0.5): boolean {
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

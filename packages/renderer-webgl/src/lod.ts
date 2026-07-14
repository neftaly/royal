/** Canonical prepared levels ordered from highest to lowest detail. */
export type LodSet<Level> = {
  readonly levels: readonly Level[];
  /** Descending normalized screen-coverage thresholds, one per level. */
  readonly thresholds: readonly number[];
};

/** Associates one prepared drawable with its level in a shared LOD set. */
export type LodLevelMembership = {
  /** Stable within one prepared asset; it has no source-format meaning. */
  readonly group: string;
  readonly level: number;
  readonly levelCount: number;
  /** Descending normalized screen-coverage thresholds, one per level. */
  readonly thresholds: readonly number[];
};

const fallbackLodThreshold = (level: number, levelCount: number): number =>
  level >= levelCount - 1 ? 0 : 0.2 / (4 ** level);

/**
 * Lowers optional source-format hints into Royal's complete runtime threshold
 * contract. Missing and invalid hints receive deterministic defaults; source
 * ordering cannot make a lower-detail level require more coverage.
 */
export const normalizeLodThresholds = (
  hints: readonly unknown[] | undefined,
  levelCount: number,
): readonly number[] => {
  if (!Number.isSafeInteger(levelCount) || levelCount < 1) {
    throw new Error("Royal LOD level count must be a positive safe integer");
  }
  const thresholds: number[] = [];
  let previous = 1;
  for (let level = 0; level < levelCount; level += 1) {
    const hint = hints?.[level];
    const threshold = typeof hint === "number" && Number.isFinite(hint)
      ? Math.max(0, Math.min(1, hint))
      : fallbackLodThreshold(level, levelCount);
    const ordered = Math.min(previous, threshold);
    thresholds.push(ordered);
    previous = ordered;
  }
  return thresholds;
};

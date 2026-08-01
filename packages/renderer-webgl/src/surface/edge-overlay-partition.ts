export const SCREEN_SPACE_PARTITION_PATTERN_SIZE = 64;
export const SCREEN_SPACE_PARTITION_PATTERN_BYTES =
  SCREEN_SPACE_PARTITION_PATTERN_SIZE * SCREEN_SPACE_PARTITION_PATTERN_SIZE * 2;
const SCREEN_SPACE_PARTITION_PATTERN_CELLS =
  SCREEN_SPACE_PARTITION_PATTERN_SIZE * SCREEN_SPACE_PARTITION_PATTERN_SIZE;

const buildScreenSpacePartitionPattern = (): Uint16Array => {
  const pattern = Uint16Array.from(
    { length: SCREEN_SPACE_PARTITION_PATTERN_CELLS },
    (_, index) => index,
  );
  let state = 0x9e37_79b9;
  for (let index = pattern.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    const other = state % (index + 1);
    const value = pattern[index]!;
    pattern[index] = pattern[other]!;
    pattern[other] = value;
  }
  return pattern;
};

const SCREEN_SPACE_PARTITION_PATTERN = buildScreenSpacePartitionPattern();

/** Creates the one deterministic R16UI tile shared by every partition count. */
export const createScreenSpacePartitionPattern = (): Uint16Array =>
  SCREEN_SPACE_PARTITION_PATTERN.slice();

/** CPU reference used to verify orientation balance and exact partitioning. */
export const screenSpacePartitionCellIndex = (
  cellX: number,
  cellY: number,
  count: number,
): number => {
  const mask = SCREEN_SPACE_PARTITION_PATTERN_SIZE - 1;
  const bucket = SCREEN_SPACE_PARTITION_PATTERN[
    (cellY & mask) * SCREEN_SPACE_PARTITION_PATTERN_SIZE + (cellX & mask)
  ]!;
  return (bucket * count) >>> 12;
};

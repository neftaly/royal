export const NO_SHARED_VIEW_LOD_LEVEL = 0xffff_ffff;

export type SharedViewLodMetadataSource = {
  /** One byte per level; zero means unavailable, non-zero means drawable. */
  readonly drawableLevels: Uint8Array;
  readonly levelCount: number;
  readonly offset: number;
  /** Descending screen-coverage thresholds, aligned with drawableLevels. */
  readonly thresholds: Float64Array;
};

export type SharedViewLodMetadata = SharedViewLodMetadataSource & {
  readonly validated: true;
};

/** Validates prepared metadata once, outside observation/finalization hot paths. */
export const validateSharedViewLodMetadata = (
  source: SharedViewLodMetadataSource,
): SharedViewLodMetadata => {
  const { levelCount, offset } = source;
  if (!Number.isSafeInteger(levelCount) || levelCount < 1 || !Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("Royal shared-view LOD metadata range is invalid");
  }
  if (offset + levelCount > source.thresholds.length || offset + levelCount > source.drawableLevels.length) {
    throw new Error("Royal shared-view LOD metadata exceeds its typed storage");
  }
  let previous = 1;
  let hasDrawableLevel = false;
  for (let level = 0; level < levelCount; level += 1) {
    const thresholdValue = source.thresholds[offset + level]!;
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || thresholdValue > 1 || thresholdValue > previous) {
      throw new Error("Royal shared-view LOD thresholds must be finite, normalized, and nonincreasing");
    }
    previous = thresholdValue;
    hasDrawableLevel ||= source.drawableLevels[offset + level] !== 0;
  }
  if (!hasDrawableLevel) throw new Error("Royal shared-view LOD metadata requires a drawable level");
  return { ...source, validated: true };
};

/** Caller-owned retained selection storage indexed by dense selection ID. */
export type SharedViewLodSelections = {
  capacity: number;
  epoch: number;
  finalizationEpochs: Uint32Array;
  maximumCoverages: Float64Array;
  observationEpochs: Uint32Array;
  /** Current epoch only when finalization produced a level usable by packets. */
  selectionEpochs: Uint32Array;
  selectedLevels: Uint32Array;
};

const normalizedCapacity = (capacity: number): number => {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error("Royal shared-view LOD capacity must be a positive safe integer");
  }
  return capacity;
};

export const createSharedViewLodSelections = (capacity = 1): SharedViewLodSelections => {
  const normalized = normalizedCapacity(capacity);
  const selectedLevels = new Uint32Array(normalized);
  selectedLevels.fill(NO_SHARED_VIEW_LOD_LEVEL);
  return {
    capacity: normalized,
    epoch: 0,
    finalizationEpochs: new Uint32Array(normalized),
    maximumCoverages: new Float64Array(normalized),
    observationEpochs: new Uint32Array(normalized),
    selectionEpochs: new Uint32Array(normalized),
    selectedLevels,
  };
};

const nextCapacity = (current: number, required: number): number => {
  let capacity = current;
  while (capacity < required) {
    const next = capacity * 2;
    if (!Number.isSafeInteger(next)) {
      throw new Error("Royal shared-view LOD capacity is exhausted");
    }
    capacity = next;
  }
  return capacity;
};

/** Explicit growth seam. Observation and finalization never allocate. */
export const reserveSharedViewLodSelections = (
  selections: SharedViewLodSelections,
  minimumCapacity: number,
): void => {
  const minimum = normalizedCapacity(minimumCapacity);
  if (minimum <= selections.capacity) return;
  const capacity = nextCapacity(selections.capacity, minimum);
  const finalizationEpochs = new Uint32Array(capacity);
  const maximumCoverages = new Float64Array(capacity);
  const observationEpochs = new Uint32Array(capacity);
  const selectionEpochs = new Uint32Array(capacity);
  const selectedLevels = new Uint32Array(capacity);
  finalizationEpochs.set(selections.finalizationEpochs);
  maximumCoverages.set(selections.maximumCoverages);
  observationEpochs.set(selections.observationEpochs);
  selectionEpochs.set(selections.selectionEpochs);
  selectedLevels.fill(NO_SHARED_VIEW_LOD_LEVEL);
  selectedLevels.set(selections.selectedLevels);
  selections.capacity = capacity;
  selections.finalizationEpochs = finalizationEpochs;
  selections.maximumCoverages = maximumCoverages;
  selections.observationEpochs = observationEpochs;
  selections.selectionEpochs = selectionEpochs;
  selections.selectedLevels = selectedLevels;
};

/** Starts a frame without clearing per-selection storage. */
export const beginSharedViewLodSelections = (selections: SharedViewLodSelections): number => {
  if (selections.epoch === 0xffff_ffff) {
    selections.finalizationEpochs.fill(0);
    selections.observationEpochs.fill(0);
    selections.selectionEpochs.fill(0);
    selections.epoch = 1;
  } else {
    selections.epoch += 1;
  }
  return selections.epoch;
};

const selectionId = (selections: SharedViewLodSelections, id: number): number => {
  if (!Number.isSafeInteger(id) || id < 0 || id >= selections.capacity) {
    throw new Error("Royal shared-view LOD selection ID exceeds reserved capacity");
  }
  return id;
};

/** Observes one visible view. Invisible views should not call this function. */
export const observeSharedViewLodCoverage = (
  selections: SharedViewLodSelections,
  id: number,
  coverage: number,
): void => {
  const index = selectionId(selections, id);
  if (selections.epoch === 0) throw new Error("Royal shared-view LOD observation requires an active epoch");
  if (!Number.isFinite(coverage) || coverage < 0 || coverage > 1) {
    throw new Error("Royal shared-view LOD coverage must be finite and between zero and one");
  }
  if (selections.observationEpochs[index] !== selections.epoch) {
    selections.observationEpochs[index] = selections.epoch;
    selections.maximumCoverages[index] = coverage;
    return;
  }
  if (coverage > selections.maximumCoverages[index]!) selections.maximumCoverages[index] = coverage;
};

const fallbackThreshold = (level: number, levelCount: number): number =>
  level >= levelCount - 1 ? 0 : 0.2 / (4 ** level);

const threshold = (metadata: SharedViewLodMetadata, level: number): number =>
  metadata.thresholds[metadata.offset + level] ?? fallbackThreshold(level, metadata.levelCount);

export const sharedViewHystereticLodLevel = (
  coverage: number,
  metadata: SharedViewLodMetadata,
  previousLevel: number | undefined,
  hysteresisRatio = 0.15,
): number => {
  if (!Number.isFinite(hysteresisRatio) || hysteresisRatio < 0 || hysteresisRatio > 1) {
    throw new Error("Royal shared-view LOD hysteresis ratio must be finite and between zero and one");
  }
  let stateless = metadata.levelCount - 1;
  for (let level = 0; level < metadata.levelCount; level += 1) {
    if (coverage >= threshold(metadata, level)) {
      stateless = level;
      break;
    }
  }
  if (previousLevel === undefined || previousLevel < 0 || previousLevel >= metadata.levelCount) {
    return stateless;
  }
  let level = previousLevel;
  while (level > 0) {
    if (coverage < Math.min(1, threshold(metadata, level - 1) * (1 + hysteresisRatio))) break;
    level -= 1;
  }
  while (level < metadata.levelCount - 1) {
    if (coverage >= threshold(metadata, level) * (1 - hysteresisRatio)) break;
    level += 1;
  }
  return level;
};

const drawable = (metadata: SharedViewLodMetadata, level: number): boolean =>
  metadata.drawableLevels[metadata.offset + level] !== 0;

const drawableLevel = (
  metadata: SharedViewLodMetadata,
  target: number,
  previous: number | undefined,
): number => {
  if (drawable(metadata, target)) return target;
  if (previous !== undefined && previous >= 0 && previous < metadata.levelCount && drawable(metadata, previous)) {
    return previous;
  }
  for (let level = 0; level < metadata.levelCount; level += 1) {
    if (drawable(metadata, level)) return level;
  }
  throw new Error("Royal shared-view LOD metadata has no drawable level");
};

/** Finalizes one selection exactly once in the current epoch. */
export const finalizeSharedViewLodSelection = (
  selections: SharedViewLodSelections,
  id: number,
  metadata: SharedViewLodMetadata,
): number | undefined => {
  const index = selectionId(selections, id);
  if (selections.epoch === 0) throw new Error("Royal shared-view LOD finalization requires an active epoch");
  if (selections.finalizationEpochs[index] === selections.epoch) {
    throw new Error("Royal shared-view LOD selection was finalized twice in one epoch");
  }
  const retained = selections.selectedLevels[index]!;
  const previous = retained === NO_SHARED_VIEW_LOD_LEVEL ? undefined : retained;
  const observed = selections.observationEpochs[index] === selections.epoch;
  selections.finalizationEpochs[index] = selections.epoch;
  if (!observed) return undefined;
  const target = sharedViewHystereticLodLevel(selections.maximumCoverages[index]!, metadata, previous);
  const selected = drawableLevel(metadata, target, previous);
  selections.selectedLevels[index] = selected;
  selections.selectionEpochs[index] = selections.epoch;
  return selected;
};

/** Finalizes an unobserved selection to an exact visible drawable level. */
export const finalizeUnobservedSharedViewLodFallback = (
  selections: SharedViewLodSelections,
  id: number,
  metadata: SharedViewLodMetadata,
  fallbackLevel: number,
): number => {
  const index = selectionId(selections, id);
  if (selections.epoch === 0) throw new Error("Royal shared-view LOD fallback requires an active epoch");
  if (selections.finalizationEpochs[index] === selections.epoch) {
    throw new Error("Royal shared-view LOD selection was finalized twice in one epoch");
  }
  if (selections.observationEpochs[index] === selections.epoch) {
    throw new Error("Royal shared-view LOD fallback requires an unobserved selection");
  }
  if (
    !Number.isSafeInteger(fallbackLevel)
    || fallbackLevel < 0
    || fallbackLevel >= metadata.levelCount
    || !drawable(metadata, fallbackLevel)
  ) {
    throw new Error("Royal shared-view LOD fallback must be a drawable metadata level");
  }
  selections.finalizationEpochs[index] = selections.epoch;
  selections.selectedLevels[index] = fallbackLevel;
  selections.selectionEpochs[index] = selections.epoch;
  return fallbackLevel;
};

export const sharedViewLodWasObserved = (
  selections: SharedViewLodSelections,
  id: number,
): boolean => selections.epoch !== 0
  && selections.observationEpochs[selectionId(selections, id)] === selections.epoch;

export const sharedViewLodSelectedLevel = (
  selections: SharedViewLodSelections,
  id: number,
): number | undefined => {
  const selected = selections.selectedLevels[selectionId(selections, id)]!;
  return selected === NO_SHARED_VIEW_LOD_LEVEL ? undefined : selected;
};

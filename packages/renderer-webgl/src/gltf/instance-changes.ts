export type InstanceDirtyBits = {
  maxDirtyWord: number;
  minDirtyWord: number;
  readonly words: Uint32Array;
};

export const createInstanceDirtyBits = (count: number, dirty = false): InstanceDirtyBits => {
  const words = new Uint32Array(Math.ceil(count / 32));
  if (dirty) words.fill(0xffff_ffff);
  const trailingBits = count & 31;
  if (dirty && trailingBits !== 0 && words.length > 0) {
    words[words.length - 1] = 0xffff_ffff >>> (32 - trailingBits);
  }
  return {
    maxDirtyWord: dirty ? words.length - 1 : -1,
    minDirtyWord: dirty ? 0 : words.length,
    words,
  };
};

const clearInstanceDirtyBits = (dirty: InstanceDirtyBits): void => {
  if (dirty.maxDirtyWord >= dirty.minDirtyWord) {
    dirty.words.fill(0, dirty.minDirtyWord, dirty.maxDirtyWord + 1);
  }
  dirty.minDirtyWord = dirty.words.length;
  dirty.maxDirtyWord = -1;
};

const mergeInstanceDirtyBits = (target: InstanceDirtyBits, source: InstanceDirtyBits): void => {
  if (source.maxDirtyWord < source.minDirtyWord) return;
  for (let index = source.minDirtyWord; index <= source.maxDirtyWord; index += 1) {
    target.words[index] = target.words[index]! | source.words[index]!;
  }
  target.minDirtyWord = Math.min(target.minDirtyWord, source.minDirtyWord);
  target.maxDirtyWord = Math.max(target.maxDirtyWord, source.maxDirtyWord);
};

export const markInstanceDirtyRange = (
  dirty: InstanceDirtyBits,
  startIndex: number,
  count: number,
): void => {
  const endIndex = startIndex + count;
  const firstWord = startIndex >>> 5;
  const lastWord = (endIndex - 1) >>> 5;
  const firstBit = startIndex & 31;
  const endBit = endIndex & 31;
  const firstMask = 0xffff_ffff << firstBit;
  const lastMask = endBit === 0 ? 0xffff_ffff : 0xffff_ffff >>> (32 - endBit);

  if (firstWord === lastWord) {
    dirty.words[firstWord] = dirty.words[firstWord]! | (firstMask & lastMask);
  } else {
    dirty.words[firstWord] = dirty.words[firstWord]! | firstMask;
    dirty.words.fill(0xffff_ffff, firstWord + 1, lastWord);
    dirty.words[lastWord] = dirty.words[lastWord]! | lastMask;
  }
  dirty.minDirtyWord = Math.min(dirty.minDirtyWord, firstWord);
  dirty.maxDirtyWord = Math.max(dirty.maxDirtyWord, lastWord);
};

export const isInstanceDirty = (dirty: InstanceDirtyBits, index: number): boolean =>
  (dirty.words[index >>> 5]! & (1 << (index & 31))) !== 0;

export const areAllInstancesDirty = (dirty: InstanceDirtyBits, count: number): boolean => {
  if (count === 0) return true;
  const lastWord = (count - 1) >>> 5;
  if (dirty.minDirtyWord !== 0 || dirty.maxDirtyWord !== lastWord) return false;
  for (let wordIndex = 0; wordIndex < lastWord; wordIndex += 1) {
    if (dirty.words[wordIndex] !== 0xffff_ffff) return false;
  }
  const trailingBits = count & 31;
  const lastMask = trailingBits === 0 ? 0xffff_ffff : 0xffff_ffff >>> (32 - trailingBits);
  return dirty.words[lastWord] === lastMask;
};

export const isPackedInstanceSlotDirty = (
  dirty: InstanceDirtyBits | undefined,
  logicalIndex: number,
  sameSource: boolean,
  previousLogicalIndex: number,
  sourceVersionChanged: boolean,
): boolean =>
  !sameSource
  || previousLogicalIndex !== logicalIndex
  || (dirty !== undefined && sourceVersionChanged && isInstanceDirty(dirty, logicalIndex));

export class GltfInstanceChangeTracker {
  activePosition: InstanceDirtyBits;
  activeRotation: InstanceDirtyBits;
  activeScale: InstanceDirtyBits;
  pendingPosition: InstanceDirtyBits;
  pendingRotation: InstanceDirtyBits;
  pendingScale: InstanceDirtyBits;

  constructor(readonly count: number, initiallyDirty = true) {
    this.activePosition = createInstanceDirtyBits(count);
    this.activeRotation = createInstanceDirtyBits(count);
    this.activeScale = createInstanceDirtyBits(count);
    this.pendingPosition = createInstanceDirtyBits(count, initiallyDirty);
    this.pendingRotation = createInstanceDirtyBits(count, initiallyDirty);
    this.pendingScale = createInstanceDirtyBits(count, initiallyDirty);
  }

  beginFrame(): void {
    clearInstanceDirtyBits(this.activePosition);
    clearInstanceDirtyBits(this.activeRotation);
    clearInstanceDirtyBits(this.activeScale);
    const previousActivePosition = this.activePosition;
    const previousActiveRotation = this.activeRotation;
    const previousActiveScale = this.activeScale;
    this.activePosition = this.pendingPosition;
    this.activeRotation = this.pendingRotation;
    this.activeScale = this.pendingScale;
    this.pendingPosition = previousActivePosition;
    this.pendingRotation = previousActiveRotation;
    this.pendingScale = previousActiveScale;
  }

  abortFrame(): void {
    mergeInstanceDirtyBits(this.pendingPosition, this.activePosition);
    mergeInstanceDirtyBits(this.pendingRotation, this.activeRotation);
    mergeInstanceDirtyBits(this.pendingScale, this.activeScale);
  }

  commit(channel: 'position' | 'pose' | 'rotation' | 'scale', startIndex: number, count: number): void {
    if (channel === 'scale') {
      markInstanceDirtyRange(this.pendingScale, startIndex, count);
      return;
    }
    if (channel === 'position' || channel === 'pose') {
      markInstanceDirtyRange(this.pendingPosition, startIndex, count);
    }
    if (channel === 'rotation' || channel === 'pose') {
      markInstanceDirtyRange(this.pendingRotation, startIndex, count);
    }
  }
}

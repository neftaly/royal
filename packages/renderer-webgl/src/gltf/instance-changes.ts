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
  activePose: InstanceDirtyBits;
  activeRotation: InstanceDirtyBits;
  activeScale: InstanceDirtyBits;
  pendingPose: InstanceDirtyBits;
  pendingRotation: InstanceDirtyBits;
  pendingScale: InstanceDirtyBits;

  constructor(readonly count: number) {
    this.activePose = createInstanceDirtyBits(count);
    this.activeRotation = createInstanceDirtyBits(count);
    this.activeScale = createInstanceDirtyBits(count);
    this.pendingPose = createInstanceDirtyBits(count, true);
    this.pendingRotation = createInstanceDirtyBits(count, true);
    this.pendingScale = createInstanceDirtyBits(count, true);
  }

  beginFrame(): void {
    clearInstanceDirtyBits(this.activePose);
    clearInstanceDirtyBits(this.activeRotation);
    clearInstanceDirtyBits(this.activeScale);
    const previousActivePose = this.activePose;
    const previousActiveRotation = this.activeRotation;
    const previousActiveScale = this.activeScale;
    this.activePose = this.pendingPose;
    this.activeRotation = this.pendingRotation;
    this.activeScale = this.pendingScale;
    this.pendingPose = previousActivePose;
    this.pendingRotation = previousActiveRotation;
    this.pendingScale = previousActiveScale;
  }

  abortFrame(): void {
    mergeInstanceDirtyBits(this.pendingPose, this.activePose);
    mergeInstanceDirtyBits(this.pendingRotation, this.activeRotation);
    mergeInstanceDirtyBits(this.pendingScale, this.activeScale);
  }

  commit(channel: 'position' | 'pose' | 'rotation' | 'scale', startIndex: number, count: number): void {
    if (channel === 'scale') {
      markInstanceDirtyRange(this.pendingScale, startIndex, count);
      return;
    }
    markInstanceDirtyRange(this.pendingPose, startIndex, count);
    if (channel === 'rotation' || channel === 'pose') {
      markInstanceDirtyRange(this.pendingRotation, startIndex, count);
    }
  }
}

export type ProgressivePresentationDecision = Readonly<{
  delayMs: number;
  present: boolean;
}>;

/** Pure cadence policy for progressively improving an already-usable frame. */
export const progressivePresentationDecision = (
  lastPresentationAt: number,
  now: number,
  intervalMs: number,
  urgent = false,
): ProgressivePresentationDecision => {
  if (!Number.isFinite(now)) throw new TypeError("Royal presentation time must be finite");
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new RangeError("Royal presentation interval must be positive and finite");
  }
  if (urgent || lastPresentationAt === -Infinity) return { delayMs: 0, present: true };
  if (!Number.isFinite(lastPresentationAt)) {
    throw new TypeError("Royal previous presentation time must be finite or -Infinity");
  }
  const remaining = intervalMs - Math.max(0, now - lastPresentationAt);
  return remaining <= 0
    ? { delayMs: 0, present: true }
    : { delayMs: remaining, present: false };
};

export const NO_RESOURCE_ID = 0xffff_ffff;
export const MAX_RESOURCE_ID = NO_RESOURCE_ID - 1;

/** Pure, allocation-free transition guard for monotonic arena identities. */
export const claimMonotonicId = (next: number, maximum: number, label: string): number => {
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error(`${label} ID bounds must be positive safe integers`);
  }
  if (next > maximum) throw new Error(`${label} ID space is exhausted`);
  if (!Number.isSafeInteger(next) || next < 1) {
    throw new Error(`${label} ID bounds must be positive safe integers`);
  }
  return next;
};

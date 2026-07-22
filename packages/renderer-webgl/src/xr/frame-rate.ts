export type XrPreferredFrameRate = "highest" | number;

export const validateXrPreferredFrameRate = (preference: XrPreferredFrameRate): void => {
  if (preference === "highest") return;
  if (!Number.isFinite(preference) || preference <= 0) {
    throw new RangeError("Royal XR preferredFrameRate must be highest or a positive finite number");
  }
};

/** Pure best-effort selection; ties prefer the lower-power advertised rate. */
export const selectXrPreferredFrameRate = (
  preference: XrPreferredFrameRate,
  supported: ArrayLike<number> | undefined,
): number | undefined => {
  validateXrPreferredFrameRate(preference);
  if (supported === undefined || supported.length === 0) {
    return preference === "highest" ? undefined : preference;
  }
  let selected: number | undefined;
  let selectedDistance = Infinity;
  for (let index = 0; index < supported.length; index += 1) {
    const candidate = supported[index];
    if (candidate === undefined || !Number.isFinite(candidate) || candidate <= 0) continue;
    if (preference === "highest") {
      if (selected === undefined || candidate > selected) selected = candidate;
      continue;
    }
    const distance = Math.abs(candidate - preference);
    if (
      distance < selectedDistance
      || (distance === selectedDistance && (selected === undefined || candidate < selected))
    ) {
      selected = candidate;
      selectedDistance = distance;
    }
  }
  return selected;
};

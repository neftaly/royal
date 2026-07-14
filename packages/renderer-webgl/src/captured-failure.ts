export type CapturedFailure = { readonly value: unknown };

export const captureFailure = (action: () => void): CapturedFailure | undefined => {
  try {
    action();
    return undefined;
  } catch (value) {
    return { value };
  }
};

/** Runs the action even after an earlier failure, preserving the first thrown value. */
export const captureFirstFailure = (
  first: CapturedFailure | undefined,
  action: () => void,
): CapturedFailure | undefined => {
  const next = captureFailure(action);
  return first ?? next;
};

/**
 * Plans the exclusive end of every contiguous equivalence run.
 *
 * The returned typed array is retained by the imperative caller; no work or
 * allocation is needed to recover a run boundary while rendering a frame.
 */
export const planContiguousRunEndsInto = <Value>(
  ends: Uint32Array,
  values: readonly Value[],
  sharesRun: (left: Value, right: Value) => boolean,
): Uint32Array => {
  if (ends.length !== values.length) {
    throw new RangeError("Royal contiguous run storage must match the value count");
  }
  let runEnd = values.length;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (index + 1 === values.length || !sharesRun(values[index]!, values[index + 1]!)) {
      runEnd = index + 1;
    }
    ends[index] = runEnd;
  }
  return ends;
};

export const planContiguousRunEnds = <Value>(
  values: readonly Value[],
  sharesRun: (left: Value, right: Value) => boolean,
): Uint32Array => planContiguousRunEndsInto(
  new Uint32Array(values.length),
  values,
  sharesRun,
);

/** Reuses one exact-size retained plan when scene topology is unchanged. */
export const planRetainedContiguousRunEnds = <Value>(
  retained: Uint32Array,
  values: readonly Value[],
  sharesRun: (left: Value, right: Value) => boolean,
): Uint32Array => planContiguousRunEndsInto(
  retained.length === values.length ? retained : new Uint32Array(values.length),
  values,
  sharesRun,
);

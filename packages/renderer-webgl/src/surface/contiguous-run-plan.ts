/**
 * Plans the exclusive end of every contiguous equivalence run.
 *
 * The returned typed array is retained by the imperative caller; no work or
 * allocation is needed to recover a run boundary while rendering a frame.
 */
export const planContiguousRunEnds = <Value>(
  values: readonly Value[],
  sharesRun: (left: Value, right: Value) => boolean,
): Uint32Array => {
  const ends = new Uint32Array(values.length);
  let runEnd = values.length;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (index + 1 === values.length || !sharesRun(values[index]!, values[index + 1]!)) {
      runEnd = index + 1;
    }
    ends[index] = runEnd;
  }
  return ends;
};

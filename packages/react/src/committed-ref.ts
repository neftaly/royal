import { useLayoutEffect, useRef, type MutableRefObject } from "react";

/** Keeps imperative callbacks on the latest committed value, never a discarded render. */
export const useCommittedRef = <Value>(value: Value): MutableRefObject<Value> => {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
};

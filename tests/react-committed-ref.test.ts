import { beforeEach, describe, expect, it, vi } from "vitest";

const hookHarness = vi.hoisted(() => ({
  hookIndex: 0,
  pendingEffects: [] as (() => void)[],
  refs: [] as { current: unknown }[],
}));

vi.mock("react", () => ({
  useLayoutEffect: (effect: () => void): void => {
    hookHarness.pendingEffects.push(effect);
  },
  useRef: (initial: unknown): { current: unknown } => {
    const index = hookHarness.hookIndex;
    hookHarness.hookIndex += 1;
    hookHarness.refs[index] ??= { current: initial };
    return hookHarness.refs[index]!;
  },
}));

import { useCommittedRef } from "../packages/react/src/committed-ref";

const render = <Value>(value: Value): {
  readonly commit: () => void;
  readonly ref: { current: Value };
} => {
  hookHarness.hookIndex = 0;
  hookHarness.pendingEffects = [];
  const ref = useCommittedRef(value);
  const effects = hookHarness.pendingEffects.slice();
  return {
    commit: () => {
      for (const effect of effects) effect();
    },
    ref,
  };
};

describe("committed React refs", () => {
  beforeEach(() => {
    hookHarness.hookIndex = 0;
    hookHarness.pendingEffects = [];
    hookHarness.refs = [];
  });

  it("does not expose a value from an uncommitted render", () => {
    const initial = render("committed-a");
    initial.commit();

    render("discarded-b");
    expect(initial.ref.current).toBe("committed-a");

    const replacement = render("committed-c");
    expect(replacement.ref).toBe(initial.ref);
    replacement.commit();
    expect(initial.ref.current).toBe("committed-c");
  });
});

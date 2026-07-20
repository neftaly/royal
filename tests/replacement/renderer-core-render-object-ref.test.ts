import { describe, expect, it, vi } from 'vitest';
import { attachRenderObjectRef } from '@royal/renderer-core/render-object';
import type { RenderObjectHandle } from '@royal/renderer-core';

const identityTransform = {
  position: [0, 0, 0] as const,
  rotation: [0, 0, 0] as const,
  scale: [1, 1, 1] as const,
};

describe('render-object ref attachments', () => {
  it('shares one handle, invalidates every root, and clears only after the final detach', () => {
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const firstRoot = vi.fn();
    const secondRoot = vi.fn();
    const first = attachRenderObjectRef(ref, identityTransform, firstRoot);
    const second = attachRenderObjectRef(ref, identityTransform, secondRoot);

    expect(first.handle).toBe(second.handle);
    expect(ref.current).toBe(first.handle);
    first.handle.position.x = 4;
    expect(firstRoot).toHaveBeenCalledTimes(1);
    expect(secondRoot).toHaveBeenCalledTimes(1);

    first.detach();
    expect(ref.current).toBe(second.handle);
    second.handle.position.y = 5;
    expect(firstRoot).toHaveBeenCalledTimes(1);
    expect(secondRoot).toHaveBeenCalledTimes(2);

    second.detach();
    expect(ref.current).toBeNull();
  });

  it('notifies other roots, but not the declarative update owner, during sync', () => {
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const firstRoot = vi.fn();
    const secondRoot = vi.fn();
    const first = attachRenderObjectRef(ref, identityTransform, firstRoot);
    const second = attachRenderObjectRef(ref, identityTransform, secondRoot);

    first.syncTransform({ ...identityTransform, position: [2, 0, 0] });
    expect(firstRoot).not.toHaveBeenCalled();
    expect(secondRoot).toHaveBeenCalledTimes(1);
    expect(second.handle.position.x).toBe(2);
  });

  it('notifies a stable attachment cohort when listeners detach or attach during notification', () => {
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const calls: string[] = [];
    let second: ReturnType<typeof attachRenderObjectRef>;
    let late: ReturnType<typeof attachRenderObjectRef> | undefined;
    const first = attachRenderObjectRef(ref, identityTransform, () => {
      calls.push('first');
      second.detach();
      late ??= attachRenderObjectRef(ref, identityTransform, () => calls.push('late'));
    });
    second = attachRenderObjectRef(ref, identityTransform, () => calls.push('second'));

    first.handle.position.x = 1;
    expect(calls).toEqual(['first', 'second']);

    calls.length = 0;
    first.handle.position.x = 2;
    expect(calls).toEqual(['first', 'late']);

    first.detach();
    late?.detach();
  });

  it('retains independent cohorts for reentrant handle mutations', () => {
    const ref: { current: RenderObjectHandle | null } = { current: null };
    const calls: string[] = [];
    let nested = false;
    const first = attachRenderObjectRef(ref, identityTransform, () => {
      calls.push('first');
      if (nested) return;
      nested = true;
      first.handle.position.y = 1;
    });
    const second = attachRenderObjectRef(ref, identityTransform, () => calls.push('second'));

    first.handle.position.x = 1;
    expect(calls).toEqual(['first', 'first', 'second', 'second']);

    first.detach();
    second.detach();
  });

  it('retries a final callback-ref clear without retaining its invalidation listener', () => {
    const firstRoot = vi.fn();
    const secondRoot = vi.fn();
    let clearAttempts = 0;
    let cleared = 0;
    const ref = (handle: RenderObjectHandle | null): void => {
      if (handle !== null) return;
      clearAttempts += 1;
      if (clearAttempts === 1) throw new Error('clear failed');
      cleared += 1;
    };
    const first = attachRenderObjectRef(ref, identityTransform, firstRoot);
    const attachment = attachRenderObjectRef(ref, identityTransform, secondRoot);
    expect(attachment.handle).toBe(first.handle);

    first.detach();
    attachment.handle.position.x = 1;
    expect(firstRoot).not.toHaveBeenCalled();
    expect(secondRoot).toHaveBeenCalledTimes(1);
    secondRoot.mockClear();

    expect(() => attachment.detach()).toThrow('clear failed');
    attachment.handle.position.x = 2;
    expect(firstRoot).not.toHaveBeenCalled();
    expect(secondRoot).not.toHaveBeenCalled();

    expect(() => attachment.detach()).not.toThrow();
    expect(clearAttempts).toBe(2);
    expect(cleared).toBe(1);
    expect(() => attachment.detach()).not.toThrow();
    expect(clearAttempts).toBe(2);

    const replacement = attachRenderObjectRef(ref, identityTransform, firstRoot);
    expect(replacement.handle).not.toBe(attachment.handle);
    replacement.detach();
  });

  it('preserves a reentrant attachment when the initial callback throws', () => {
    const nestedRoot = vi.fn();
    let nested: ReturnType<typeof attachRenderObjectRef> | undefined;
    let published: RenderObjectHandle | null = null;
    const ref = (handle: RenderObjectHandle | null): void => {
      published = handle;
      if (handle !== null && nested === undefined) {
        nested = attachRenderObjectRef(ref, identityTransform, nestedRoot);
        throw new Error('outer publication failed');
      }
    };

    expect(() => attachRenderObjectRef(ref, identityTransform, vi.fn())).toThrow('outer publication failed');
    expect(nested).toBeDefined();
    expect(published).toBe(nested!.handle);

    nested!.handle.position.x = 3;
    expect(nestedRoot).toHaveBeenCalledTimes(1);
    nested!.detach();
    expect(published).toBeNull();
    nested!.detach();
    expect(published).toBeNull();
  });

  it('rolls back when a nested attachment detaches during initial publication', () => {
    const publications: Array<RenderObjectHandle | null> = [];
    let publishing = false;
    const ref = (handle: RenderObjectHandle | null): void => {
      publications.push(handle);
      if (handle !== null && !publishing) {
        publishing = true;
        const nested = attachRenderObjectRef(ref, identityTransform, vi.fn());
        nested.detach();
        throw new Error('outer publication failed');
      }
    };

    expect(() => attachRenderObjectRef(ref, identityTransform, vi.fn())).toThrow('outer publication failed');
    expect(publications).toHaveLength(2);
    expect(publications[0]).not.toBeNull();
    expect(publications[1]).toBeNull();

    const replacement = attachRenderObjectRef(ref, identityTransform, vi.fn());
    expect(replacement.handle).not.toBe(publications[0]);
    replacement.detach();
  });

  it('does not delete a newer generation installed by a reentrant callback', () => {
    let replacement: ReturnType<typeof attachRenderObjectRef> | undefined;
    let firstHandle: RenderObjectHandle | undefined;
    let phase: 'initial' | 'clearing' | 'replacement' | 'settled' = 'initial';
    let current: RenderObjectHandle | null = null;
    const ref = (handle: RenderObjectHandle | null): void => {
      current = handle;
      if (phase === 'initial' && handle !== null) {
        firstHandle = handle;
        phase = 'clearing';
        attachRenderObjectRef(ref, identityTransform, vi.fn()).detach();
        throw new Error('outer publication failed');
      }
      if (phase === 'clearing' && handle === null) {
        phase = 'replacement';
        replacement = attachRenderObjectRef(ref, identityTransform, vi.fn());
        phase = 'settled';
      }
    };

    expect(() => attachRenderObjectRef(ref, identityTransform, vi.fn())).toThrow('outer publication failed');
    expect(replacement).toBeDefined();
    expect(replacement!.handle).not.toBe(firstHandle);
    expect(current).toBe(replacement!.handle);

    replacement!.detach();
    expect(current).toBeNull();
  });

  it('keeps a nested failed clear retryable while the outer publication rolls back', () => {
    let nested: ReturnType<typeof attachRenderObjectRef> | undefined;
    let clearAttempts = 0;
    let firstPublication = true;
    const ref = (handle: RenderObjectHandle | null): void => {
      if (handle === null) {
        clearAttempts += 1;
        if (clearAttempts === 1) throw new Error('clear failed');
        return;
      }
      if (firstPublication) {
        firstPublication = false;
        nested = attachRenderObjectRef(ref, identityTransform, vi.fn());
        nested.detach();
      }
    };

    expect(() => attachRenderObjectRef(ref, identityTransform, vi.fn())).toThrow('clear failed');
    expect(nested).toBeDefined();
    expect(() => nested!.detach()).not.toThrow();
    expect(clearAttempts).toBe(2);
    expect(() => nested!.detach()).not.toThrow();
    expect(clearAttempts).toBe(2);
  });
});

import { describe, expect, it } from 'vitest';
import { classifyXrActivation } from './xr-activation-state.mjs';

describe('XR benchmark activation state', () => {
  it.each(['checking', 'available', 'starting', 'active', 'suspended', 'ending'])(
    'keeps the public %s lifecycle state pending until instrumentation is active',
    (status) => {
      expect(classifyXrActivation({
        instrumented: false,
        showsExit: false,
        status,
        statusText: status,
      })).toEqual({ kind: 'pending' });
    },
  );

  it('accepts a live instrumented session and classifies terminal failures', () => {
    expect(classifyXrActivation({
      instrumented: true,
      showsExit: true,
      status: 'active',
      statusText: 'Exit XRactive',
    })).toEqual({ kind: 'active', status: 'active' });
    expect(classifyXrActivation({
      instrumented: false,
      showsExit: false,
      status: 'blocked',
      statusText: 'Enter XRPermission denied',
    })).toEqual({
      kind: 'failure',
      reason: 'xr-status-error',
      status: 'Enter XRPermission denied',
    });
  });

  it('distinguishes a pre-existing immersive session', () => {
    expect(classifyXrActivation({
      instrumented: false,
      showsExit: false,
      status: 'error',
      statusText: 'InvalidStateError: already an active, immersive XRSession',
    })).toEqual({
      kind: 'failure',
      reason: 'immersive-session-already-active',
      status: 'InvalidStateError: already an active, immersive XRSession',
    });
  });
});

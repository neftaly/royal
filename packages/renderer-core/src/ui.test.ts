import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  isUiActivatable,
  isUiFocusable,
  uiControlState,
  uiHitRegion,
  uiNodeSemantics,
  type UiHitRegion,
  type UiNodeSemantics
} from './index';

describe('UI primitive semantics', () => {
  it('normalizes node semantics with role-based focus defaults', () => {
    const semantics = uiNodeSemantics({
      description: '  Writes changes  ',
      id: 'save-button',
      label: '  Save  ',
      role: 'button'
    });

    expect(semantics).toEqual({
      controlState: {
        disabled: false,
        readOnly: false,
        required: false
      },
      description: 'Writes changes',
      focusState: {
        focusable: true,
        focused: false,
        focusVisible: false
      },
      id: 'save-button',
      inputState: {
        active: false,
        hovered: false,
        pressed: false
      },
      label: 'Save',
      role: 'button'
    });
    expect(isUiFocusable(semantics)).toBe(true);
    expect(isUiActivatable(semantics)).toBe(true);
    expectTypeOf(semantics).toMatchTypeOf<UiNodeSemantics>();
  });

  it('returns immutable-ish normalized shapes', () => {
    const state = uiControlState({
      checked: 'mixed',
      required: true,
      selected: false,
      value: ['alpha', 'beta']
    });
    const semantics = uiNodeSemantics({
      controlState: state,
      focusState: { focused: true },
      id: 'choice',
      role: 'checkbox'
    });

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.value)).toBe(true);
    expect(Object.isFrozen(semantics)).toBe(true);
    expect(Object.isFrozen(semantics.controlState)).toBe(true);
    expect(Object.isFrozen(semantics.focusState)).toBe(true);
    expect(Object.isFrozen(semantics.inputState)).toBe(true);
    expect(semantics.focusState).toEqual({
      focusable: true,
      focused: true,
      focusVisible: false
    });
  });

  it('makes focusability and activatability predicates explicit', () => {
    const text = uiNodeSemantics({ id: 'headline', role: 'text' });
    const disabledButton = uiNodeSemantics({
      controlState: { disabled: true },
      focusState: { focused: true },
      id: 'delete',
      role: 'button'
    });
    const readOnlySwitch = uiNodeSemantics({
      controlState: { checked: true, readOnly: true },
      id: 'sync',
      role: 'switch'
    });
    const textField = uiNodeSemantics({
      controlState: { readOnly: true, value: 'Locked' },
      id: 'name',
      role: 'textbox'
    });

    expect(isUiFocusable(text)).toBe(false);
    expect(isUiActivatable(text)).toBe(false);
    expect(disabledButton.focusState).toMatchObject({
      focusable: false,
      focused: false,
      focusVisible: false
    });
    expect(isUiFocusable(disabledButton)).toBe(false);
    expect(isUiActivatable(disabledButton)).toBe(false);
    expect(isUiFocusable(readOnlySwitch)).toBe(true);
    expect(isUiActivatable(readOnlySwitch)).toBe(false);
    expect(isUiFocusable(textField)).toBe(true);
    expect(isUiActivatable(textField)).toBe(false);
  });

  it('preserves explicit hit region identity on node semantics', () => {
    const region = uiHitRegion({
      bounds: { height: 24, width: 80, x: 4, y: 8 },
      id: 'save-hit',
      targetId: 'save-button'
    });
    const semantics = uiNodeSemantics({
      hitRegion: region,
      id: 'save-button',
      label: 'Save',
      role: 'button'
    });

    expect(region).toEqual({
      bounds: { height: 24, width: 80, x: 4, y: 8 },
      coordinateSpace: 'local',
      id: 'save-hit',
      kind: 'bounds',
      priority: 0,
      targetId: 'save-button'
    });
    expect(Object.isFrozen(region)).toBe(true);
    expect(Object.isFrozen(region.bounds)).toBe(true);
    expect(semantics.hitRegion).toBe(region);
    expectTypeOf(region).toMatchTypeOf<UiHitRegion>();
  });

  it('validates required identity and hit region bounds', () => {
    expect(() => uiNodeSemantics({ id: '   ', role: 'button' })).toThrow('UI id must be a non-empty string');
    expect(() => uiHitRegion({
      bounds: { height: 0, width: 20, x: 0, y: 0 },
      id: 'bad-hit'
    })).toThrow('UI hit bounds height must be a positive finite number');
  });
});

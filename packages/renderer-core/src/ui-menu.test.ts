import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  layoutUiMenuCommands,
  uiMenuCommand,
  uiMenuCommandAt,
  type UiMenuCommand,
  type UiMenuCommandRect,
  type UiMenuLayout
} from './index';

const metrics = {
  commandGap: 2,
  commandHeight: 20,
  paddingX: 6,
  paddingY: 4,
  width: 120
};

const viewport = {
  height: 100,
  width: 160,
  x: 0,
  y: 0
};

describe('UI menu geometry primitives', () => {
  it('normalizes command descriptors', () => {
    const command = uiMenuCommand({
      action: '  copy-selection  ',
      id: '  copy  ',
      label: '  Copy  '
    });

    expect(command).toEqual({
      action: 'copy-selection',
      enabled: true,
      id: 'copy',
      label: 'Copy',
      visible: true
    });
    expect(Object.isFrozen(command)).toBe(true);
    expectTypeOf(command).toEqualTypeOf<UiMenuCommand>();
  });

  it('omits blank optional actions and falls back to command ids for blank labels', () => {
    expect(uiMenuCommand({
      action: '   ',
      id: 'copy',
      label: 'Copy'
    })).toEqual({
      enabled: true,
      id: 'copy',
      label: 'Copy',
      visible: true
    });

    expect(uiMenuCommand({
      id: '  paste  ',
      label: '   '
    })).toEqual({
      enabled: true,
      id: 'paste',
      label: 'paste',
      visible: true
    });
  });

  it('clamps menu bounds near viewport edges', () => {
    const layout = layoutUiMenuCommands({
      anchor: { x: 150, y: 95 },
      bounds: viewport,
      commands: [
        { id: 'copy', label: 'Copy' },
        { id: 'paste', label: 'Paste' },
        { id: 'delete', label: 'Delete' }
      ],
      metrics
    });

    expect(layout.position).toEqual({ x: 40, y: 28 });
    expect(layout.bounds).toEqual({
      height: 72,
      width: 120,
      x: 40,
      y: 28
    });
    expect(layout.commands.map((command) => command.bounds)).toEqual([
      { height: 20, width: 108, x: 46, y: 32 },
      { height: 20, width: 108, x: 46, y: 54 },
      { height: 20, width: 108, x: 46, y: 76 }
    ]);
    expect(Object.isFrozen(layout)).toBe(true);
    expect(Object.isFrozen(layout.commands)).toBe(true);
    expectTypeOf(layout).toEqualTypeOf<UiMenuLayout>();
  });

  it('stacks only visible commands with configured gaps', () => {
    const layout = layoutUiMenuCommands({
      anchor: { x: 10, y: 20 },
      bounds: viewport,
      commands: [
        { id: 'copy', label: 'Copy' },
        { id: 'hidden', label: 'Hidden', visible: false },
        { id: 'paste', label: 'Paste' },
        { id: 'delete', label: 'Delete', enabled: false }
      ],
      metrics
    });

    expect(layout.bounds).toEqual({
      height: 72,
      width: 120,
      x: 10,
      y: 20
    });
    expect(layout.commands.map((command) => command.id)).toEqual(['copy', 'paste', 'delete']);
    expect(layout.commands.map((command) => command.bounds.y)).toEqual([24, 46, 68]);
  });

  it('returns inert layouts for zero and malformed viewport bounds', () => {
    const layout = layoutUiMenuCommands({
      anchor: { x: Number.POSITIVE_INFINITY, y: Number.NaN },
      bounds: {
        height: 0,
        width: Number.NaN,
        x: Number.NEGATIVE_INFINITY,
        y: Number.POSITIVE_INFINITY
      },
      commands: [{ id: 'copy', label: 'Copy' }],
      metrics
    });

    expect(layout.anchor).toEqual({ x: 0, y: 0 });
    expect(layout.position).toEqual({ x: 0, y: 0 });
    expect(layout.bounds).toEqual({
      height: 0,
      width: 0,
      x: 0,
      y: 0
    });
    expect(layout.commands).toEqual([]);
    expect(uiMenuCommandAt(layout.commands, { x: 0, y: 0 })).toBeUndefined();

    const zeroLayout = layoutUiMenuCommands({
      anchor: { x: 12, y: 16 },
      bounds: {
        height: 0,
        width: 160,
        x: 4,
        y: 8
      },
      commands: [{ id: 'copy', label: 'Copy' }],
      metrics
    });

    expect(zeroLayout.position).toEqual({ x: 12, y: 16 });
    expect(zeroLayout.bounds).toEqual({
      height: 0,
      width: 0,
      x: 12,
      y: 16
    });
    expect(zeroLayout.commands).toEqual([]);

    const invalidAnchorLayout = layoutUiMenuCommands({
      anchor: { x: Number.NaN, y: 24 },
      bounds: viewport,
      commands: [{ id: 'copy', label: 'Copy' }],
      metrics
    });

    expect(invalidAnchorLayout.position).toEqual({ x: 0, y: 24 });
    expect(invalidAnchorLayout.bounds).toEqual({
      height: 0,
      width: 0,
      x: 0,
      y: 24
    });
    expect(invalidAnchorLayout.commands).toEqual([]);
  });

  it('does not hit disabled commands', () => {
    const layout = layoutUiMenuCommands({
      anchor: { x: 10, y: 10 },
      bounds: viewport,
      commands: [
        { id: 'copy', label: 'Copy' },
        { id: 'delete', label: 'Delete', enabled: false }
      ],
      metrics
    });

    expect(uiMenuCommandAt(layout.commands, { x: 16, y: 16 })?.id).toBe('copy');
    expect(uiMenuCommandAt(layout.commands, { x: 16, y: 38 })).toBeUndefined();
    expect(layout.commands[1]).toMatchObject({
      enabled: false,
      id: 'delete',
      visible: true
    });
  });

  it('uses inclusive top-left and exclusive bottom-right hit boundaries', () => {
    const rect: UiMenuCommandRect = {
      bounds: { height: 20, width: 80, x: 10, y: 30 },
      enabled: true,
      id: 'copy',
      label: 'Copy',
      visible: true
    };

    expect(uiMenuCommandAt([rect], { x: 10, y: 30 })).toBe(rect);
    expect(uiMenuCommandAt([rect], { x: 89.999, y: 49.999 })).toBe(rect);
    expect(uiMenuCommandAt([rect], { x: 90, y: 30 })).toBeUndefined();
    expect(uiMenuCommandAt([rect], { x: 10, y: 50 })).toBeUndefined();
    expect(uiMenuCommandAt([rect], { x: 9.999, y: 30 })).toBeUndefined();
    expect(uiMenuCommandAt([rect], { x: 10, y: 29.999 })).toBeUndefined();
  });

  it('returns undefined for malformed hit-test points and command bounds', () => {
    const rect: UiMenuCommandRect = {
      bounds: { height: 20, width: 80, x: 10, y: 30 },
      enabled: true,
      id: 'copy',
      label: 'Copy',
      visible: true
    };
    const invalidOriginRect: UiMenuCommandRect = {
      bounds: {
        height: 20,
        width: 80,
        x: Number.POSITIVE_INFINITY,
        y: 30
      },
      enabled: true,
      id: 'paste',
      label: 'Paste',
      visible: true
    };
    const zeroWidthRect: UiMenuCommandRect = {
      bounds: { height: 20, width: 0, x: 0, y: 30 },
      enabled: true,
      id: 'delete',
      label: 'Delete',
      visible: true
    };
    const nonFiniteSizeRect: UiMenuCommandRect = {
      bounds: { height: Number.NaN, width: 80, x: 0, y: 30 },
      enabled: true,
      id: 'rename',
      label: 'Rename',
      visible: true
    };

    expect(uiMenuCommandAt([rect], { x: Number.NaN, y: 30 })).toBeUndefined();
    expect(uiMenuCommandAt([rect], { x: 10, y: Number.POSITIVE_INFINITY })).toBeUndefined();
    expect(uiMenuCommandAt([invalidOriginRect], { x: 0, y: 30 })).toBeUndefined();
    expect(uiMenuCommandAt([zeroWidthRect], { x: 0, y: 30 })).toBeUndefined();
    expect(uiMenuCommandAt([nonFiniteSizeRect], { x: 0, y: 30 })).toBeUndefined();
  });

  it('validates geometry inputs', () => {
    expect(() => uiMenuCommand({ id: '   ', label: 'Copy' })).toThrow(
      'UI menu command id must be a non-empty string'
    );
    expect(() => layoutUiMenuCommands({
      anchor: { x: 0, y: 0 },
      bounds: viewport,
      commands: [{ id: 'copy', label: 'Copy' }],
      metrics: { ...metrics, commandHeight: 0 }
    })).toThrow('UI menu command height must be a positive finite number');
    expect(() => layoutUiMenuCommands({
      anchor: { x: 0, y: 0 },
      bounds: viewport,
      commands: [{ id: 'copy', label: 'Copy' }],
      metrics: { ...metrics, paddingX: 20, width: 40 }
    })).toThrow('UI menu width must be greater than horizontal padding');
  });
});

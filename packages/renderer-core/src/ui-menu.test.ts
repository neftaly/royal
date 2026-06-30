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
      action: 'copy-selection',
      id: 'copy',
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

  it('validates geometry inputs', () => {
    expect(() => uiMenuCommand({ id: '   ', label: 'Copy' })).toThrow(
      'UI menu command id must be a non-empty string'
    );
    expect(() => uiMenuCommand({ id: 'copy', label: '   ' })).toThrow(
      'UI menu command label must be a non-empty string'
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

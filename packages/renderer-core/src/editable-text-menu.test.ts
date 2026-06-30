import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  editableTextClipboardMenuCommands,
  editableTextMenuCommand,
  editableTextMenuCommandAt,
  layoutEditableTextMenu,
  type EditableTextMenuCommand,
  type EditableTextMenuLayout,
} from './editable-text-menu';

const metrics = {
  commandGap: 2,
  commandHeight: 20,
  paddingX: 6,
  paddingY: 4,
  width: 120,
};

const bounds = {
  height: 100,
  width: 160,
  x: 0,
  y: 0,
};

describe('editable text menu helpers', () => {
  it('creates typed clipboard menu commands in text editing order', () => {
    const commands = editableTextClipboardMenuCommands({
      copy: true,
      cut: false,
      paste: false,
    });

    expect(commands).toEqual([
      {
        action: 'cut',
        enabled: false,
        id: 'cut',
        label: 'Cut',
        visible: true,
      },
      {
        action: 'copy',
        enabled: true,
        id: 'copy',
        label: 'Copy',
        visible: true,
      },
      {
        action: 'paste',
        enabled: false,
        id: 'paste',
        label: 'Paste',
        visible: true,
      },
    ]);
    expect(Object.isFrozen(commands[0])).toBe(true);
    expectTypeOf(commands[0]).toEqualTypeOf<EditableTextMenuCommand | undefined>();
  });

  it('clamps menu layout and preserves action ids on command rects', () => {
    const layout = layoutEditableTextMenu({
      anchor: { x: 150, y: 95 },
      bounds,
      commands: editableTextClipboardMenuCommands({
        copy: true,
        cut: true,
        paste: false,
      }),
      metrics,
    });

    expect(layout?.position).toEqual({ x: 40, y: 28 });
    expect(layout?.bounds).toEqual({
      height: 72,
      width: 120,
      x: 40,
      y: 28,
    });
    expect(layout?.commands.map((command) => [command.action, command.bounds.y])).toEqual([
      ['cut', 32],
      ['copy', 54],
      ['paste', 76],
    ]);
    expectTypeOf(layout).toEqualTypeOf<EditableTextMenuLayout | undefined>();
  });

  it('returns undefined when asked to layout a closed menu', () => {
    expect(layoutEditableTextMenu({
      anchor: { x: 10, y: 10 },
      bounds,
      commands: editableTextClipboardMenuCommands({
        copy: true,
        cut: true,
        paste: true,
      }),
      metrics,
      open: false,
    })).toBeUndefined();
  });

  it('hit tests enabled command rects only', () => {
    const layout = layoutEditableTextMenu({
      anchor: { x: 10, y: 10 },
      bounds,
      commands: [
        editableTextMenuCommand({ action: 'copy-selection', label: 'Copy' }),
        editableTextMenuCommand({ action: 'delete-selection', enabled: false, label: 'Delete' }),
      ],
      metrics,
    });

    expect(editableTextMenuCommandAt(layout?.commands ?? [], { x: 16, y: 16 })?.action)
      .toBe('copy-selection');
    expect(editableTextMenuCommandAt(layout?.commands ?? [], { x: 16, y: 38 })).toBeUndefined();
  });
});

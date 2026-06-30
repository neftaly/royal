import { describe, expect, it } from 'vitest';
import { layoutEditableText, type EditableTextSelection } from './editable-text';
import {
  applyEditableTextEditorCommand,
  applyEditableTextEditorKeyInput,
  collapseEditableTextEditorSelection,
  createEditableTextEditorState,
  editableTextEditorCaretSelection,
  editableTextEditorPointerSelection,
  editableTextEditorSelectedRange,
  editableTextEditorSelectedText,
  setEditableTextEditorSelection,
} from './editable-text-editor';

const selection = (
  anchor: number,
  focus = anchor,
  anchorLine?: number,
  focusLine?: number,
): EditableTextSelection => ({
  anchor,
  anchorLine,
  focus,
  focusLine,
});

describe('editable text editor primitive', () => {
  it('creates editor state with clamped selections and exposes selected ranges', () => {
    const state = createEditableTextEditorState({
      selection: selection(99, -5),
      text: 'abcdef',
    });

    expect(createEditableTextEditorState({ text: 'abc' })).toEqual({
      selection: selection(3),
      text: 'abc',
    });
    expect(state).toEqual({
      selection: selection(6, 0),
      text: 'abcdef',
    });
    expect(editableTextEditorSelectedRange(state)).toEqual({
      end: 6,
      endLine: undefined,
      start: 0,
      startLine: undefined,
    });
    expect(editableTextEditorSelectedText(state)).toBe('abcdef');
  });

  it('sets and collapses clamped line-aware selections', () => {
    const layout = layoutEditableText({
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 100,
      text: 'ab\ncd',
    });
    const state = createEditableTextEditorState({
      selection: selection(1, 4, 0, 1),
      text: 'ab\ncd',
    });
    const collapsed = collapseEditableTextEditorSelection(state, 4, layout);

    expect(setEditableTextEditorSelection(state, selection(-10, 99))).toEqual({
      selection: selection(0, 5),
      text: 'ab\ncd',
    });
    expect(collapsed).toEqual({
      selection: selection(4, 4, 1, 1),
      text: 'ab\ncd',
    });
    expect(collapseEditableTextEditorSelection(collapsed, 4, layout)).toBe(collapsed);
  });

  it('applies text commands through the editor state', () => {
    const state = createEditableTextEditorState({
      selection: selection(1, 3),
      text: 'abcd',
    });

    expect(applyEditableTextEditorCommand(state, {
      text: 'X',
      type: 'replace-selection',
    })).toEqual({
      selection: selection(2),
      text: 'aXd',
    });
  });

  it('applies key inputs and returns controller intents for non-text commands', () => {
    const state = createEditableTextEditorState({
      selection: selection(1, 2),
      text: 'abc',
    });
    const insert = applyEditableTextEditorKeyInput(state, { key: 'X' });
    const enter = applyEditableTextEditorKeyInput(state, { key: 'Enter' });
    const multilineEnter = applyEditableTextEditorKeyInput(state, { key: 'Enter' }, {
      mode: 'multiline',
    });
    const copy = applyEditableTextEditorKeyInput(state, { ctrlKey: true, key: 'c' });

    expect(insert).toEqual({
      intent: { text: 'X', type: 'insert-text' },
      state: {
        selection: selection(2),
        text: 'aXc',
      },
    });
    expect(enter).toEqual({
      intent: { type: 'enter-key' },
      state,
    });
    expect(multilineEnter).toEqual({
      intent: { text: '\n', type: 'insert-text' },
      state: {
        selection: selection(2),
        text: 'a\nc',
      },
    });
    expect(copy).toEqual({
      intent: { shortcut: 'copy', type: 'clipboard-shortcut' },
      state,
    });
  });

  it('creates caret and pointer selections from editable text layout', () => {
    const origin = [2, 3, 0] as const;
    const layout = layoutEditableText({
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 100,
      text: 'ab\ncd',
    });
    const state = createEditableTextEditorState({
      selection: selection(1, 1, 0, 0),
      text: 'ab\ncd',
    });

    expect(editableTextEditorCaretSelection({
      index: 4,
      layout,
      state,
    })).toEqual(selection(4, 4, 1, 1));
    expect(editableTextEditorCaretSelection({
      extend: true,
      index: 4,
      layout,
      state,
    })).toEqual(selection(1, 4, 0, 1));
    expect(editableTextEditorPointerSelection({
      layout,
      origin,
      point: { x: origin[0] + 100, y: origin[1] - layout.lineHeight },
      state,
    })).toEqual(selection(5, 5, 1, 1));
    expect(editableTextEditorPointerSelection({
      extend: true,
      layout,
      origin,
      point: { x: origin[0] + 100, y: origin[1] - layout.lineHeight },
      state,
    })).toEqual(selection(1, 5, 0, 1));
  });
});

import { describe, expect, it } from 'vitest';
import {
  editableTextAllSelection,
  editableTextHasSelection,
  editableTextKeyIntent,
  editableTextSelectedRange,
  editableTextSelectedText,
  editableTextSelectionAtCaret,
  editableTextSelectionFromEndpoint,
} from './editable-text-input';
import { layoutEditableText, type EditableTextSelection } from './editable-text';

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

describe('editable text input helpers', () => {
  it('maps printable and composing keys to text input intents', () => {
    expect(editableTextKeyIntent({ key: 'a' })).toEqual({ text: 'a', type: 'insert-text' });
    expect(editableTextKeyIntent({ key: 'A', shiftKey: true })).toEqual({
      text: 'A',
      type: 'insert-text',
    });
    expect(editableTextKeyIntent({ key: '🙂' })).toEqual({ text: '🙂', type: 'insert-text' });
    expect(editableTextKeyIntent({ altKey: true, ctrlKey: true, key: '@' })).toEqual({
      text: '@',
      type: 'insert-text',
    });
    expect(editableTextKeyIntent({ altKey: true, key: 'å' })).toEqual({
      text: 'å',
      type: 'insert-text',
    });
    expect(editableTextKeyIntent({ key: 'Tab' })).toBeUndefined();
    expect(editableTextKeyIntent({ isComposing: true, key: 'a' })).toBeUndefined();
    expect(editableTextKeyIntent({ key: 'Dead' })).toBeUndefined();
    expect(editableTextKeyIntent({ key: 'Process' })).toBeUndefined();
    expect(editableTextKeyIntent({ key: 'a', keyCode: 229 })).toBeUndefined();
  });

  it('maps edit, movement, enter, and shortcut keys to intents', () => {
    expect(editableTextKeyIntent({ key: 'Enter' })).toEqual({ type: 'enter-key' });
    expect(editableTextKeyIntent({ key: 'Enter' }, { mode: 'multiline' })).toEqual({
      text: '\n',
      type: 'insert-text',
    });
    expect(editableTextKeyIntent({ key: 'Backspace' })).toEqual({ type: 'delete-backward' });
    expect(editableTextKeyIntent({ key: 'Delete' })).toEqual({ type: 'delete-forward' });
    expect(editableTextKeyIntent({ key: 'ArrowLeft' })).toEqual({ type: 'move-previous' });
    expect(editableTextKeyIntent({ key: 'ArrowRight', shiftKey: true })).toEqual({
      extend: true,
      type: 'move-next',
    });
    expect(editableTextKeyIntent({ key: 'Home', shiftKey: true })).toEqual({
      extend: true,
      type: 'move-start',
    });
    expect(editableTextKeyIntent({ key: 'End' })).toEqual({ type: 'move-end' });
    expect(editableTextKeyIntent({ ctrlKey: true, key: 'a' })).toEqual({ type: 'select-all' });
    expect(editableTextKeyIntent({ key: 'C', metaKey: true })).toEqual({
      shortcut: 'copy',
      type: 'clipboard-shortcut',
    });
    expect(editableTextKeyIntent({ ctrlKey: true, key: 'b' })).toBeUndefined();
    expect(editableTextKeyIntent({ altKey: true, key: 'ArrowLeft' })).toBeUndefined();
  });

  it('returns clamped selected ranges and selected text', () => {
    expect(editableTextSelectedRange('abcdef', selection(5, 2))).toEqual({
      end: 5,
      endLine: undefined,
      start: 2,
      startLine: undefined,
    });
    expect(editableTextSelectedRange('abc', selection(99, -5))).toEqual({
      end: 3,
      endLine: undefined,
      start: 0,
      startLine: undefined,
    });
    expect(editableTextSelectedText('abcdef', selection(5, 2))).toBe('cde');
    expect(editableTextHasSelection(selection(2, 2))).toBe(false);
    expect(editableTextHasSelection(selection(2, 3))).toBe(true);
  });

  it('builds line-aware select-all and caret selections', () => {
    const layout = layoutEditableText({
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 100,
      text: 'ab\ncd',
    });
    const current = selection(1, 1, 0, 0);

    expect(editableTextAllSelection('ab\ncd', layout)).toEqual(selection(0, 5, 0, 1));
    expect(editableTextSelectionAtCaret({
      current,
      index: 99,
      layout,
      text: 'ab\ncd',
    })).toEqual(selection(5, 5, 1, 1));
    expect(editableTextSelectionAtCaret({
      current,
      extend: true,
      index: 4,
      layout,
      text: 'ab\ncd',
    })).toEqual(selection(1, 4, 0, 1));
    expect(editableTextSelectionFromEndpoint({
      anchor: { index: 1, line: 0 },
      current,
      focus: { index: 4, line: 1 },
    })).toEqual(selection(1, 4, 0, 1));
  });
});

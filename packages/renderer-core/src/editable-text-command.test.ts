import { describe, expect, it } from 'vitest';
import { applyEditableTextCommand, type EditableTextCommandState } from './editable-text-command';

const state = (
  text: string,
  anchor: number,
  focus = anchor,
  anchorLine?: number,
  focusLine?: number,
): EditableTextCommandState => ({
  text,
  selection: {
    anchor,
    anchorLine,
    focus,
    focusLine,
  },
});

describe('editable text command primitive', () => {
  it('inserts text at a collapsed selection and clears implicit line hints', () => {
    expect(applyEditableTextCommand(state('ab', 1, 1, 2, 2), {
      text: 'X',
      type: 'insert-text',
    })).toEqual(state('aXb', 2));
  });

  it('replaces non-collapsed selections in either direction', () => {
    expect(applyEditableTextCommand(state('abcdef', 1, 4), {
      text: 'X',
      type: 'replace-selection',
    })).toEqual(state('aXef', 2));

    expect(applyEditableTextCommand(state('abcdef', 4, 1), {
      text: 'X',
      type: 'replace-selection',
    })).toEqual(state('aXef', 2));
  });

  it('deletes backward and forward across unicode code point boundaries', () => {
    const text = 'A🙂B';

    expect(applyEditableTextCommand(state(text, 3), {
      type: 'delete-backward',
    })).toEqual(state('AB', 1));

    expect(applyEditableTextCommand(state(text, 1), {
      type: 'delete-forward',
    })).toEqual(state('AB', 1));
  });

  it('deletes the selected range before single-character deletion', () => {
    expect(applyEditableTextCommand(state('abcdef', 2, 5), {
      type: 'delete-backward',
    })).toEqual(state('abf', 2));

    expect(applyEditableTextCommand(state('abcdef', 5, 2), {
      type: 'delete-forward',
    })).toEqual(state('abf', 2));
  });

  it('moves across unicode code point boundaries and collapses ranges by direction', () => {
    const text = 'A🙂B';

    expect(applyEditableTextCommand(state(text, 3), {
      type: 'move-previous',
    })).toEqual(state(text, 1));

    expect(applyEditableTextCommand(state(text, 1), {
      type: 'move-next',
    })).toEqual(state(text, 3));

    expect(applyEditableTextCommand(state('abcdef', 1, 4), {
      type: 'move-previous',
    })).toEqual(state('abcdef', 1));

    expect(applyEditableTextCommand(state('abcdef', 1, 4), {
      type: 'move-next',
    })).toEqual(state('abcdef', 4));
  });

  it('extends movement when requested', () => {
    expect(applyEditableTextCommand(state('abcdef', 3), {
      extend: true,
      type: 'move-previous',
    })).toEqual(state('abcdef', 3, 2));

    expect(applyEditableTextCommand(state('abcdef', 3), {
      extend: true,
      type: 'move-start',
    })).toEqual(state('abcdef', 3, 0));

    expect(applyEditableTextCommand(state('abcdef', 3), {
      extend: true,
      type: 'move-end',
    })).toEqual(state('abcdef', 3, 6));
  });

  it('selects all text and supports explicit line hints', () => {
    expect(applyEditableTextCommand(state('abc', 1), {
      type: 'select-all',
    })).toEqual(state('abc', 0, 3));

    expect(applyEditableTextCommand(state('abc', 1), {
      anchorLine: 0,
      focusLine: 2,
      type: 'select-all',
    })).toEqual(state('abc', 0, 3, 0, 2));
  });

  it('applies explicit movement line hints without computing layout hints', () => {
    expect(applyEditableTextCommand(state('abc', 1, 1, 7, 7), {
      focusLine: 4,
      type: 'move-next',
    })).toEqual(state('abc', 2, 2, undefined, 4));
  });

  it('returns the original state for true no-op commands', () => {
    const atStart = state('abc', 0);
    const atEnd = state('abc', 3);
    const emptyInsert = state('abc', 1);

    expect(applyEditableTextCommand(atStart, { type: 'delete-backward' })).toBe(atStart);
    expect(applyEditableTextCommand(atStart, { type: 'move-previous' })).toBe(atStart);
    expect(applyEditableTextCommand(atEnd, { type: 'delete-forward' })).toBe(atEnd);
    expect(applyEditableTextCommand(atEnd, { type: 'move-next' })).toBe(atEnd);
    expect(applyEditableTextCommand(emptyInsert, {
      text: '',
      type: 'insert-text',
    })).toBe(emptyInsert);
  });
});

import {
  clampTextIndex,
  nextTextIndex,
  previousTextIndex,
  sortedEditableTextRange,
  type EditableTextSelection,
} from './editable-text';

export type EditableTextCommandState = {
  readonly text: string;
  readonly selection: EditableTextSelection;
};

export type EditableTextInsertTextCommand = {
  readonly type: 'insert-text';
  readonly text: string;
};

export type EditableTextDeleteBackwardCommand = {
  readonly type: 'delete-backward';
};

export type EditableTextDeleteForwardCommand = {
  readonly type: 'delete-forward';
};

export type EditableTextMovePreviousCommand = {
  readonly type: 'move-previous';
  readonly extend?: boolean;
  readonly anchorLine?: number | undefined;
  readonly focusLine?: number | undefined;
};

export type EditableTextMoveNextCommand = {
  readonly type: 'move-next';
  readonly extend?: boolean;
  readonly anchorLine?: number | undefined;
  readonly focusLine?: number | undefined;
};

export type EditableTextMoveStartCommand = {
  readonly type: 'move-start';
  readonly extend?: boolean;
  readonly anchorLine?: number | undefined;
  readonly focusLine?: number | undefined;
};

export type EditableTextMoveEndCommand = {
  readonly type: 'move-end';
  readonly extend?: boolean;
  readonly anchorLine?: number | undefined;
  readonly focusLine?: number | undefined;
};

export type EditableTextSelectAllCommand = {
  readonly type: 'select-all';
  readonly anchorLine?: number | undefined;
  readonly focusLine?: number | undefined;
};

export type EditableTextReplaceSelectionCommand = {
  readonly type: 'replace-selection';
  readonly text: string;
};

export type EditableTextCommand =
  | EditableTextInsertTextCommand
  | EditableTextDeleteBackwardCommand
  | EditableTextDeleteForwardCommand
  | EditableTextMovePreviousCommand
  | EditableTextMoveNextCommand
  | EditableTextMoveStartCommand
  | EditableTextMoveEndCommand
  | EditableTextSelectAllCommand
  | EditableTextReplaceSelectionCommand;

const selection = (
  anchor: number,
  focus: number,
  anchorLine?: number,
  focusLine?: number,
): EditableTextSelection => ({
  anchor,
  anchorLine,
  focus,
  focusLine,
});

const normalizedSelection = (
  text: string,
  current: EditableTextSelection,
): EditableTextSelection =>
  selection(
    clampTextIndex(text, current.anchor),
    clampTextIndex(text, current.focus),
    current.anchorLine,
    current.focusLine,
  );

const sameSelection = (
  left: EditableTextSelection,
  right: EditableTextSelection,
): boolean =>
  left.anchor === right.anchor &&
  left.anchorLine === right.anchorLine &&
  left.focus === right.focus &&
  left.focusLine === right.focusLine;

const nextState = (
  state: EditableTextCommandState,
  text: string,
  nextSelection: EditableTextSelection,
): EditableTextCommandState =>
  state.text === text && sameSelection(state.selection, nextSelection)
    ? state
    : { text, selection: nextSelection };

const replaceSelection = (
  state: EditableTextCommandState,
  insertText: string,
): EditableTextCommandState => {
  const currentSelection = normalizedSelection(state.text, state.selection);
  const range = sortedEditableTextRange(currentSelection);
  const text = `${state.text.slice(0, range.start)}${insertText}${state.text.slice(range.end)}`;
  const caret = clampTextIndex(text, range.start + insertText.length);
  return nextState(state, text, selection(caret, caret));
};

const moveCaret = (
  state: EditableTextCommandState,
  focus: number,
  extend: boolean | undefined,
  anchorLine?: number,
  focusLine?: number,
): EditableTextCommandState => {
  const currentSelection = normalizedSelection(state.text, state.selection);
  const nextFocus = clampTextIndex(state.text, focus);
  const nextSelection = extend === true
    ? selection(currentSelection.anchor, nextFocus, anchorLine, focusLine)
    : selection(nextFocus, nextFocus, anchorLine, focusLine);

  return nextState(state, state.text, nextSelection);
};

export const applyEditableTextCommand = (
  state: EditableTextCommandState,
  command: EditableTextCommand,
): EditableTextCommandState => {
  const currentSelection = normalizedSelection(state.text, state.selection);
  const range = sortedEditableTextRange(currentSelection);
  const hasSelection = range.start !== range.end;

  switch (command.type) {
    case 'insert-text':
    case 'replace-selection':
      return replaceSelection(state, command.text);
    case 'delete-backward': {
      if (hasSelection) return replaceSelection(state, '');
      const start = previousTextIndex(state.text, currentSelection.focus);
      if (start === currentSelection.focus) return nextState(state, state.text, selection(start, start));
      const text = `${state.text.slice(0, start)}${state.text.slice(currentSelection.focus)}`;
      return nextState(state, text, selection(start, start));
    }
    case 'delete-forward': {
      if (hasSelection) return replaceSelection(state, '');
      const end = nextTextIndex(state.text, currentSelection.focus);
      if (end === currentSelection.focus) return nextState(state, state.text, selection(end, end));
      const text = `${state.text.slice(0, currentSelection.focus)}${state.text.slice(end)}`;
      return nextState(state, text, selection(currentSelection.focus, currentSelection.focus));
    }
    case 'move-previous': {
      const focus = command.extend === true || !hasSelection
        ? previousTextIndex(state.text, currentSelection.focus)
        : range.start;
      return moveCaret(state, focus, command.extend, command.anchorLine, command.focusLine);
    }
    case 'move-next': {
      const focus = command.extend === true || !hasSelection
        ? nextTextIndex(state.text, currentSelection.focus)
        : range.end;
      return moveCaret(state, focus, command.extend, command.anchorLine, command.focusLine);
    }
    case 'move-start':
      return moveCaret(state, 0, command.extend, command.anchorLine, command.focusLine);
    case 'move-end':
      return moveCaret(state, state.text.length, command.extend, command.anchorLine, command.focusLine);
    case 'select-all':
      return nextState(state, state.text, selection(0, state.text.length, command.anchorLine, command.focusLine));
  }
};

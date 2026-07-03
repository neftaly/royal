import type { EditableTextCommand } from './command';
import {
  clampTextIndex,
  editableTextCaretPlacement,
  sortedEditableTextRange,
  type EditableTextCaretEndpoint,
  type EditableTextLayout,
  type EditableTextRange,
  type EditableTextSelection,
} from './model';

export type EditableTextInputMode = 'single-line' | 'multiline';

export type EditableTextClipboardShortcut = 'copy' | 'cut' | 'paste';

export type EditableTextClipboardShortcutIntent = {
  readonly type: 'clipboard-shortcut';
  readonly shortcut: EditableTextClipboardShortcut;
};

export type EditableTextEnterKeyIntent = {
  readonly type: 'enter-key';
};

export type EditableTextKeyIntent =
  | EditableTextCommand
  | EditableTextClipboardShortcutIntent
  | EditableTextEnterKeyIntent;

export interface EditableTextKeyInput {
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly isComposing?: boolean;
  readonly key: string;
  readonly keyCode?: number;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export interface EditableTextKeyIntentOptions {
  readonly mode?: EditableTextInputMode;
}

export interface EditableTextCaretSelectionOptions {
  readonly current: EditableTextSelection;
  readonly extend?: boolean;
  readonly index: number;
  readonly layout?: EditableTextLayout;
  readonly text: string;
}

export interface EditableTextEndpointSelectionOptions {
  readonly anchor?: EditableTextCaretEndpoint;
  readonly current: EditableTextSelection;
  readonly extend?: boolean;
  readonly focus: EditableTextCaretEndpoint;
}

const isComposingKey = (input: EditableTextKeyInput): boolean =>
  input.isComposing === true ||
  input.key === 'Dead' ||
  input.key === 'Process' ||
  input.keyCode === 229;

const isPrintableKey = (key: string): boolean => {
  const codePoint = key.codePointAt(0);
  return codePoint !== undefined &&
    Array.from(key).length === 1 &&
    codePoint >= 0x20 &&
    codePoint !== 0x7f;
};

const movePreviousCommand = (extend: boolean): EditableTextCommand =>
  extend ? { extend: true, type: 'move-previous' } : { type: 'move-previous' };

const moveNextCommand = (extend: boolean): EditableTextCommand =>
  extend ? { extend: true, type: 'move-next' } : { type: 'move-next' };

const moveStartCommand = (extend: boolean): EditableTextCommand =>
  extend ? { extend: true, type: 'move-start' } : { type: 'move-start' };

const moveEndCommand = (extend: boolean): EditableTextCommand =>
  extend ? { extend: true, type: 'move-end' } : { type: 'move-end' };

const shortcutIntent = (key: string): EditableTextKeyIntent | undefined => {
  switch (key.toLowerCase()) {
    case 'a':
      return { type: 'select-all' };
    case 'c':
      return { shortcut: 'copy', type: 'clipboard-shortcut' };
    case 'x':
      return { shortcut: 'cut', type: 'clipboard-shortcut' };
    case 'v':
      return { shortcut: 'paste', type: 'clipboard-shortcut' };
    default:
      return undefined;
  }
};

export const editableTextKeyIntent = (
  input: EditableTextKeyInput,
  options?: EditableTextKeyIntentOptions,
): EditableTextKeyIntent | undefined => {
  if (isComposingKey(input)) return undefined;

  const altKey = input.altKey === true;
  const ctrlKey = input.ctrlKey === true;
  const metaKey = input.metaKey === true;
  const shortcutKey = ctrlKey || metaKey;
  const printableKey = isPrintableKey(input.key);

  if (shortcutKey && !altKey) return shortcutIntent(input.key);
  if (altKey && !metaKey && printableKey) return { text: input.key, type: 'insert-text' };
  if (altKey || ctrlKey || metaKey) return undefined;

  const extend = input.shiftKey === true;

  switch (input.key) {
    case 'Enter':
      return options?.mode === 'multiline'
        ? { text: '\n', type: 'insert-text' }
        : { type: 'enter-key' };
    case 'Backspace':
      return { type: 'delete-backward' };
    case 'Delete':
      return { type: 'delete-forward' };
    case 'ArrowLeft':
      return movePreviousCommand(extend);
    case 'ArrowRight':
      return moveNextCommand(extend);
    case 'ArrowUp':
    case 'Home':
      return moveStartCommand(extend);
    case 'ArrowDown':
    case 'End':
      return moveEndCommand(extend);
    default:
      return printableKey ? { text: input.key, type: 'insert-text' } : undefined;
  }
};

export const clampEditableTextSelection = (
  text: string,
  selection: EditableTextSelection,
): EditableTextSelection => ({
  anchor: clampTextIndex(text, selection.anchor),
  anchorLine: selection.anchorLine,
  focus: clampTextIndex(text, selection.focus),
  focusLine: selection.focusLine,
});

export const editableTextSelectedRange = (
  text: string,
  selection: EditableTextSelection,
): EditableTextRange => sortedEditableTextRange(clampEditableTextSelection(text, selection));

export const editableTextSelectedText = (
  text: string,
  selection: EditableTextSelection,
): string => {
  const range = editableTextSelectedRange(text, selection);
  return text.slice(range.start, range.end);
};

export const editableTextHasSelection = (selection: EditableTextSelection): boolean =>
  selection.anchor !== selection.focus;

export const editableTextAllSelection = (
  text: string,
  layout?: EditableTextLayout,
): EditableTextSelection => ({
  anchor: 0,
  anchorLine: layout === undefined ? undefined : editableTextCaretPlacement(layout, 0)?.line,
  focus: text.length,
  focusLine: layout === undefined ? undefined : editableTextCaretPlacement(layout, text.length)?.line,
});

export const editableTextSelectionAtCaret = ({
  current,
  extend,
  index,
  layout,
  text,
}: EditableTextCaretSelectionOptions): EditableTextSelection => {
  const nextIndex = clampTextIndex(text, index);
  const placement = layout === undefined
    ? undefined
    : editableTextCaretPlacement(layout, nextIndex, current.focusLine);
  const line = placement?.line;

  return {
    anchor: extend === true ? clampTextIndex(text, current.anchor) : nextIndex,
    anchorLine: extend === true ? current.anchorLine : line,
    focus: nextIndex,
    focusLine: line,
  };
};

export const editableTextSelectionFromEndpoint = ({
  anchor,
  current,
  extend,
  focus,
}: EditableTextEndpointSelectionOptions): EditableTextSelection => ({
  anchor: anchor?.index ?? (extend === true ? current.anchor : focus.index),
  anchorLine: anchor?.line ?? (extend === true ? current.anchorLine : focus.line),
  focus: focus.index,
  focusLine: focus.line,
});

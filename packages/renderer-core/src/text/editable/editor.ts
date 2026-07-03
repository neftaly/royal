import {
  applyEditableTextCommand,
  type EditableTextCommand,
  type EditableTextCommandState,
} from './command';
import {
  editableTextCaretPlacement,
  nearestEditableTextCaret,
  sameEditableTextSelection,
  type EditableTextHitPoint,
  type EditableTextLayout,
  type EditableTextRange,
  type EditableTextSelection,
} from './model';
import {
  clampEditableTextSelection,
  editableTextKeyIntent,
  editableTextSelectedRange,
  editableTextSelectedText,
  editableTextSelectionAtCaret,
  editableTextSelectionFromEndpoint,
  type EditableTextKeyInput,
  type EditableTextKeyIntent,
  type EditableTextKeyIntentOptions,
} from './input';
import type { Vec3 } from '../../primitives';

export type EditableTextEditorState = EditableTextCommandState;

export interface EditableTextEditorStateOptions {
  readonly selection?: EditableTextSelection;
  readonly text?: string;
}

export interface EditableTextEditorKeyInputResult {
  readonly intent: EditableTextKeyIntent | undefined;
  readonly state: EditableTextEditorState;
}

export interface EditableTextEditorCaretSelectionOptions {
  readonly extend?: boolean;
  readonly index: number;
  readonly layout?: EditableTextLayout;
  readonly state: EditableTextEditorState;
}

export interface EditableTextEditorPointerSelectionOptions {
  readonly extend?: boolean;
  readonly layout: EditableTextLayout;
  readonly origin: Vec3;
  readonly point: EditableTextHitPoint;
  readonly state: EditableTextEditorState;
}

export interface EditableTextEditorContextMenuSelectionOptions {
  readonly layout: EditableTextLayout;
  readonly origin: Vec3;
  readonly point: EditableTextHitPoint;
  readonly state: EditableTextEditorState;
}

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

const nextState = (
  state: EditableTextEditorState,
  selection: EditableTextSelection,
): EditableTextEditorState =>
  sameEditableTextSelection(state.selection, selection)
    ? state
    : { text: state.text, selection };

const isEditableTextCommand = (intent: EditableTextKeyIntent): intent is EditableTextCommand =>
  intent.type !== 'clipboard-shortcut' && intent.type !== 'enter-key';

export const createEditableTextEditorState = ({
  selection: inputSelection,
  text = '',
}: EditableTextEditorStateOptions = {}): EditableTextEditorState => {
  const defaultSelection = selection(text.length);
  return {
    text,
    selection: clampEditableTextSelection(text, inputSelection ?? defaultSelection),
  };
};

export const setEditableTextEditorSelection = (
  state: EditableTextEditorState,
  inputSelection: EditableTextSelection,
): EditableTextEditorState =>
  nextState(state, clampEditableTextSelection(state.text, inputSelection));

export const collapseEditableTextEditorSelection = (
  state: EditableTextEditorState,
  index = state.selection.focus,
  layout?: EditableTextLayout,
): EditableTextEditorState => {
  const selection = editableTextSelectionAtCaret({
    current: state.selection,
    index,
    ...(layout === undefined ? {} : { layout }),
    text: state.text,
  });
  return nextState(state, selection);
};

export const editableTextEditorSelectedRange = (
  state: EditableTextEditorState,
): EditableTextRange => editableTextSelectedRange(state.text, state.selection);

export const editableTextEditorSelectedText = (
  state: EditableTextEditorState,
): string => editableTextSelectedText(state.text, state.selection);

export const applyEditableTextEditorCommand = (
  state: EditableTextEditorState,
  command: EditableTextCommand,
): EditableTextEditorState => applyEditableTextCommand(state, command);

export const pasteEditableTextEditorText = (
  state: EditableTextEditorState,
  text: string,
): EditableTextEditorState =>
  applyEditableTextEditorCommand(state, { text, type: 'replace-selection' });

export const applyEditableTextEditorKeyInput = (
  state: EditableTextEditorState,
  input: EditableTextKeyInput,
  options?: EditableTextKeyIntentOptions,
): EditableTextEditorKeyInputResult => {
  const intent = editableTextKeyIntent(input, options);
  if (intent === undefined || !isEditableTextCommand(intent)) return { intent, state };
  return {
    intent,
    state: applyEditableTextEditorCommand(state, intent),
  };
};

export const editableTextEditorCaretSelection = ({
  extend,
  index,
  layout,
  state,
}: EditableTextEditorCaretSelectionOptions): EditableTextSelection =>
  editableTextSelectionAtCaret({
    current: state.selection,
    ...(extend === undefined ? {} : { extend }),
    index,
    ...(layout === undefined ? {} : { layout }),
    text: state.text,
  });

export const editableTextEditorPointerSelection = ({
  extend,
  layout,
  origin,
  point,
  state,
}: EditableTextEditorPointerSelectionOptions): EditableTextSelection => {
  const focus = nearestEditableTextCaret(layout, point, origin);
  const anchor = extend === true
    ? editableTextCaretPlacement(layout, state.selection.anchor, state.selection.anchorLine)
    : undefined;

  return clampEditableTextSelection(state.text, editableTextSelectionFromEndpoint({
    ...(anchor === undefined ? {} : { anchor }),
    current: state.selection,
    ...(extend === undefined ? {} : { extend }),
    focus,
  }));
};

export const editableTextEditorContextMenuSelection = ({
  layout,
  origin,
  point,
  state,
}: EditableTextEditorContextMenuSelectionOptions): EditableTextSelection => {
  const focus = nearestEditableTextCaret(layout, point, origin);
  const range = editableTextSelectedRange(state.text, state.selection);
  const hasSelection = range.start !== range.end;

  if (hasSelection && focus.index >= range.start && focus.index <= range.end) {
    return state.selection;
  }

  return clampEditableTextSelection(state.text, editableTextSelectionFromEndpoint({
    current: state.selection,
    focus,
  }));
};

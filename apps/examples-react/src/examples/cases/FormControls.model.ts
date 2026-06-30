import {
  applyEditableTextCommand,
  layoutEditableText,
  nearestEditableTextCaret,
  type EditableTextCommand,
  type EditableTextSelection,
  type TextFontFace,
  type UiNodeSemantics,
  uiNodeSemantics,
} from '@royal/renderer-core';

export type EditableTextMode = 'single-line' | 'multiline';
export type EditableTextControlId = 'title' | 'notes';
export type FormControlId = EditableTextControlId | 'updates' | 'send';

export type EditableTextControlModel = {
  readonly id: EditableTextControlId;
  readonly label: string;
  readonly maxLength: number;
  readonly mode: EditableTextMode;
  readonly placeholder: string;
  readonly selection: EditableTextSelection;
  readonly value: string;
};

export type ToggleControlModel = {
  readonly checked: boolean;
  readonly id: 'updates';
  readonly label: string;
};

export type ActionButtonControlModel = {
  readonly id: 'send';
  readonly label: string;
  readonly pressCount: number;
};

export type CanvasFormModel = {
  readonly activeTextId: EditableTextControlId | undefined;
  readonly button: ActionButtonControlModel;
  readonly checkbox: ToggleControlModel;
  readonly focusedId: FormControlId | undefined;
  readonly semantics: Readonly<Record<FormControlId, UiNodeSemantics>>;
  readonly textControls: readonly [EditableTextControlModel, EditableTextControlModel];
};

export type FormControlsWorldPoint = {
  readonly x: number;
  readonly y: number;
};

export type FormControlsHit =
  | { readonly id: EditableTextControlId; readonly type: 'editable-text' }
  | { readonly id: 'updates'; readonly type: 'checkbox' }
  | { readonly id: 'send'; readonly type: 'button' };

export type FormControlsAction =
  | {
    readonly id: EditableTextControlId;
    readonly selection: EditableTextSelection;
    readonly type: 'focus-text';
  }
  | { readonly command: EditableTextCommand; readonly type: 'edit-active-text' }
  | { readonly type: 'toggle-checkbox' }
  | { readonly type: 'press-button' }
  | { readonly type: 'blur' };

export const formControlsCameraBounds = {
  bottom: -3.4,
  left: -5.3,
  right: 5.3,
  top: 3.4,
} as const;

export const formControlsTextMetrics = {
  fontSize: 0.22,
  lineHeight: 0.32,
} as const;

export const formControlsLayout = {
  button: {
    height: 0.56,
    width: 1.38,
    x: 2.24,
    y: -1.64,
  },
  checkbox: {
    height: 0.5,
    width: 3.1,
    x: -3.62,
    y: -1.62,
  },
  fields: {
    notes: {
      height: 1.64,
      textMaxWidth: 6.86,
      textOrigin: [-3.4, 0.84, 0.12],
      width: 7.24,
      x: -3.62,
      y: 1.12,
    },
    title: {
      height: 0.74,
      textMaxWidth: 6.86,
      textOrigin: [-3.4, 2.38, 0.12],
      width: 7.24,
      x: -3.62,
      y: 2.66,
    },
  },
} as const;

const collapsedSelection = (index: number, line?: number): EditableTextSelection => ({
  anchor: index,
  anchorLine: line,
  focus: index,
  focusLine: line,
});

export const createEditableTextControl = (
  options: Omit<EditableTextControlModel, 'selection'> & {
    readonly selection?: EditableTextSelection;
  },
): EditableTextControlModel => ({
  ...options,
  selection: options.selection ?? collapsedSelection(options.value.length),
});

const initialTextControls: readonly [EditableTextControlModel, EditableTextControlModel] = [
  createEditableTextControl({
    id: 'title',
    label: 'Title',
    maxLength: 64,
    mode: 'single-line',
    placeholder: 'Untitled canvas note',
    value: 'Canvas form slice',
  }),
  createEditableTextControl({
    id: 'notes',
    label: 'Notes',
    maxLength: 240,
    mode: 'multiline',
    placeholder: 'Add notes',
    value: 'Pointer focus and keyboard edits are handled by the canvas host.',
  }),
];

const createSemantics = (
  model: Omit<CanvasFormModel, 'semantics'>,
): Readonly<Record<FormControlId, UiNodeSemantics>> => {
  const [title, notes] = model.textControls;

  return {
    notes: uiNodeSemantics({
      controlState: { value: notes.value },
      focusState: { focusable: true, focused: model.focusedId === 'notes', tabIndex: 0 },
      id: 'notes',
      label: notes.label,
      role: 'textbox',
    }),
    send: uiNodeSemantics({
      controlState: { value: model.button.pressCount },
      focusState: { focusable: true, focused: model.focusedId === 'send', tabIndex: 0 },
      id: 'send',
      label: model.button.label,
      role: 'button',
    }),
    title: uiNodeSemantics({
      controlState: { value: title.value },
      focusState: { focusable: true, focused: model.focusedId === 'title', tabIndex: 0 },
      id: 'title',
      label: title.label,
      role: 'textbox',
    }),
    updates: uiNodeSemantics({
      controlState: { checked: model.checkbox.checked },
      focusState: { focusable: true, focused: model.focusedId === 'updates', tabIndex: 0 },
      id: 'updates',
      label: model.checkbox.label,
      role: 'checkbox',
    }),
  };
};

const withSemantics = (
  model: Omit<CanvasFormModel, 'semantics'>,
): CanvasFormModel => ({
  ...model,
  semantics: createSemantics(model),
});

export const formControlsModel: CanvasFormModel = withSemantics({
  activeTextId: undefined,
  button: {
    id: 'send',
    label: 'Send',
    pressCount: 0,
  },
  checkbox: {
    checked: false,
    id: 'updates',
    label: 'Enable updates',
  },
  focusedId: undefined,
  textControls: initialTextControls,
});

export const editableTextControlForId = (
  model: CanvasFormModel,
  id: EditableTextControlId,
): EditableTextControlModel => {
  const control = model.textControls.find((candidate) => candidate.id === id);
  if (control === undefined) throw new Error(`Unknown text control: ${id}`);
  return control;
};

export const activeEditableTextControl = (
  model: CanvasFormModel,
): EditableTextControlModel | undefined =>
  model.activeTextId === undefined
    ? undefined
    : editableTextControlForId(model, model.activeTextId);

const isInside = (
  point: FormControlsWorldPoint,
  bounds: { readonly height: number; readonly width: number; readonly x: number; readonly y: number },
): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y <= bounds.y &&
  point.y >= bounds.y - bounds.height;

export const hitTestFormControls = (point: FormControlsWorldPoint): FormControlsHit | undefined => {
  if (isInside(point, formControlsLayout.fields.title)) return { id: 'title', type: 'editable-text' };
  if (isInside(point, formControlsLayout.fields.notes)) return { id: 'notes', type: 'editable-text' };
  if (isInside(point, formControlsLayout.checkbox)) return { id: 'updates', type: 'checkbox' };
  if (isInside(point, formControlsLayout.button)) return { id: 'send', type: 'button' };
  return undefined;
};

const displayTextForMode = (value: string, mode: EditableTextMode): string =>
  mode === 'single-line' ? value.replace(/[\r\n]/g, ' ') : value.replace(/\r\n?/g, '\n');

const maxWidthForMode = (maxWidth: number, mode: EditableTextMode): number =>
  mode === 'single-line' ? Number.POSITIVE_INFINITY : maxWidth;

const limitText = (value: string, maxLength: number): string =>
  Array.from(value).slice(0, maxLength).join('');

const normalizeSelection = (
  value: string,
  selection: EditableTextSelection,
): EditableTextSelection => {
  const clamp = (index: number): number => Math.max(0, Math.min(value.length, index));

  return {
    anchor: clamp(selection.anchor),
    anchorLine: selection.anchorLine,
    focus: clamp(selection.focus),
    focusLine: selection.focusLine,
  };
};

export const caretSelectionAtFormPoint = (
  control: EditableTextControlModel,
  font: TextFontFace | undefined,
  point: FormControlsWorldPoint,
): EditableTextSelection => {
  const field = formControlsLayout.fields[control.id];
  const layout = layoutEditableText({
    ...(font === undefined ? {} : { font }),
    fontSize: formControlsTextMetrics.fontSize,
    lineHeight: formControlsTextMetrics.lineHeight,
    maxWidth: maxWidthForMode(field.textMaxWidth, control.mode),
    text: displayTextForMode(control.value, control.mode),
  });
  const placement = nearestEditableTextCaret(layout, point, field.textOrigin);

  return collapsedSelection(placement.index, placement.line);
};

const replaceTextControl = (
  controls: readonly [EditableTextControlModel, EditableTextControlModel],
  nextControl: EditableTextControlModel,
): readonly [EditableTextControlModel, EditableTextControlModel] => {
  const [first, second] = controls;
  return first.id === nextControl.id ? [nextControl, second] : [first, nextControl];
};

const editTextControl = (
  control: EditableTextControlModel,
  command: EditableTextCommand,
): EditableTextControlModel => {
  const next = applyEditableTextCommand({
    selection: control.selection,
    text: control.value,
  }, command);
  const value = limitText(displayTextForMode(next.text, control.mode), control.maxLength);

  return {
    ...control,
    selection: normalizeSelection(value, next.selection),
    value,
  };
};

export const formControlsReducer = (
  model: CanvasFormModel,
  action: FormControlsAction,
): CanvasFormModel => {
  switch (action.type) {
    case 'focus-text': {
      const control = editableTextControlForId(model, action.id);
      return withSemantics({
        ...model,
        activeTextId: action.id,
        focusedId: action.id,
        textControls: replaceTextControl(model.textControls, {
          ...control,
          selection: normalizeSelection(control.value, action.selection),
        }),
      });
    }
    case 'edit-active-text': {
      const control = activeEditableTextControl(model);
      if (control === undefined) return model;
      return withSemantics({
        ...model,
        textControls: replaceTextControl(model.textControls, editTextControl(control, action.command)),
      });
    }
    case 'toggle-checkbox':
      return withSemantics({
        ...model,
        activeTextId: undefined,
        checkbox: { ...model.checkbox, checked: !model.checkbox.checked },
        focusedId: 'updates',
      });
    case 'press-button':
      return withSemantics({
        ...model,
        activeTextId: undefined,
        button: { ...model.button, pressCount: model.button.pressCount + 1 },
        focusedId: 'send',
      });
    case 'blur':
      return withSemantics({
        ...model,
        activeTextId: undefined,
        focusedId: undefined,
      });
  }
};

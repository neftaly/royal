import {
  applyEditableTextCommand,
  isUiActivatable,
  isUiFocusable,
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

export type FormControlsFocusDirection = 'backward' | 'forward';

export type FormControlsKeyboardInput = {
  readonly key: string;
  readonly shiftKey?: boolean;
};

export type FormControlsAction =
  | {
    readonly id: EditableTextControlId;
    readonly selection: EditableTextSelection;
    readonly type: 'focus-text';
  }
  | { readonly id: FormControlId; readonly type: 'focus-control' }
  | { readonly direction: FormControlsFocusDirection; readonly type: 'focus-adjacent-control' }
  | { readonly type: 'focus-initial-control' }
  | { readonly type: 'activate-focused-control' }
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
  form: {
    height: 5.72,
    width: 8.1,
    x: -4.05,
    y: 3.2,
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
  heading: {
    height: 0.48,
    width: 7.24,
    x: -3.62,
    y: 3.1,
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
    value: '',
  }),
  createEditableTextControl({
    id: 'notes',
    label: 'Notes',
    maxLength: 240,
    mode: 'multiline',
    value: '',
  }),
];

const formControlFocusOrder = ['title', 'notes', 'updates', 'send'] as const satisfies readonly FormControlId[];

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
    label: 'Submit',
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

const isEditableTextControlId = (id: FormControlId): id is EditableTextControlId =>
  id === 'title' || id === 'notes';

const focusControl = (
  model: CanvasFormModel,
  id: FormControlId,
): CanvasFormModel => {
  if (!isUiFocusable(model.semantics[id])) return model;

  return withSemantics({
    ...model,
    activeTextId: isEditableTextControlId(id) ? id : undefined,
    focusedId: id,
  });
};

const focusAdjacentControl = (
  model: CanvasFormModel,
  direction: FormControlsFocusDirection,
): CanvasFormModel => {
  const focusableIds = formControlFocusOrder.filter((id) => isUiFocusable(model.semantics[id]));
  if (focusableIds.length === 0) {
    return withSemantics({
      ...model,
      activeTextId: undefined,
      focusedId: undefined,
    });
  }

  const currentIndex = model.focusedId === undefined
    ? -1
    : focusableIds.indexOf(model.focusedId);
  const fallbackIndex = direction === 'forward' ? 0 : focusableIds.length - 1;
  const nextIndex = currentIndex === -1
    ? fallbackIndex
    : (currentIndex + (direction === 'forward' ? 1 : -1) + focusableIds.length) % focusableIds.length;
  const nextId = focusableIds[nextIndex];

  return nextId === undefined ? model : focusControl(model, nextId);
};

const toggleCheckbox = (model: CanvasFormModel): CanvasFormModel =>
  withSemantics({
    ...model,
    activeTextId: undefined,
    checkbox: { ...model.checkbox, checked: !model.checkbox.checked },
    focusedId: 'updates',
  });

const pressButton = (model: CanvasFormModel): CanvasFormModel =>
  withSemantics({
    ...model,
    activeTextId: undefined,
    button: { ...model.button, pressCount: model.button.pressCount + 1 },
    focusedId: 'send',
  });

const activateControl = (
  model: CanvasFormModel,
  id: FormControlId,
): CanvasFormModel => {
  const focused = focusControl(model, id);
  if (!isUiActivatable(model.semantics[id])) return focused;

  switch (id) {
    case 'updates':
      return toggleCheckbox(focused);
    case 'send':
      return pressButton(focused);
    case 'notes':
    case 'title':
      return focused;
  }
};

const isSpaceKey = (key: string): boolean =>
  key === ' ' || key === 'Spacebar';

export const formControlsKeyboardAction = (
  model: CanvasFormModel,
  input: FormControlsKeyboardInput,
): FormControlsAction | undefined => {
  if (input.key === 'Tab') {
    return {
      direction: input.shiftKey === true ? 'backward' : 'forward',
      type: 'focus-adjacent-control',
    };
  }

  if (model.activeTextId !== undefined || model.focusedId === undefined) return undefined;

  const focused = model.semantics[model.focusedId];
  if (focused.role === 'button' && (input.key === 'Enter' || isSpaceKey(input.key))) {
    return { type: 'activate-focused-control' };
  }
  if (focused.role === 'checkbox' && isSpaceKey(input.key)) {
    return { type: 'activate-focused-control' };
  }

  return undefined;
};

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
      if (!isUiFocusable(model.semantics[action.id])) return model;
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
    case 'focus-control':
      return focusControl(model, action.id);
    case 'focus-adjacent-control':
      return focusAdjacentControl(model, action.direction);
    case 'focus-initial-control':
      return model.focusedId === undefined
        ? focusAdjacentControl(model, 'forward')
        : model;
    case 'activate-focused-control':
      return model.focusedId === undefined
        ? model
        : activateControl(model, model.focusedId);
    case 'edit-active-text': {
      const control = activeEditableTextControl(model);
      if (control === undefined) return model;
      return withSemantics({
        ...model,
        textControls: replaceTextControl(model.textControls, editTextControl(control, action.command)),
      });
    }
    case 'toggle-checkbox':
      return activateControl(model, 'updates');
    case 'press-button':
      return activateControl(model, 'send');
    case 'blur':
      return withSemantics({
        ...model,
        activeTextId: undefined,
        focusedId: undefined,
      });
  }
};

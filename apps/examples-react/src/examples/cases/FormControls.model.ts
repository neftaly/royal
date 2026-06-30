import { type EditableTextSelection, type UiNodeSemantics, uiNodeSemantics } from '@royal/renderer-core';

export type EditableTextMode = 'single-line' | 'multiline';

export type EditableTextControlModel = {
  readonly id: string;
  readonly label: string;
  readonly maxLength: number;
  readonly mode: EditableTextMode;
  readonly placeholder: string;
  readonly selection: EditableTextSelection;
  readonly value: string;
};

export type ToggleControlModel = {
  readonly checked: boolean;
  readonly id: string;
  readonly label: string;
};

export type RadioOptionModel = {
  readonly id: string;
  readonly label: string;
};

export type RadioGroupControlModel = {
  readonly id: string;
  readonly label: string;
  readonly options: readonly RadioOptionModel[];
  readonly value: string;
};

export type ListboxOptionModel = {
  readonly id: string;
  readonly label: string;
};

export type ListboxControlModel = {
  readonly id: string;
  readonly label: string;
  readonly options: readonly ListboxOptionModel[];
  readonly value: string;
};

export type RangeControlModel = {
  readonly id: string;
  readonly label: string;
  readonly max: number;
  readonly min: number;
  readonly step: number;
  readonly value: number;
};

export type ColorSwatchControlModel = {
  readonly id: string;
  readonly label: string;
  readonly palette: readonly string[];
  readonly value: string;
};

export type FileCommandControlModel = {
  readonly accepted: readonly string[];
  readonly command: 'browser.filePicker.request';
  readonly id: string;
  readonly label: string;
  readonly value: string;
};

export type ButtonControlModel = {
  readonly action: 'submit' | 'reset';
  readonly id: string;
  readonly label: string;
  readonly tone: 'primary' | 'secondary';
};

export type CanvasFormModel = {
  readonly buttons: readonly ButtonControlModel[];
  readonly checkbox: ToggleControlModel;
  readonly color: ColorSwatchControlModel;
  readonly date: EditableTextControlModel;
  readonly file: FileCommandControlModel;
  readonly listbox: ListboxControlModel;
  readonly radio: RadioGroupControlModel;
  readonly range: RangeControlModel;
  readonly semantics: Readonly<Record<string, UiNodeSemantics>>;
  readonly textControls: readonly [EditableTextControlModel, EditableTextControlModel];
  readonly time: EditableTextControlModel;
};

const sharedTextSelection = (value: string): EditableTextSelection => ({
  anchor: value.length,
  anchorLine: undefined,
  focus: value.length,
  focusLine: undefined,
});

const textSelection = (anchor: number, focus: number): EditableTextSelection => ({
  anchor,
  anchorLine: undefined,
  focus,
  focusLine: undefined,
});

export const createEditableTextControl = (
  options: Omit<EditableTextControlModel, 'selection'> & {
    readonly selection?: EditableTextSelection;
  },
): EditableTextControlModel => ({
  ...options,
  selection: options.selection ?? sharedTextSelection(options.value),
});

export const formControlsModel: CanvasFormModel = {
  buttons: [
    { action: 'submit', id: 'submit', label: 'Submit', tone: 'primary' },
    { action: 'reset', id: 'reset', label: 'Reset', tone: 'secondary' },
  ],
  checkbox: {
    checked: true,
    id: 'agree',
    label: 'Agree to terms',
  },
  color: {
    id: 'color',
    label: 'Accent',
    palette: ['#6ee7b7', '#60a5fa', '#f97316', '#f43f5e'],
    value: '#6ee7b7',
  },
  date: createEditableTextControl({
    id: 'deliveryDate',
    label: 'Date',
    maxLength: 10,
    mode: 'single-line',
    placeholder: 'YYYY-MM-DD',
    value: '2026-07-14',
  }),
  file: {
    accepted: ['image/png', 'application/pdf'],
    command: 'browser.filePicker.request',
    id: 'file',
    label: 'Attachment',
    value: 'No file chosen',
  },
  listbox: {
    id: 'plan',
    label: 'Plan',
    options: [
      { id: 'starter', label: 'Starter' },
      { id: 'pro', label: 'Pro' },
      { id: 'enterprise', label: 'Enterprise' },
    ],
    value: 'pro',
  },
  radio: {
    id: 'schedule',
    label: 'Schedule',
    options: [
      { id: 'morning', label: 'Morning' },
      { id: 'afternoon', label: 'Afternoon' },
      { id: 'evening', label: 'Evening' },
    ],
    value: 'morning',
  },
  range: {
    id: 'quantity',
    label: 'Quantity',
    max: 10,
    min: 1,
    step: 1,
    value: 7,
  },
  semantics: {
    agree: uiNodeSemantics({
      controlState: { checked: true },
      id: 'agree',
      label: 'Agree to terms',
      role: 'checkbox',
    }),
    color: uiNodeSemantics({
      controlState: { value: '#6ee7b7' },
      id: 'color',
      label: 'Accent color',
      role: 'group',
    }),
    deliveryDate: uiNodeSemantics({
      controlState: { value: '2026-07-14' },
      id: 'deliveryDate',
      label: 'Delivery date',
      role: 'textbox',
    }),
    file: uiNodeSemantics({
      controlState: { value: 'No file chosen' },
      description: 'Host command: browser.filePicker.request',
      id: 'file',
      label: 'Attachment',
      role: 'button',
    }),
    notes: uiNodeSemantics({
      controlState: { value: 'Canvas text editing shares one model across compact and multiline fields.' },
      id: 'notes',
      label: 'Notes',
      role: 'textbox',
    }),
    plan: uiNodeSemantics({
      controlState: { value: 'pro' },
      id: 'plan',
      label: 'Plan',
      role: 'list',
    }),
    quantity: uiNodeSemantics({
      controlState: { value: 7 },
      id: 'quantity',
      label: 'Quantity',
      role: 'slider',
    }),
    schedule: uiNodeSemantics({
      controlState: { value: 'morning' },
      id: 'schedule',
      label: 'Schedule',
      role: 'group',
    }),
    startTime: uiNodeSemantics({
      controlState: { value: '09:30' },
      id: 'startTime',
      label: 'Start time',
      role: 'textbox',
    }),
    title: uiNodeSemantics({
      controlState: { value: 'Royal canvas checkout' },
      id: 'title',
      label: 'Title',
      role: 'textbox',
    }),
  },
  textControls: [
    createEditableTextControl({
      id: 'title',
      label: 'Title',
      maxLength: 64,
      mode: 'single-line',
      placeholder: 'Untitled request',
      selection: textSelection(13, 20),
      value: 'Royal canvas checkout',
    }),
    createEditableTextControl({
      id: 'notes',
      label: 'Notes',
      maxLength: 280,
      mode: 'multiline',
      placeholder: 'Add notes',
      selection: textSelection(22, 37),
      value: 'Canvas text editing shares one model across compact and multiline fields.',
    }),
  ],
  time: createEditableTextControl({
    id: 'startTime',
    label: 'Time',
    maxLength: 5,
    mode: 'single-line',
    placeholder: 'HH:MM',
    value: '09:30',
  }),
};

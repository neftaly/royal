import {
  editableTextKeyIntent,
  type EditableTextClipboardShortcut as CoreEditableTextClipboardShortcut,
  type EditableTextClipboardShortcutIntent as CoreEditableTextClipboardShortcutIntent,
  type EditableTextEnterKeyIntent as CoreEditableTextEnterKeyIntent,
  type EditableTextInputMode,
  type EditableTextKeyInput,
  type EditableTextKeyIntent,
  type EditableTextKeyIntentOptions,
} from '@royal/renderer-core/text/editable';

export type EditableTextKeyboardMode = EditableTextInputMode;

export type EditableTextClipboardShortcut = CoreEditableTextClipboardShortcut;

export type EditableTextClipboardShortcutIntent = CoreEditableTextClipboardShortcutIntent;

export type EditableTextEnterKeyIntent = CoreEditableTextEnterKeyIntent;

export type EditableTextKeyboardIntent = EditableTextKeyIntent;

export type EditableTextKeyboardInput = EditableTextKeyInput;

export type EditableTextKeyboardOptions = EditableTextKeyIntentOptions;

export const editableTextKeyboardIntent: (
  input: EditableTextKeyboardInput,
  options?: EditableTextKeyboardOptions,
) => EditableTextKeyboardIntent | undefined = editableTextKeyIntent;

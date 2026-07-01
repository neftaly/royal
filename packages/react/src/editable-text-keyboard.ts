import type { EditableTextCommand } from '@royal/renderer-core/text';

export type EditableTextKeyboardMode = 'single-line' | 'multiline';

export type EditableTextClipboardShortcut = 'copy' | 'cut' | 'paste';

export type EditableTextClipboardShortcutIntent = {
  readonly type: 'clipboard-shortcut';
  readonly shortcut: EditableTextClipboardShortcut;
};

export type EditableTextEnterKeyIntent = {
  readonly type: 'enter-key';
};

export type EditableTextKeyboardIntent =
  | EditableTextCommand
  | EditableTextClipboardShortcutIntent
  | EditableTextEnterKeyIntent;

export interface EditableTextKeyboardInput {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

export interface EditableTextKeyboardOptions {
  readonly mode?: EditableTextKeyboardMode;
}

const isComposingKey = (input: EditableTextKeyboardInput): boolean =>
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
  extend ? { type: 'move-previous', extend: true } : { type: 'move-previous' };

const moveNextCommand = (extend: boolean): EditableTextCommand =>
  extend ? { type: 'move-next', extend: true } : { type: 'move-next' };

const moveStartCommand = (extend: boolean): EditableTextCommand =>
  extend ? { type: 'move-start', extend: true } : { type: 'move-start' };

const moveEndCommand = (extend: boolean): EditableTextCommand =>
  extend ? { type: 'move-end', extend: true } : { type: 'move-end' };

const shortcutIntent = (key: string): EditableTextKeyboardIntent | undefined => {
  switch (key.toLowerCase()) {
    case 'a':
      return { type: 'select-all' };
    case 'c':
      return { type: 'clipboard-shortcut', shortcut: 'copy' };
    case 'x':
      return { type: 'clipboard-shortcut', shortcut: 'cut' };
    case 'v':
      return { type: 'clipboard-shortcut', shortcut: 'paste' };
    default:
      return undefined;
  }
};

export const editableTextKeyboardIntent = (
  input: EditableTextKeyboardInput,
  options?: EditableTextKeyboardOptions,
): EditableTextKeyboardIntent | undefined => {
  if (isComposingKey(input)) return undefined;

  const altKey = input.altKey === true;
  const ctrlKey = input.ctrlKey === true;
  const metaKey = input.metaKey === true;
  const shortcutKey = ctrlKey || metaKey;
  const printableKey = isPrintableKey(input.key);

  if (shortcutKey && !altKey) return shortcutIntent(input.key);
  if (altKey && !metaKey && printableKey) return { type: 'insert-text', text: input.key };
  if (altKey || ctrlKey || metaKey) return undefined;

  const extend = input.shiftKey === true;

  switch (input.key) {
    case 'Enter':
      return options?.mode === 'multiline'
        ? { type: 'insert-text', text: '\n' }
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
      return printableKey
        ? { type: 'insert-text', text: input.key }
        : undefined;
  }
};

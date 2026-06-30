import { describe, expect, it } from 'vitest';
import { editableTextKeyboardIntent } from '../src/editable-text-keyboard';

describe('editable text keyboard helper', () => {
  it('maps printable keys to insert-text commands', () => {
    expect(editableTextKeyboardIntent({ key: 'a' })).toEqual({ type: 'insert-text', text: 'a' });
    expect(editableTextKeyboardIntent({ key: 'A', shiftKey: true }))
      .toEqual({ type: 'insert-text', text: 'A' });
    expect(editableTextKeyboardIntent({ key: '🙂' })).toEqual({ type: 'insert-text', text: '🙂' });
    expect(editableTextKeyboardIntent({ key: '@', ctrlKey: true, altKey: true }))
      .toEqual({ type: 'insert-text', text: '@' });
    expect(editableTextKeyboardIntent({ key: 'å', altKey: true }))
      .toEqual({ type: 'insert-text', text: 'å' });
    expect(editableTextKeyboardIntent({ key: 'Tab' })).toBeUndefined();
  });

  it('maps Enter by text mode', () => {
    expect(editableTextKeyboardIntent({ key: 'Enter' })).toEqual({ type: 'enter-key' });
    expect(editableTextKeyboardIntent({ key: 'Enter' }, { mode: 'single-line' }))
      .toEqual({ type: 'enter-key' });
    expect(editableTextKeyboardIntent({ key: 'Enter' }, { mode: 'multiline' }))
      .toEqual({ type: 'insert-text', text: '\n' });
    expect(editableTextKeyboardIntent({ key: 'Enter', metaKey: true })).toBeUndefined();
  });

  it('maps deletion and navigation commands', () => {
    expect(editableTextKeyboardIntent({ key: 'Backspace' })).toEqual({ type: 'delete-backward' });
    expect(editableTextKeyboardIntent({ key: 'Delete' })).toEqual({ type: 'delete-forward' });
    expect(editableTextKeyboardIntent({ key: 'ArrowLeft' })).toEqual({ type: 'move-previous' });
    expect(editableTextKeyboardIntent({ key: 'ArrowRight', shiftKey: true }))
      .toEqual({ type: 'move-next', extend: true });
    expect(editableTextKeyboardIntent({ key: 'ArrowUp' })).toEqual({ type: 'move-start' });
    expect(editableTextKeyboardIntent({ key: 'ArrowDown', shiftKey: true }))
      .toEqual({ type: 'move-end', extend: true });
    expect(editableTextKeyboardIntent({ key: 'Home', shiftKey: true }))
      .toEqual({ type: 'move-start', extend: true });
    expect(editableTextKeyboardIntent({ key: 'End' })).toEqual({ type: 'move-end' });
  });

  it('maps shortcut keys to select-all and clipboard intents', () => {
    expect(editableTextKeyboardIntent({ key: 'a', ctrlKey: true })).toEqual({ type: 'select-all' });
    expect(editableTextKeyboardIntent({ key: 'A', metaKey: true, shiftKey: true }))
      .toEqual({ type: 'select-all' });
    expect(editableTextKeyboardIntent({ key: 'c', ctrlKey: true }))
      .toEqual({ type: 'clipboard-shortcut', shortcut: 'copy' });
    expect(editableTextKeyboardIntent({ key: 'X', metaKey: true }))
      .toEqual({ type: 'clipboard-shortcut', shortcut: 'cut' });
    expect(editableTextKeyboardIntent({ key: 'v', ctrlKey: true, shiftKey: true }))
      .toEqual({ type: 'clipboard-shortcut', shortcut: 'paste' });
  });

  it('ignores composing input and unsupported command-modified keys', () => {
    expect(editableTextKeyboardIntent({ key: 'a', isComposing: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'Dead' })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'Process' })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'a', keyCode: 229 })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'b', ctrlKey: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'b', metaKey: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'Backspace', ctrlKey: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'Backspace', metaKey: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'Backspace', ctrlKey: true, altKey: true }))
      .toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'ArrowLeft', altKey: true })).toBeUndefined();
    expect(editableTextKeyboardIntent({ key: 'ArrowRight', altKey: true, shiftKey: true }))
      .toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { createEditableTextFragment } from './editable-text-view';
import type { EditableTextSelection } from './editable-text';

const selection = (anchor: number, focus = anchor): EditableTextSelection => ({
  anchor,
  anchorLine: undefined,
  focus,
  focusLine: undefined,
});

describe('editable text fragment primitive', () => {
  it('renders selection, text, and caret nodes from the editable text layout', () => {
    const view = createEditableTextFragment({
      color: [1, 1, 1, 1],
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 12,
      origin: [2, 3, 0.4],
      selection: selection(1, 4),
      showCaret: true,
      text: 'abcdef',
    });

    expect(view.selectionRects).toHaveLength(1);
    expect(view.range).toMatchObject({ end: 4, start: 1 });
    expect(view.nodes.map((node) => node.kind)).toEqual(['mesh', 'text', 'mesh']);
  });

  it('uses placeholder text without selecting placeholder content', () => {
    const view = createEditableTextFragment({
      color: [1, 1, 1, 1],
      fontSize: 0.5,
      lineHeight: 0.7,
      maxWidth: 4,
      origin: [0, 0, 0],
      placeholder: 'Name',
      selection: selection(0),
      text: '',
    });
    const textNode = view.nodes.find((node) => node.kind === 'text');

    expect(view.selectionRects).toEqual([]);
    expect(textNode?.kind).toBe('text');
    expect(textNode?.layout.source).toBe('Name');
  });

  it('clamps stale selections before deriving geometry', () => {
    const view = createEditableTextFragment({
      color: [1, 1, 1, 1],
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 12,
      origin: [0, 0, 0],
      selection: selection(-10, 30),
      text: 'abc',
    });

    expect(view.selection).toMatchObject({ anchor: 0, focus: 3 });
    expect(view.range).toMatchObject({ end: 3, start: 0 });
  });

  it('normalizes newlines and wrapping in single-line mode', () => {
    const view = createEditableTextFragment({
      color: [1, 1, 1, 1],
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 0.5,
      mode: 'single-line',
      origin: [0, 0, 0],
      selection: selection(2, 5),
      text: 'ab\ncd ef',
    });
    const textNode = view.nodes.find((node) => node.kind === 'text');

    expect(view.layout.text).toBe('ab cd ef');
    expect(view.layout.lines).toHaveLength(1);
    expect(view.layout.wrappedText).toBe('ab cd ef');
    expect(view.range).toMatchObject({ end: 5, start: 2 });
    expect(textNode?.kind).toBe('text');
    expect(textNode?.layout.source).toBe('ab cd ef');
  });

  it('normalizes placeholder newlines in single-line mode', () => {
    const view = createEditableTextFragment({
      color: [1, 1, 1, 1],
      fontSize: 0.5,
      lineHeight: 0.7,
      maxWidth: 0.5,
      mode: 'single-line',
      origin: [0, 0, 0],
      placeholder: 'First\nLast',
      selection: selection(0),
      text: '',
    });
    const textNode = view.nodes.find((node) => node.kind === 'text');

    expect(textNode?.kind).toBe('text');
    expect(textNode?.layout.source).toBe('First Last');
  });
});

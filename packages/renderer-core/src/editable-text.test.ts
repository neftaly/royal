import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  clampTextIndex,
  editableTextCaretPlacement,
  editableTextSelectionRects,
  layoutEditableText,
  nearestEditableTextCaret,
  nextTextIndex,
  previousTextIndex,
  sameEditableTextSelection,
  sortedEditableTextRange,
  wrapEditableText
} from './editable-text';
import { createTextFontFace, layoutText } from './text';

const require = createRequire(import.meta.url);

const atkinsonHyperlegibleRegular = (): ReturnType<typeof createTextFontFace> =>
  createTextFontFace({
    data: readFileSync(require.resolve(
      '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'
    )),
    family: 'Atkinson Hyperlegible',
    source: '@fontsource/atkinson-hyperlegible/files/atkinson-hyperlegible-latin-400-normal.woff'
  });

describe('editable text geometry helpers', () => {
  it('keeps caret placements on UTF-16 indexes across code points and hard lines', () => {
    const font = atkinsonHyperlegibleRegular();
    const text = 'A🙂B\nC';
    const layout = layoutEditableText({
      font,
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: 100,
      text
    });

    expect(layout.wrappedText).toBe(text);
    expect(layout.caretPlacements.map((placement) => [placement.index, placement.line])).toEqual([
      [0, 0],
      [1, 0],
      [3, 0],
      [4, 0],
      [5, 1],
      [6, 1]
    ]);
    expect(previousTextIndex(text, 3)).toBe(1);
    expect(nextTextIndex(text, 1)).toBe(3);
    expect(clampTextIndex(text, 99)).toBe(text.length);
  });

  it('sorts selections without dropping line hints', () => {
    const forward = { anchor: 1, anchorLine: 0, focus: 5, focusLine: 1 };
    const backward = { anchor: 5, anchorLine: 1, focus: 1, focusLine: 0 };

    expect(sortedEditableTextRange(forward)).toEqual({
      end: 5,
      endLine: 1,
      start: 1,
      startLine: 0
    });
    expect(sortedEditableTextRange(backward)).toEqual({
      end: 5,
      endLine: 1,
      start: 1,
      startLine: 0
    });
    expect(sameEditableTextSelection(forward, { ...forward })).toBe(true);
    expect(sameEditableTextSelection(forward, backward)).toBe(false);
  });

  it('preserves both caret placements at a soft-wrap boundary', () => {
    const font = atkinsonHyperlegibleRegular();
    const text = 'aa bb';
    const fontSize = 1;
    const lineHeight = 1.2;
    const maxWidth = layoutText({ font, fontSize, lineHeight, text: 'aa ' }).metrics.width;
    const layout = layoutEditableText({ font, fontSize, lineHeight, maxWidth, text });

    expect(wrapEditableText({ font, fontSize, lineHeight, maxWidth, text })).toBe('aa \nbb');
    expect(editableTextCaretPlacement(layout, 3, 0)).toMatchObject({ index: 3, line: 0 });
    expect(editableTextCaretPlacement(layout, 3)).toMatchObject({ index: 3, line: 1, x: 0 });
  });

  it('builds line-aware selection rects and hit tests in world space', () => {
    const font = atkinsonHyperlegibleRegular();
    const lineHeight = 1.2;
    const origin = [2, 3, 0] as const;
    const layout = layoutEditableText({
      font,
      fontSize: 1,
      lineHeight,
      maxWidth: 100,
      text: 'ab\ncd'
    });
    const rects = editableTextSelectionRects(layout, {
      end: 4,
      endLine: 1,
      start: 1,
      startLine: 0
    }, origin);

    expect(rects.map((rect) => [rect.line, rect.start, rect.end])).toEqual([
      [0, 1, 2],
      [1, 3, 4]
    ]);
    expect(rects.every((rect) => rect.width > 0 && rect.height === layout.selectionHeight)).toBe(true);
    expect(rects[0]?.y).toBeCloseTo(origin[1] + layout.selectionYOffset);
    expect(rects[1]?.y).toBeCloseTo(origin[1] - lineHeight + layout.selectionYOffset);
    expect(editableTextSelectionRects(layout, {
      end: 1,
      endLine: 0,
      start: 1,
      startLine: 0
    }, origin)).toEqual([]);
    expect(nearestEditableTextCaret(layout, { x: origin[0] + 100, y: origin[1] - lineHeight }, origin))
      .toMatchObject({ index: 5, line: 1 });
  });
});

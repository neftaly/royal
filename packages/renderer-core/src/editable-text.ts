import { layoutText, type TextFontFace } from './text';
import type { Vec3 } from './primitives';

export type EditableTextCaretPlacement = {
  readonly index: number;
  readonly line: number;
  readonly x: number;
};

export type EditableTextCaretEndpoint = {
  readonly index: number;
  readonly line: number | undefined;
};

export type EditableTextLine = {
  readonly end: number;
  readonly index: number;
  readonly placements: readonly EditableTextCaretPlacement[];
  readonly start: number;
  readonly text: string;
  readonly width: number;
};

export type EditableTextLayout = {
  readonly ascender: number;
  readonly caretPlacements: readonly EditableTextCaretPlacement[];
  readonly descender: number;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly lines: readonly EditableTextLine[];
  readonly maxWidth: number;
  readonly selectionHeight: number;
  readonly selectionYOffset: number;
  readonly text: string;
  readonly wrappedText: string;
};

export type EditableTextLayoutOptions = {
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly text: string;
};

export type EditableTextRange = {
  readonly end: number;
  readonly endLine: number | undefined;
  readonly start: number;
  readonly startLine: number | undefined;
};

export type EditableTextSelection = {
  readonly anchor: number;
  readonly anchorLine: number | undefined;
  readonly focus: number;
  readonly focusLine: number | undefined;
};

export type EditableTextSelectionRect = {
  readonly end: number;
  readonly height: number;
  readonly line: number;
  readonly start: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export type EditableTextWrapOptions = EditableTextLayoutOptions;

export type EditableTextHitPoint = {
  readonly x: number;
  readonly y: number;
};

const measureText = (
  font: TextFontFace,
  text: string,
  fontSize: number,
  lineHeight: number,
): number => layoutText({ font, fontSize, lineHeight, text }).metrics.width;

const createTextMeasurer = (
  font: TextFontFace,
  fontSize: number,
  lineHeight: number,
): ((text: string) => number) => {
  const widths = new Map<string, number>();

  return (text) => {
    const cached = widths.get(text);
    if (cached !== undefined) return cached;
    const width = measureText(font, text, fontSize, lineHeight);
    widths.set(text, width);
    return width;
  };
};

const textBoundaryIndexes = (text: string): readonly number[] => {
  const indexes = [0];
  let index = 0;

  for (const character of Array.from(text)) {
    index += character.length;
    indexes.push(index);
  }

  return indexes;
};

const textBoundaryIndexesBetween = (text: string, start: number, end: number): readonly number[] =>
  textBoundaryIndexes(text.slice(start, end)).map((index) => start + index);

const isSoftWrapBreakCharacter = (character: string): boolean =>
  character === ' ' || character === '\t';

const findWrapLineEnd = (
  text: string,
  start: number,
  end: number,
  maxWidth: number,
  measure: (text: string) => number,
): number => {
  const boundaries = textBoundaryIndexesBetween(text, start, end).slice(1);
  let previous = start;
  let lastBreak = start;

  for (const boundary of boundaries) {
    const width = measure(text.slice(start, boundary));
    if (width > maxWidth && previous > start) return lastBreak > start ? lastBreak : previous;

    const character = text.slice(previous, boundary);
    if (isSoftWrapBreakCharacter(character)) lastBreak = boundary;
    previous = boundary;
  }

  return end;
};

const editableTextLines = (
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): readonly Omit<EditableTextLine, 'index' | 'placements' | 'width'>[] => {
  const lines: Array<Omit<EditableTextLine, 'index' | 'placements' | 'width'>> = [];
  let paragraphStart = 0;

  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== '\n') continue;

    const paragraphEnd = index;
    if (paragraphStart === paragraphEnd) {
      lines.push({ end: paragraphEnd, start: paragraphStart, text: '' });
    } else {
      let lineStart = paragraphStart;
      while (lineStart < paragraphEnd) {
        const lineEnd = findWrapLineEnd(text, lineStart, paragraphEnd, maxWidth, measure);
        lines.push({
          end: lineEnd,
          start: lineStart,
          text: text.slice(lineStart, lineEnd),
        });
        lineStart = lineEnd;
      }
    }

    paragraphStart = index + 1;
  }

  return lines;
};

const caretPlacementFor = (
  line: Pick<EditableTextLine, 'index' | 'start' | 'text'>,
  index: number,
  measure: (text: string) => number,
): EditableTextCaretPlacement => ({
  index,
  line: line.index,
  x: measure(line.text.slice(0, Math.max(0, index - line.start))),
});

export const wrapEditableText = ({
  font,
  fontSize,
  lineHeight,
  maxWidth,
  text,
}: EditableTextWrapOptions): string => {
  const measure = createTextMeasurer(font, fontSize, lineHeight);
  return editableTextLines(text, maxWidth, measure).map((line) => line.text).join('\n');
};

export const layoutEditableText = ({
  font,
  fontSize,
  lineHeight,
  maxWidth,
  text,
}: EditableTextLayoutOptions): EditableTextLayout => {
  const measure = createTextMeasurer(font, fontSize, lineHeight);
  const metrics = layoutText({ font, fontSize, lineHeight, text: '' }).font.metrics;
  const lines = editableTextLines(text, maxWidth, measure).map((line, index): EditableTextLine => {
    const indexedLine = { ...line, index };
    const placements = textBoundaryIndexesBetween(text, line.start, line.end).map((placementIndex) =>
      caretPlacementFor(indexedLine, placementIndex, measure)
    );

    return {
      ...indexedLine,
      placements,
      width: measure(line.text),
    };
  });
  const caretPlacements = lines.flatMap((line) => line.placements);

  return {
    ascender: metrics.ascender,
    caretPlacements,
    descender: metrics.descender,
    font,
    fontSize,
    lineHeight,
    lines,
    maxWidth,
    selectionHeight: metrics.ascender - metrics.descender,
    selectionYOffset: (metrics.ascender + metrics.descender) / 2,
    text,
    wrappedText: lines.map((line) => line.text).join('\n'),
  };
};

export const sameEditableTextSelection = (
  left: EditableTextSelection,
  right: EditableTextSelection,
): boolean =>
  left.anchor === right.anchor &&
  left.focus === right.focus &&
  left.anchorLine === right.anchorLine &&
  left.focusLine === right.focusLine;

export const sortedEditableTextRange = (selection: EditableTextSelection): EditableTextRange => {
  if (selection.anchor <= selection.focus) {
    return {
      end: selection.focus,
      endLine: selection.focusLine,
      start: selection.anchor,
      startLine: selection.anchorLine,
    };
  }

  return {
    end: selection.anchor,
    endLine: selection.anchorLine,
    start: selection.focus,
    startLine: selection.focusLine,
  };
};

export const editableTextCaretPlacement = (
  layout: EditableTextLayout,
  index: number,
  lineHint?: number,
): EditableTextCaretPlacement | undefined => {
  const placements = layout.caretPlacements.filter((candidate) => candidate.index === index);
  if (placements.length === 0) return undefined;
  if (lineHint !== undefined) {
    const linePlacement = placements.find((candidate) => candidate.line === lineHint);
    if (linePlacement !== undefined) return linePlacement;
  }

  return placements.at(-1);
};

export const editableTextSelectionRects = (
  layout: EditableTextLayout,
  range: EditableTextRange,
  origin: Vec3,
): readonly EditableTextSelectionRect[] => {
  if (range.start === range.end) return [];

  const startPlacement = editableTextCaretPlacement(layout, range.start, range.startLine);
  const endPlacement = editableTextCaretPlacement(layout, range.end, range.endLine);
  if (startPlacement === undefined || endPlacement === undefined) return [];

  const rects: EditableTextSelectionRect[] = [];
  for (let line = startPlacement.line; line <= endPlacement.line; line += 1) {
    const lineLayout = layout.lines[line];
    if (lineLayout === undefined) continue;
    const xStart = line === startPlacement.line ? startPlacement.x : 0;
    const xEnd = line === endPlacement.line ? endPlacement.x : lineLayout.width;
    const width = Math.max(0, xEnd - xStart);
    if (width <= 0) continue;

    rects.push({
      end: line === endPlacement.line ? range.end : lineLayout.end,
      height: layout.selectionHeight,
      line,
      start: line === startPlacement.line ? range.start : lineLayout.start,
      width,
      x: origin[0] + xStart,
      y: origin[1] - line * layout.lineHeight + layout.selectionYOffset,
    });
  }

  return rects;
};

export const nearestEditableTextCaret = (
  layout: EditableTextLayout,
  point: EditableTextHitPoint,
  origin: Vec3,
): EditableTextCaretPlacement => {
  const targetLine = Math.max(
    0,
    Math.min(layout.lines.length - 1, Math.round((origin[1] - point.y) / layout.lineHeight)),
  );
  const targetX = point.x - origin[0];
  const linePlacements = layout.caretPlacements.filter((placement) => placement.line === targetLine);
  const placements = linePlacements.length > 0 ? linePlacements : layout.caretPlacements;
  let closest = placements[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const placement of placements) {
    const lineDistance = Math.abs(placement.line - targetLine) * layout.maxWidth;
    const distance = Math.abs(placement.x - targetX) + lineDistance;
    if (distance >= closestDistance) continue;
    closest = placement;
    closestDistance = distance;
  }

  return closest ?? { index: 0, line: 0, x: 0 };
};

export const clampTextIndex = (text: string, index: number): number =>
  Math.max(0, Math.min(text.length, index));

export const previousTextIndex = (text: string, index: number): number => {
  if (index <= 0) return 0;
  const prefix = Array.from(text.slice(0, index));
  return prefix.slice(0, -1).join('').length;
};

export const nextTextIndex = (text: string, index: number): number => {
  if (index >= text.length) return text.length;
  const character = Array.from(text.slice(index))[0] ?? '';
  return index + character.length;
};

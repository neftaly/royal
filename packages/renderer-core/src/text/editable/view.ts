import { boxGeometry } from '../../geometry';
import { unlitMaterial } from '../../material';
import { mesh } from '../../mesh';
import type { Rgba, Vec3 } from '../../primitives';
import type { RenderNode } from '../../render-node';
import type { TextFontFace } from '../font';
import { text } from '../node';
import {
  clampTextIndex,
  editableTextCaretPlacement,
  editableTextSelectionRects,
  layoutEditableText,
  sortedEditableTextRange,
  wrapEditableText,
  type EditableTextLayout,
  type EditableTextRange,
  type EditableTextSelection,
  type EditableTextSelectionRect,
} from './model';

export type EditableTextFragmentMode = 'single-line' | 'multiline';

export type EditableTextLineWindow = {
  readonly lineCount: number;
  readonly startLine: number;
};

export interface EditableTextFragmentOptions {
  readonly caretColor?: Rgba;
  readonly caretWidth?: number;
  readonly color: Rgba;
  readonly font?: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly lineWindow?: EditableTextLineWindow;
  readonly maxWidth: number;
  readonly mode?: EditableTextFragmentMode;
  readonly origin: Vec3;
  readonly placeholder?: string;
  readonly placeholderColor?: Rgba;
  readonly selection: EditableTextSelection;
  readonly selectionColor?: Rgba;
  readonly showCaret?: boolean;
  readonly text: string;
}

export interface EditableTextFragment {
  readonly caretPosition: Vec3;
  readonly layout: EditableTextLayout;
  readonly nodes: readonly RenderNode[];
  readonly range: EditableTextRange;
  readonly selection: EditableTextSelection;
  readonly selectionRects: readonly EditableTextSelectionRect[];
}

const defaultCaretColor: Rgba = [0.98, 0.94, 0.55, 1];
const defaultPlaceholderColor: Rgba = [0.55, 0.62, 0.62, 1];
const defaultSelectionColor: Rgba = [0.08, 0.28, 0.42, 1];
const defaultCaretWidth = 0.025;

const textForMode = (textValue: string, mode: EditableTextFragmentMode): string =>
  mode === 'single-line' ? textValue.replace(/[\r\n]/g, ' ') : textValue;

const maxWidthForMode = (maxWidth: number, _mode: EditableTextFragmentMode): number => maxWidth;

const normalizedSelection = (
  value: string,
  selection: EditableTextSelection,
): EditableTextSelection => ({
  anchor: clampTextIndex(value, selection.anchor),
  anchorLine: selection.anchorLine,
  focus: clampTextIndex(value, selection.focus),
  focusLine: selection.focusLine,
});

const selectionNodes = (
  rects: readonly EditableTextSelectionRect[],
  color: Rgba,
  origin: Vec3,
): readonly RenderNode[] => {
  const material = unlitMaterial({ color });

  return rects.map((rect) =>
    mesh({
      geometry: boxGeometry({ size: [rect.width, rect.height, 0.01] }),
      material,
      transform: {
        position: [rect.x + rect.width / 2, rect.y, origin[2] - 0.02],
        rotation: [0, 0, 0],
      },
    })
  );
};

const caretPositionFor = (
  layout: EditableTextLayout,
  selection: EditableTextSelection,
  origin: Vec3,
  caretWidth: number,
): Vec3 => {
  const placement = editableTextCaretPlacement(layout, selection.focus, selection.focusLine) ??
    layout.caretPlacements.at(-1);
  const line = placement?.line ?? 0;
  const x = origin[0] + (placement?.x ?? 0);

  return [
    x + caretWidth / 2,
    origin[1] - line * layout.lineHeight + layout.selectionYOffset,
    origin[2] + 0.02,
  ];
};

const caretNode = (
  position: Vec3,
  height: number,
  width: number,
  color: Rgba,
): RenderNode =>
  mesh({
    geometry: boxGeometry({ size: [width, height, 0.015] }),
    material: unlitMaterial({ color }),
    transform: {
      position,
      rotation: [0, 0, 0],
    },
  });

const clampLineWindow = (
  layout: EditableTextLayout,
  window: EditableTextLineWindow | undefined,
): EditableTextLineWindow => {
  const layoutLineCount = Math.max(1, layout.lines.length);
  if (window === undefined || !Number.isFinite(window.lineCount)) {
    return { lineCount: layoutLineCount, startLine: 0 };
  }

  const lineCount = Math.max(1, Math.floor(window.lineCount));
  const maxStart = Math.max(0, layoutLineCount - lineCount);
  const startLine = Math.max(0, Math.min(maxStart, Math.floor(window.startLine)));

  return {
    lineCount,
    startLine,
  };
};

const visibleWrappedText = (
  layout: EditableTextLayout,
  window: EditableTextLineWindow,
): string =>
  layout.lines
    .slice(window.startLine, window.startLine + window.lineCount)
    .map((line) => line.text)
    .join('\n');

const visiblePlaceholderText = (
  options: EditableTextFragmentOptions,
  mode: EditableTextFragmentMode,
  window: EditableTextLineWindow,
): string =>
  wrapEditableText({
    ...(options.font === undefined ? {} : { font: options.font }),
    fontSize: options.fontSize,
    lineHeight: options.lineHeight,
    maxWidth: maxWidthForMode(options.maxWidth, mode),
    text: textForMode(options.placeholder ?? '', mode),
  })
    .split('\n')
    .slice(window.startLine, window.startLine + window.lineCount)
    .join('\n');

export const createEditableTextFragment = (
  options: EditableTextFragmentOptions,
): EditableTextFragment => {
  const mode = options.mode ?? 'multiline';
  const displayValue = textForMode(options.text, mode);
  const layoutMaxWidth = maxWidthForMode(options.maxWidth, mode);
  const layout = layoutEditableText({
    ...(options.font === undefined ? {} : { font: options.font }),
    fontSize: options.fontSize,
    lineHeight: options.lineHeight,
    maxWidth: layoutMaxWidth,
    text: displayValue,
  });
  const selection = normalizedSelection(displayValue, options.selection);
  const range = sortedEditableTextRange(selection);
  const lineWindow = clampLineWindow(layout, options.lineWindow);
  const lineOffsetY = lineWindow.startLine * layout.lineHeight;
  const selectionRects = editableTextSelectionRects(layout, range, options.origin)
    .filter((rect) =>
      rect.line >= lineWindow.startLine &&
      rect.line < lineWindow.startLine + lineWindow.lineCount
    )
    .map((rect) => ({
      ...rect,
      y: rect.y + lineOffsetY,
    }));
  const caretWidth = options.caretWidth ?? defaultCaretWidth;
  const caretPlacement = editableTextCaretPlacement(layout, selection.focus, selection.focusLine) ??
    layout.caretPlacements.at(-1);
  const caretPosition = caretPositionFor(layout, selection, options.origin, caretWidth);
  const visibleCaretPosition: Vec3 = [
    caretPosition[0],
    caretPosition[1] + lineOffsetY,
    caretPosition[2],
  ];
  const caretVisible =
    caretPlacement === undefined ||
    (
      caretPlacement.line >= lineWindow.startLine &&
      caretPlacement.line < lineWindow.startLine + lineWindow.lineCount
    );
  const displayText = displayValue.length === 0
    ? visiblePlaceholderText(options, mode, lineWindow)
    : visibleWrappedText(layout, lineWindow);
  const textColor = displayValue.length === 0
    ? options.placeholderColor ?? defaultPlaceholderColor
    : options.color;
  const nodes = [
    ...selectionNodes(selectionRects, options.selectionColor ?? defaultSelectionColor, options.origin),
    text({
      color: textColor,
      ...(options.font === undefined ? {} : { font: options.font }),
      fontSize: options.fontSize,
      lineHeight: options.lineHeight,
      origin: options.origin,
      text: displayText,
    }),
    ...(options.showCaret === true && caretVisible
      ? [caretNode(visibleCaretPosition, layout.selectionHeight, caretWidth, options.caretColor ?? defaultCaretColor)]
      : []),
  ];

  return {
    caretPosition: visibleCaretPosition,
    layout,
    nodes,
    range,
    selection,
    selectionRects,
  };
};

/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  createTextFontFace,
  layoutText,
  solidTexture,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextFontFace,
  type Vec3,
  unlitMaterial,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import fontUrl from '../../assets/atkinson-hyperlegible-latin-400-normal.woff?url';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;
const cameraBounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const;
const sceneOrigin: Vec3 = [-4.72, 2.42, 0];
const contentWidth = cameraBounds.right - sceneOrigin[0] - 0.48;
const headingSampleText = 'Voilà, naïve façade: “Royal”';
const defaultSampleText = 'Moloch, whose factories dream and croak in the fog';
const defaultFontSize = 0.72;
const editableLineHeight = defaultFontSize * 1.18;
const caretWidth = 0.035;
const caretMaterial = unlitMaterial({
  baseColor: solidTexture({ color: [0.98, 0.94, 0.55, 1] }),
});
const selectionMaterial = unlitMaterial({
  baseColor: solidTexture({ color: [0.08, 0.28, 0.42, 1] }),
});

type CanvasTextBox = {
  readonly height: number;
  readonly render: (origin: Vec3) => readonly RenderNode[];
  readonly width: number;
};

type TextBoxOptions = {
  readonly color: Rgba;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly text: string;
  readonly width: number;
};

type StackOptions = {
  readonly children: readonly CanvasTextBox[];
  readonly gap: number;
  readonly origin: Vec3;
};

type FontState =
  | { readonly status: 'loading' }
  | { readonly font: TextFontFace; readonly status: 'ready' }
  | { readonly status: 'failed' };

type EditableTextBox = CanvasTextBox & {
  readonly caret: (origin: Vec3) => Vec3;
};

type TextRange = {
  readonly end: number;
  readonly endLine: number | undefined;
  readonly start: number;
  readonly startLine: number | undefined;
};

type TextSelection = {
  readonly anchor: number;
  readonly anchorLine: number | undefined;
  readonly focus: number;
  readonly focusLine: number | undefined;
};

type TextCaretEndpoint = {
  readonly index: number;
  readonly line: number | undefined;
};

type TextDragState = {
  readonly anchor: TextCaretEndpoint;
  readonly moved: boolean;
};

type CaretPlacement = {
  readonly index: number;
  readonly line: number;
  readonly x: number;
};

type EditableTextLine = {
  readonly end: number;
  readonly index: number;
  readonly placements: readonly CaretPlacement[];
  readonly start: number;
  readonly text: string;
  readonly width: number;
};

type EditableTextLayout = {
  readonly ascender: number;
  readonly caretPlacements: readonly CaretPlacement[];
  readonly descender: number;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly lines: readonly EditableTextLine[];
  readonly maxWidth: number;
  readonly selectionHeight: number;
  readonly selectionYOffset: number;
  readonly wrappedText: string;
};

type SelectionRect = {
  readonly end: number;
  readonly height: number;
  readonly line: number;
  readonly start: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type TextEditorProbe = {
  readonly caret: {
    readonly height: number;
    readonly index: number;
    readonly line: number;
    readonly x: number;
    readonly y: number;
  };
  readonly fontSize: number;
  readonly hitTest: {
    readonly count: number;
    readonly lastClientX: number;
    readonly lastClientY: number;
    readonly lastIndex: number;
    readonly lastLine: number;
    readonly lastMs: number;
    readonly maxMs: number;
  };
  readonly hitTestClientPoint: (clientX: number, clientY: number) => CaretPlacement | undefined;
  readonly layout: {
    readonly lineCount: number;
    readonly maxWidth: number;
    readonly selectionHeight: number;
    readonly selectionYOffset: number;
  };
  readonly lineHeight: number;
  readonly measureFontSizes: (fontSizes: readonly number[]) => readonly {
    readonly fontSize: number;
    readonly lineCount: number;
    readonly maxSelectionHeight: number;
    readonly minSelectionHeight: number;
    readonly selectionHeight: number;
  }[];
  readonly origin: {
    readonly x: number;
    readonly y: number;
  };
  readonly placements: readonly CaretPlacement[];
  readonly selection: TextSelection;
  readonly selectionRects: readonly SelectionRect[];
  readonly textLength: number;
};

declare global {
  interface Window {
    __royalTextEditorProbe?: TextEditorProbe;
  }
}

const linesIn = (text: string): number => text.split('\n').length;

const measureCanvasText = (
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
    const width = measureCanvasText(font, text, fontSize, lineHeight);
    widths.set(text, width);
    return width;
  };
};

const wrapCanvasWord = (
  font: TextFontFace,
  word: string,
  fontSize: number,
  lineHeight: number,
  maxWidth: number,
): readonly string[] => {
  const chunks: string[] = [];
  let chunk = '';

  for (const character of Array.from(word)) {
    const next = chunk + character;
    if (chunk !== '' && measureCanvasText(font, next, fontSize, lineHeight) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
      continue;
    }
    chunk = next;
  }

  if (chunk !== '') chunks.push(chunk);
  return chunks;
};

const wrapCanvasText = (
  font: TextFontFace,
  text: string,
  fontSize: number,
  lineHeight: number,
  maxWidth: number,
): string => {
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = '';

    for (const word of words) {
      const next = line === '' ? word : `${line} ${word}`;
      if (measureCanvasText(font, next, fontSize, lineHeight) <= maxWidth) {
        line = next;
        continue;
      }

      if (line !== '') lines.push(line);
      const chunks = wrapCanvasWord(font, word, fontSize, lineHeight, maxWidth);
      lines.push(...chunks.slice(0, -1));
      line = chunks.at(-1) ?? '';
    }

    lines.push(line);
  }

  return lines.join('\n');
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
): CaretPlacement => ({
  index,
  line: line.index,
  x: measure(line.text.slice(0, Math.max(0, index - line.start))),
});

const editableTextLayout = (
  font: TextFontFace,
  text: string,
  fontSize: number,
  lineHeight: number,
  maxWidth: number,
): EditableTextLayout => {
  const measure = createTextMeasurer(font, fontSize, lineHeight);
  const metricProbe = layoutText({ font, fontSize, lineHeight, text: '' }).font.metrics;
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
    ascender: metricProbe.ascender,
    caretPlacements,
    descender: metricProbe.descender,
    font,
    fontSize,
    lineHeight,
    lines,
    maxWidth,
    selectionHeight: metricProbe.ascender - metricProbe.descender,
    selectionYOffset: (metricProbe.ascender + metricProbe.descender) / 2,
    wrappedText: lines.map((line) => line.text).join('\n'),
  };
};

const sameSelection = (left: TextSelection, right: TextSelection): boolean =>
  left.anchor === right.anchor &&
  left.focus === right.focus &&
  left.anchorLine === right.anchorLine &&
  left.focusLine === right.focusLine;

const sortedTextRange = (selection: TextSelection): TextRange => {
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

const caretPlacement = (
  layout: EditableTextLayout,
  index: number,
  lineHint?: number,
): CaretPlacement | undefined => {
  const placements = layout.caretPlacements.filter((candidate) => candidate.index === index);
  if (placements.length === 0) return undefined;
  if (lineHint !== undefined) {
    const linePlacement = placements.find((candidate) => candidate.line === lineHint);
    if (linePlacement !== undefined) return linePlacement;
  }

  return placements.at(-1);
};

const selectionRects = (
  layout: EditableTextLayout,
  range: TextRange,
  origin: Vec3,
): readonly SelectionRect[] => {
  if (range.start === range.end) return [];

  const startPlacement = caretPlacement(layout, range.start, range.startLine);
  const endPlacement = caretPlacement(layout, range.end, range.endLine);
  if (startPlacement === undefined || endPlacement === undefined) return [];

  const rects: SelectionRect[] = [];
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

const selectionNodes = (
  layout: EditableTextLayout,
  range: TextRange,
  origin: Vec3,
): readonly RenderNode[] => {
  return selectionRects(layout, range, origin).map((rect) =>
    (
      <mesh
        geometry={boxGeometry({ size: [rect.width, rect.height, 0.01] })}
        material={selectionMaterial}
        transform={{
          position: [
            rect.x + rect.width / 2,
            rect.y,
            origin[2] - 0.02,
          ],
          rotation: [0, 0, 0],
        }}
      />
    ) as RenderNode
  );
};

const textBox = ({ color, font, fontSize, lineHeight, text, width }: TextBoxOptions): CanvasTextBox => ({
  height: Math.max(1, linesIn(text)) * lineHeight,
  render: (origin) => [
    (
      <text
        color={color}
        font={font}
        fontSize={fontSize}
        lineHeight={lineHeight}
        origin={origin}
        text={text}
      />
    ) as RenderNode,
  ],
  width,
});

const h1 = (font: TextFontFace, text: string): CanvasTextBox => {
  const fontSize = 0.56;
  const lineHeight = 0.68;
  return textBox({
    color: [0.98, 0.94, 0.55, 1],
    font,
    fontSize,
    lineHeight,
    text: wrapCanvasText(font, text, fontSize, lineHeight, contentWidth),
    width: contentWidth,
  });
};

const h2 = (font: TextFontFace, text: string): CanvasTextBox =>
  textBox({
    color: [0.52, 0.9, 0.84, 1],
    font,
    fontSize: 0.32,
    lineHeight: 0.43,
    text,
    width: 3.25,
  });

const editableSentence = (
  layout: EditableTextLayout,
  caretIndex: number,
  caretLine: number | undefined,
  selectionRange: TextRange,
): EditableTextBox => {
  const placement = caretPlacement(layout, caretIndex, caretLine) ?? layout.caretPlacements.at(-1);
  const box = textBox({
    color: [0.28, 0.95, 0.48, 1],
    font: layout.font,
    fontSize: layout.fontSize,
    lineHeight: layout.lineHeight,
    text: layout.wrappedText,
    width: layout.maxWidth,
  });

  return {
    ...box,
    render: (origin) => [
      ...selectionNodes(layout, selectionRange, origin),
      ...box.render(origin),
    ],
    caret: (origin) => {
      const line = placement?.line ?? 0;
      const x = origin[0] + (placement?.x ?? 0);

      return [
        x + caretWidth / 2,
        origin[1] - line * layout.lineHeight + layout.selectionYOffset,
        origin[2] + 0.02,
      ];
    },
  };
};

const row = ({ children, gap }: Omit<StackOptions, 'origin'>): CanvasTextBox => ({
  height: Math.max(...children.map((child) => child.height)),
  render: (origin) => {
    let cursorX = origin[0];
    return children.flatMap((child) => {
      const nodes = child.render([cursorX, origin[1], origin[2]]);
      cursorX += child.width + gap;
      return nodes;
    });
  },
  width: children.reduce((width, child) => width + child.width, 0) + gap * Math.max(0, children.length - 1),
});

const column = ({ children, gap, origin }: StackOptions): readonly RenderNode[] => {
  let cursorY = origin[1];
  return children.flatMap((child) => {
    const nodes = child.render([origin[0], cursorY, origin[2]]);
    cursorY -= child.height + gap;
    return nodes;
  });
};

const useAtkinsonFont = (): FontState => {
  const [state, setState] = useState<FontState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(fontUrl);
        if (!response.ok) throw new Error(`Font request failed: ${response.status}`);
        const data = await response.arrayBuffer();
        const face = createTextFontFace({
          data,
          family: 'Atkinson Hyperlegible',
          source: fontUrl,
        });
        if (!cancelled) setState({ font: face, status: 'ready' });
      } catch {
        if (!cancelled) setState({ status: 'failed' });
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
};

const caretNode = (position: Vec3, height: number): RenderNode =>
  (
    <mesh
      geometry={boxGeometry({ size: [caretWidth, height, 0.015] })}
      material={caretMaterial}
      transform={{
        position,
        rotation: [0, 0, 0],
      }}
    />
  ) as RenderNode;

const editableOrigin = (font: TextFontFace): Vec3 => {
  const heading = h1(font, headingSampleText);
  const subheading = h2(font, 'h1 / h2 canvas primitives');

  return [
    sceneOrigin[0],
    sceneOrigin[1] - heading.height - 0.16 - subheading.height - 0.16,
    sceneOrigin[2],
  ];
};

const canvasPointToWorld = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): readonly [x: number, y: number] => {
  const rect = canvas.getBoundingClientRect();
  const xRatio = rect.width <= 0 ? 0 : (clientX - rect.left) / rect.width;
  const yRatio = rect.height <= 0 ? 0 : (clientY - rect.top) / rect.height;

  return [
    cameraBounds.left + xRatio * (cameraBounds.right - cameraBounds.left),
    cameraBounds.top - yRatio * (cameraBounds.top - cameraBounds.bottom),
  ];
};

const nearestCaretPlacement = (
  layout: EditableTextLayout,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): CaretPlacement => {
  const origin = editableOrigin(layout.font);
  const [worldX, worldY] = canvasPointToWorld(canvas, clientX, clientY);
  const targetLine = Math.max(
    0,
    Math.min(layout.lines.length - 1, Math.round((origin[1] - worldY) / layout.lineHeight)),
  );
  const targetX = worldX - origin[0];
  const linePlacements = layout.caretPlacements.filter((placement) => placement.line === targetLine);
  const placements = linePlacements.length > 0 ? linePlacements : layout.caretPlacements;
  let closest = placements[0];
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const placement of placements) {
    const lineDistance = Math.abs(placement.line - targetLine) * contentWidth;
    const distance = Math.abs(placement.x - targetX) + lineDistance;
    if (distance >= closestDistance) continue;
    closest = placement;
    closestDistance = distance;
  }

  return closest ?? { index: 0, line: 0, x: 0 };
};

const textScene = (
  font: TextFontFace,
  editableLayout: EditableTextLayout,
  selection: TextSelection,
  showCaret: boolean,
): RenderRoot => {
  const heading = h1(font, headingSampleText);
  const subheading = h2(font, 'h1 / h2 canvas primitives');
  const selectionRange = sortedTextRange(selection);
  const editable = editableSentence(editableLayout, selection.focus, selection.focusLine, selectionRange);
  const caretPosition = editable.caret(editableOrigin(font));

  return (
    <scene>
      <pass clearColor={[0.025, 0.032, 0.038, 1]}>
        <orthographicCamera
          bottom={cameraBounds.bottom}
          far={100}
          left={cameraBounds.left}
          near={0.1}
          position={[0, 0, 10]}
          right={cameraBounds.right}
          rotation={[0, 0, 0]}
          top={cameraBounds.top}
        />
        {column({
          children: [
            heading,
            subheading,
            editable,
            row({
              children: [
                h2(font, 'column rhythm'),
                h2(font, 'row spacing'),
              ],
              gap: 0.42,
            }),
          ],
          gap: 0.16,
          origin: sceneOrigin,
        })}
        {showCaret ? [caretNode(caretPosition, editableLayout.selectionHeight)] : []}
      </pass>
    </scene>
  ) as RenderRoot;
};

const clampTextIndex = (text: string, index: number): number =>
  Math.max(0, Math.min(text.length, index));

const previousTextIndex = (text: string, index: number): number => {
  if (index <= 0) return 0;
  const prefix = Array.from(text.slice(0, index));
  return prefix.slice(0, -1).join('').length;
};

const nextTextIndex = (text: string, index: number): number => {
  if (index >= text.length) return text.length;
  const character = Array.from(text.slice(index))[0] ?? '';
  return index + character.length;
};

const capturePointer = (canvas: HTMLCanvasElement, pointerId: number): void => {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Synthetic pointer events used by browser smoke tests do not always create an active pointer.
  }
};

const releasePointer = (canvas: HTMLCanvasElement, pointerId: number): void => {
  try {
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
  } catch {
    // See capturePointer().
  }
};

export const RendererText = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const [sampleText, setSampleText] = useState(defaultSampleText);
  const [selection, setSelection] = useState<TextSelection>({
    anchor: defaultSampleText.length,
    anchorLine: undefined,
    focus: defaultSampleText.length,
    focusLine: undefined,
  });
  const [focused, setFocused] = useState(false);
  const dragStateRef = useRef<TextDragState | undefined>(undefined);
  const hitTestMetricsRef = useRef({
    count: 0,
    lastClientX: 0,
    lastClientY: 0,
    lastIndex: -1,
    lastLine: -1,
    lastMs: 0,
    maxMs: 0,
  });
  const font = fontState.status === 'ready' ? fontState.font : undefined;
  const editableLayout = useMemo(
    () =>
      font === undefined
        ? undefined
        : editableTextLayout(font, sampleText, defaultFontSize, editableLineHeight, contentWidth),
    [font, sampleText],
  );
  const scene =
    font !== undefined && editableLayout !== undefined
      ? textScene(font, editableLayout, selection, focused)
      : textScenePlaceholder;

  useEffect(() => {
    if (font === undefined || editableLayout === undefined) {
      delete window.__royalTextEditorProbe;
      return;
    }

    const origin = editableOrigin(font);
    const range = sortedTextRange(selection);
    const placement = caretPlacement(editableLayout, selection.focus, selection.focusLine) ??
      editableLayout.caretPlacements.at(-1) ??
      { index: 0, line: 0, x: 0 };
    const hitTest = hitTestMetricsRef.current;
    const probe: TextEditorProbe = {
      caret: {
        height: editableLayout.selectionHeight,
        index: placement.index,
        line: placement.line,
        x: origin[0] + placement.x,
        y: origin[1] - placement.line * editableLayout.lineHeight + editableLayout.selectionYOffset,
      },
      fontSize: editableLayout.fontSize,
      hitTest: {
        count: hitTest.count,
        lastClientX: hitTest.lastClientX,
        lastClientY: hitTest.lastClientY,
        lastIndex: hitTest.lastIndex,
        lastLine: hitTest.lastLine,
        lastMs: hitTest.lastMs,
        maxMs: hitTest.maxMs,
      },
      hitTestClientPoint: (clientX, clientY) => {
        const canvas = document.querySelector('.text-example canvas');
        if (!(canvas instanceof HTMLCanvasElement)) return undefined;
        return nearestCaretPlacement(editableLayout, canvas, clientX, clientY);
      },
      layout: {
        lineCount: editableLayout.lines.length,
        maxWidth: editableLayout.maxWidth,
        selectionHeight: editableLayout.selectionHeight,
        selectionYOffset: editableLayout.selectionYOffset,
      },
      lineHeight: editableLayout.lineHeight,
      measureFontSizes: (fontSizes) =>
        fontSizes.map((requestedFontSize) => {
          const fontSize = Number.isFinite(requestedFontSize) && requestedFontSize > 0
            ? requestedFontSize
            : defaultFontSize;
          const lineHeight = fontSize * 1.18;
          const layout = editableTextLayout(font, sampleText, fontSize, lineHeight, contentWidth);
          const rects = selectionRects(layout, {
            end: sampleText.length,
            endLine: undefined,
            start: 0,
            startLine: undefined,
          }, origin);
          const heights = rects.map((rect) => rect.height);

          return {
            fontSize,
            lineCount: layout.lines.length,
            maxSelectionHeight: Math.max(layout.selectionHeight, ...heights),
            minSelectionHeight: Math.min(layout.selectionHeight, ...heights),
            selectionHeight: layout.selectionHeight,
          };
        }),
      origin: {
        x: origin[0],
        y: origin[1],
      },
      placements: editableLayout.caretPlacements,
      selection,
      selectionRects: selectionRects(editableLayout, range, origin),
      textLength: sampleText.length,
    };

    window.__royalTextEditorProbe = probe;
    return () => {
      if (window.__royalTextEditorProbe === probe) {
        delete window.__royalTextEditorProbe;
      }
    };
  }, [editableLayout, font, sampleText, selection]);

  const replaceText = (nextText: string, nextCaretIndex: number): void => {
    const clampedCaret = clampTextIndex(nextText, nextCaretIndex);
    setSampleText(nextText);
    setSelection({
      anchor: clampedCaret,
      anchorLine: undefined,
      focus: clampedCaret,
      focusLine: undefined,
    });
  };

  const replaceSelection = (insertText: string): void => {
    const range = sortedTextRange(selection);
    const nextText = `${sampleText.slice(0, range.start)}${insertText}${sampleText.slice(range.end)}`;
    replaceText(nextText, range.start + insertText.length);
  };

  const setCaret = (index: number, extend: boolean): void => {
    const nextIndex = clampTextIndex(sampleText, index);
    setSelection((current) => {
      const placement = editableLayout === undefined
        ? undefined
        : caretPlacement(editableLayout, nextIndex, current.focusLine);
      const next = {
        anchor: extend ? current.anchor : nextIndex,
        anchorLine: extend ? current.anchorLine : placement?.line,
        focus: nextIndex,
        focusLine: placement?.line,
      };

      return sameSelection(current, next) ? current : next;
    });
  };

  const setCaretFromCanvasPoint = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    extend: boolean,
    anchor?: TextCaretEndpoint,
  ): TextCaretEndpoint | undefined => {
    if (editableLayout === undefined) return undefined;

    const startedAt = performance.now();
    const placement = nearestCaretPlacement(editableLayout, event.currentTarget, event.clientX, event.clientY);
    const elapsed = performance.now() - startedAt;
    hitTestMetricsRef.current = {
      count: hitTestMetricsRef.current.count + 1,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastIndex: placement.index,
      lastLine: placement.line,
      lastMs: elapsed,
      maxMs: Math.max(hitTestMetricsRef.current.maxMs, elapsed),
    };
    setSelection((current) => {
      const next = {
        anchor: anchor?.index ?? (extend ? current.anchor : placement.index),
        anchorLine: anchor?.line ?? (extend ? current.anchorLine : placement.line),
        focus: placement.index,
        focusLine: placement.line,
      };

      return sameSelection(current, next) ? current : next;
    });

    return { index: placement.index, line: placement.line };
  };

  const handleCanvasKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    if (event.nativeEvent.isComposing) return;
    const range = sortedTextRange(selection);
    const hasSelection = range.start !== range.end;

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelection({
        anchor: 0,
        anchorLine: editableLayout === undefined ? undefined : caretPlacement(editableLayout, 0)?.line,
        focus: sampleText.length,
        focusLine: editableLayout === undefined
          ? undefined
          : caretPlacement(editableLayout, sampleText.length)?.line,
      });
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Backspace') {
      event.preventDefault();
      if (hasSelection) {
        replaceSelection('');
        return;
      }

      const start = previousTextIndex(sampleText, selection.focus);
      replaceText(`${sampleText.slice(0, start)}${sampleText.slice(selection.focus)}`, start);
      return;
    }

    if (event.key === 'Delete') {
      event.preventDefault();
      if (hasSelection) {
        replaceSelection('');
        return;
      }

      const end = nextTextIndex(sampleText, selection.focus);
      replaceText(`${sampleText.slice(0, selection.focus)}${sampleText.slice(end)}`, selection.focus);
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setCaret(
        !event.shiftKey && hasSelection ? range.start : previousTextIndex(sampleText, selection.focus),
        event.shiftKey,
      );
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setCaret(
        !event.shiftKey && hasSelection ? range.end : nextTextIndex(sampleText, selection.focus),
        event.shiftKey,
      );
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setCaret(0, event.shiftKey);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setCaret(sampleText.length, event.shiftKey);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      replaceSelection('\n');
      return;
    }

    if (event.key.length === 1) {
      event.preventDefault();
      replaceSelection(event.key);
    }
  };

  const handleCanvasPaste = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText === '') return;

    event.preventDefault();
    replaceSelection(pastedText);
  };

  const handleCanvasCompositionEnd = (event: CompositionEvent<HTMLCanvasElement>): void => {
    if (event.data === '') return;
    replaceSelection(event.data);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const clicked = setCaretFromCanvasPoint(event, event.shiftKey);
    event.currentTarget.focus({ preventScroll: true });
    setFocused(true);
    const anchor = event.shiftKey ? { index: selection.anchor, line: selection.anchorLine } : clicked;
    dragStateRef.current = anchor === undefined ? undefined : { anchor, moved: false };
    capturePointer(event.currentTarget, event.pointerId);
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragStateRef.current;
    if (drag === undefined || (event.buttons & 1) === 0) return;
    event.preventDefault();
    dragStateRef.current = { ...drag, moved: true };
    setCaretFromCanvasPoint(event, true, drag.anchor);
  };

  const handleCanvasPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragStateRef.current;
    if (drag?.moved === true) {
      event.preventDefault();
      setCaretFromCanvasPoint(event, true, drag.anchor);
    }
    dragStateRef.current = undefined;
    releasePointer(event.currentTarget, event.pointerId);
  };

  return createElement(
    'div',
    { className: 'text-example' },
    fontState.status === 'failed'
      ? createElement('div', { className: 'text-example-fallback', role: 'status' }, sampleText)
      : createElement(Canvas, {
          'aria-label': 'Renderer text editor',
          'aria-multiline': true,
          'aria-roledescription': 'editable canvas text',
          'aria-valuetext': sampleText,
          children: scene,
          onBlur: () => setFocused(false),
          onCompositionEnd: handleCanvasCompositionEnd,
          onFocus: () => setFocused(true),
          onKeyDown: handleCanvasKeyDown,
          onPaste: handleCanvasPaste,
          onPointerCancel: handleCanvasPointerEnd,
          onPointerDown: handleCanvasPointerDown,
          onPointerMove: handleCanvasPointerMove,
          onPointerUp: handleCanvasPointerEnd,
          role: 'textbox',
          rootOptions,
          tabIndex: 0,
        }),
  );
};

const textScenePlaceholder = (
  <scene>
    <pass clearColor={[0.025, 0.032, 0.038, 1]}>
      <orthographicCamera
        bottom={-3.2}
        far={100}
        left={-5.6}
        near={0.1}
        position={[0, 0, 10]}
        right={5.6}
        rotation={[0, 0, 0]}
        top={3.2}
      />
    </pass>
  </scene>
) as RenderRoot;

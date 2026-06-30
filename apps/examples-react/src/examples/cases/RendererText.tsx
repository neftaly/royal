/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  clampTextIndex,
  editableTextCaretPlacement as caretPlacement,
  editableTextSelectionRects as selectionRects,
  layoutText,
  layoutEditableText,
  nearestEditableTextCaret,
  nextTextIndex,
  previousTextIndex,
  sameEditableTextSelection as sameSelection,
  solidTexture,
  sortedEditableTextRange as sortedTextRange,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type EditableTextCaretEndpoint as TextCaretEndpoint,
  type EditableTextCaretPlacement as CaretPlacement,
  type EditableTextLayout,
  type EditableTextRange as TextRange,
  type EditableTextSelection as TextSelection,
  type EditableTextSelectionRect as SelectionRect,
  type TextFontFace,
  type Vec3,
  unlitMaterial,
} from '@royal/renderer-core';
import { Canvas } from '@royal/react';
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { useAtkinsonFont } from './text-font';

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
const contextMenuMaterial = unlitMaterial({
  baseColor: solidTexture({ color: [0.07, 0.09, 0.11, 0.96] }),
});
const contextMenuItemMaterial = unlitMaterial({
  baseColor: solidTexture({ color: [0.12, 0.15, 0.18, 1] }),
});
const contextMenuWidth = 1.34;
const contextMenuItemHeight = 0.36;
const contextMenuPadding = 0.08;
const contextMenuGap = 0.025;
const contextMenuZ = 0.28;
const contextMenuMargin = 0.12;
const contextMenuFontSize = 0.18;
const contextMenuLineHeight = 0.24;
const customMenuPasteUnavailableReason = 'custom-menu-paste-requires-browser-prompt';

type ClipboardAction = 'copy' | 'cut' | 'paste';

type ClipboardSource = 'menu' | 'native';

type ClipboardReason =
  | 'denied'
  | 'empty-paste'
  | 'empty-selection'
  | 'error'
  | 'success'
  | 'unavailable';

type ClipboardReadPermission = 'denied' | 'granted' | 'prompt' | 'unavailable' | 'unknown';

type ClipboardResult = {
  readonly action: ClipboardAction | 'none';
  readonly at: number;
  readonly message: string;
  readonly ok: boolean;
  readonly reason: ClipboardReason | 'none';
  readonly source: ClipboardSource | 'none';
  readonly textLength: number;
};

type ClipboardOperationResult = Omit<ClipboardResult, 'action' | 'at' | 'source'> & {
  readonly action: ClipboardAction;
  readonly source: ClipboardSource;
};

type ClipboardCounters = {
  readonly copy: number;
  readonly cut: number;
  readonly failure: number;
  readonly keyboardCopy: number;
  readonly keyboardCut: number;
  readonly keyboardPaste: number;
  readonly menuCopy: number;
  readonly menuCut: number;
  readonly menuPaste: number;
  readonly nativeCopy: number;
  readonly nativeCut: number;
  readonly nativePaste: number;
  readonly paste: number;
};

type ClipboardFailureState = {
  readonly action: ClipboardAction | 'none';
  readonly active: boolean;
  readonly message: string;
  readonly reason: ClipboardReason | 'none';
  readonly source: ClipboardSource | 'none';
};

type ClipboardState = {
  readonly counters: ClipboardCounters;
  readonly failure: ClipboardFailureState;
  readonly last: ClipboardResult;
};

type TextContextMenuState = {
  readonly open: boolean;
  readonly x: number;
  readonly y: number;
  readonly worldX: number;
  readonly worldY: number;
};

type TextContextMenuEnabled = {
  readonly copy: boolean;
  readonly cut: boolean;
  readonly paste: boolean;
};

type TextContextMenuCommandLayout = {
  readonly action: ClipboardAction;
  readonly enabled: boolean;
  readonly height: number;
  readonly label: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type TextContextMenuCommandProbe = TextContextMenuCommandLayout & {
  readonly clientX: number;
  readonly clientY: number;
};

const initialClipboardCounters: ClipboardCounters = {
  copy: 0,
  cut: 0,
  failure: 0,
  keyboardCopy: 0,
  keyboardCut: 0,
  keyboardPaste: 0,
  menuCopy: 0,
  menuCut: 0,
  menuPaste: 0,
  nativeCopy: 0,
  nativeCut: 0,
  nativePaste: 0,
  paste: 0,
};

const initialClipboardResult: ClipboardResult = {
  action: 'none',
  at: 0,
  message: '',
  ok: false,
  reason: 'none',
  source: 'none',
  textLength: 0,
};

const initialClipboardFailure: ClipboardFailureState = {
  action: 'none',
  active: false,
  message: '',
  reason: 'none',
  source: 'none',
};

const initialClipboardState: ClipboardState = {
  counters: initialClipboardCounters,
  failure: initialClipboardFailure,
  last: initialClipboardResult,
};

const closedTextContextMenu: TextContextMenuState = {
  open: false,
  worldX: 0,
  worldY: 0,
  x: 0,
  y: 0,
};

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

type EditableTextBox = CanvasTextBox & {
  readonly caret: (origin: Vec3) => Vec3;
};

type TextDragState = {
  readonly anchor: TextCaretEndpoint;
  readonly moved: boolean;
};

type PendingContextMenuCommand = {
  readonly action: ClipboardAction;
  readonly pointerId: number;
};

type PendingKeyboardPaste = {
  readonly timeoutId: number;
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
  readonly selectedText: string;
  readonly clipboard: ClipboardState;
  readonly clipboardReadPermission: ClipboardReadPermission;
  readonly menu: {
    readonly commands: readonly TextContextMenuCommandProbe[];
    readonly enabled: {
      readonly copy: boolean;
      readonly cut: boolean;
      readonly paste: boolean;
    };
    readonly failure: boolean;
    readonly failureReason: ClipboardReason | 'none';
    readonly open: boolean;
    readonly unavailableReason: {
      readonly paste: typeof customMenuPasteUnavailableReason | 'none';
    };
    readonly x: number;
    readonly y: number;
  };
  readonly text: string;
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
  font: TextFontFace,
  layout: EditableTextLayout,
  caretIndex: number,
  caretLine: number | undefined,
  selectionRange: TextRange,
): EditableTextBox => {
  const placement = caretPlacement(layout, caretIndex, caretLine) ?? layout.caretPlacements.at(-1);
  const box = textBox({
    color: [0.28, 0.95, 0.48, 1],
    font,
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

const contextMenuNodes = (
  font: TextFontFace,
  menu: TextContextMenuState,
  commands: readonly TextContextMenuCommandLayout[],
): readonly RenderNode[] => {
  if (!menu.open) return [];
  const [x, y] = clampedContextMenuWorldPosition(menu.worldX, menu.worldY);
  const height = contextMenuHeight();
  const nodes: RenderNode[] = [
    (
      <mesh
        geometry={boxGeometry({ size: [contextMenuWidth, height, 0.02] })}
        material={contextMenuMaterial}
        transform={{
          position: [x + contextMenuWidth / 2, y - height / 2, contextMenuZ],
          rotation: [0, 0, 0],
        }}
      />
    ) as RenderNode,
  ];

  for (const command of commands) {
    nodes.push(
      (
        <mesh
          geometry={boxGeometry({ size: [command.width, command.height, 0.02] })}
          material={contextMenuItemMaterial}
          transform={{
            position: [command.x + command.width / 2, command.y - command.height / 2, contextMenuZ + 0.01],
            rotation: [0, 0, 0],
          }}
        />
      ) as RenderNode,
      (
        <text
          color={command.enabled ? [0.92, 0.96, 0.98, 1] : [0.42, 0.47, 0.5, 1]}
          font={font}
          fontSize={contextMenuFontSize}
          lineHeight={contextMenuLineHeight}
          origin={[command.x + 0.09, command.y - 0.095, contextMenuZ + 0.03]}
          text={command.label}
        />
      ) as RenderNode,
    );
  }

  return nodes;
};

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

const worldPointToCanvasClient = (
  canvas: HTMLCanvasElement,
  worldX: number,
  worldY: number,
): readonly [clientX: number, clientY: number] => {
  const rect = canvas.getBoundingClientRect();
  return [
    rect.left + ((worldX - cameraBounds.left) / (cameraBounds.right - cameraBounds.left)) * rect.width,
    rect.top + ((cameraBounds.top - worldY) / (cameraBounds.top - cameraBounds.bottom)) * rect.height,
  ];
};

const contextMenuHeight = (): number =>
  contextMenuPadding * 2 + contextMenuItemHeight * 3 + contextMenuGap * 2;

const clampedContextMenuWorldPosition = (
  worldX: number,
  worldY: number,
): readonly [x: number, y: number] => {
  const height = contextMenuHeight();
  return [
    Math.max(
      cameraBounds.left + contextMenuMargin,
      Math.min(worldX, cameraBounds.right - contextMenuWidth - contextMenuMargin),
    ),
    Math.max(
      cameraBounds.bottom + height + contextMenuMargin,
      Math.min(worldY, cameraBounds.top - contextMenuMargin),
    ),
  ];
};

const contextMenuCommands = (
  menu: TextContextMenuState,
  enabled: TextContextMenuEnabled,
): readonly TextContextMenuCommandLayout[] => {
  if (!menu.open) return [];
  const [x, y] = clampedContextMenuWorldPosition(menu.worldX, menu.worldY);
  const commands: readonly {
    readonly action: ClipboardAction;
    readonly enabled: boolean;
    readonly label: string;
  }[] = [
    { action: 'cut', enabled: enabled.cut, label: 'Cut' },
    { action: 'copy', enabled: enabled.copy, label: 'Copy' },
    { action: 'paste', enabled: enabled.paste, label: 'Paste' },
  ];

  return commands.map((command, index) => ({
    ...command,
    height: contextMenuItemHeight,
    width: contextMenuWidth - contextMenuPadding * 2,
    x: x + contextMenuPadding,
    y: y - contextMenuPadding - index * (contextMenuItemHeight + contextMenuGap),
  }));
};

const contextMenuCommandAt = (
  commands: readonly TextContextMenuCommandLayout[],
  worldX: number,
  worldY: number,
): TextContextMenuCommandLayout | undefined =>
  commands.find((command) =>
    worldX >= command.x &&
    worldX <= command.x + command.width &&
    worldY <= command.y &&
    worldY >= command.y - command.height
  );

const nearestCaretPlacement = (
  layout: EditableTextLayout,
  origin: Vec3,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): CaretPlacement => {
  const [worldX, worldY] = canvasPointToWorld(canvas, clientX, clientY);
  return nearestEditableTextCaret(layout, { x: worldX, y: worldY }, origin);
};

const textScene = (
  font: TextFontFace,
  editableLayout: EditableTextLayout,
  selection: TextSelection,
  editableWorldOrigin: Vec3,
  contextMenu: TextContextMenuState,
  menuCommands: readonly TextContextMenuCommandLayout[],
  showCaret: boolean,
): RenderRoot => {
  const heading = h1(font, headingSampleText);
  const subheading = h2(font, 'h1 / h2 canvas primitives');
  const selectionRange = sortedTextRange(selection);
  const editable = editableSentence(font, editableLayout, selection.focus, selection.focusLine, selectionRange);
  const caretPosition = editable.caret(editableWorldOrigin);

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
        {contextMenuNodes(font, contextMenu, menuCommands)}
      </pass>
    </scene>
  ) as RenderRoot;
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

const rendererTextCanvas = (): HTMLCanvasElement | undefined => {
  const canvas = document.querySelector('canvas[aria-label="Renderer text editor"]');
  return canvas instanceof HTMLCanvasElement ? canvas : undefined;
};

const focusRendererTextCanvas = (): void => {
  rendererTextCanvas()?.focus({ preventScroll: true });
};

const clipboardErrorReason = (error: unknown): ClipboardReason =>
  error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'error';

const clipboardErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const incrementClipboardCounters = (
  counters: ClipboardCounters,
  action: ClipboardAction,
  source: ClipboardSource,
  failed: boolean,
): ClipboardCounters => ({
  copy: counters.copy + (action === 'copy' ? 1 : 0),
  cut: counters.cut + (action === 'cut' ? 1 : 0),
  failure: counters.failure + (failed ? 1 : 0),
  keyboardCopy: counters.keyboardCopy,
  keyboardCut: counters.keyboardCut,
  keyboardPaste: counters.keyboardPaste,
  menuCopy: counters.menuCopy + (source === 'menu' && action === 'copy' ? 1 : 0),
  menuCut: counters.menuCut + (source === 'menu' && action === 'cut' ? 1 : 0),
  menuPaste: counters.menuPaste + (source === 'menu' && action === 'paste' ? 1 : 0),
  nativeCopy: counters.nativeCopy + (source === 'native' && action === 'copy' ? 1 : 0),
  nativeCut: counters.nativeCut + (source === 'native' && action === 'cut' ? 1 : 0),
  nativePaste: counters.nativePaste + (source === 'native' && action === 'paste' ? 1 : 0),
  paste: counters.paste + (action === 'paste' ? 1 : 0),
});

const incrementKeyboardShortcutCounter = (
  counters: ClipboardCounters,
  action: ClipboardAction,
): ClipboardCounters => ({
  ...counters,
  keyboardCopy: counters.keyboardCopy + (action === 'copy' ? 1 : 0),
  keyboardCut: counters.keyboardCut + (action === 'cut' ? 1 : 0),
  keyboardPaste: counters.keyboardPaste + (action === 'paste' ? 1 : 0),
});

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
  const [clipboardState, setClipboardState] = useState<ClipboardState>(initialClipboardState);
  const [clipboardReadPermission, setClipboardReadPermission] = useState<ClipboardReadPermission>('unknown');
  const [contextMenu, setContextMenu] = useState<TextContextMenuState>(closedTextContextMenu);
  const dragStateRef = useRef<TextDragState | undefined>(undefined);
  const pendingContextMenuCommandRef = useRef<PendingContextMenuCommand | undefined>(undefined);
  const pendingKeyboardPasteRef = useRef<PendingKeyboardPaste | undefined>(undefined);
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
  const editableWorldOrigin = useMemo(
    () => font === undefined ? undefined : editableOrigin(font),
    [font],
  );
  const editableLayout = useMemo(
    () =>
      font === undefined
        ? undefined
        : layoutEditableText({
            font,
            fontSize: defaultFontSize,
            lineHeight: editableLineHeight,
            maxWidth: contentWidth,
            text: sampleText,
          }),
    [font, sampleText],
  );
  const currentRange = sortedTextRange(selection);
  const selectedText = sampleText.slice(currentRange.start, currentRange.end);
  const hasSelection = currentRange.start !== currentRange.end;
  const canReadNativeClipboard = typeof navigator.clipboard?.readText === 'function';
  const menuEnabled = {
    copy: hasSelection,
    cut: hasSelection,
    paste: canReadNativeClipboard,
  } as const;
  const menuCommands = contextMenuCommands(contextMenu, menuEnabled);
  const scene =
    font !== undefined && editableLayout !== undefined && editableWorldOrigin !== undefined
      ? textScene(font, editableLayout, selection, editableWorldOrigin, contextMenu, menuCommands, focused)
      : textScenePlaceholder;

  useEffect(() => {
    const permissions = navigator.permissions;
    if (permissions === undefined || typeof permissions.query !== 'function') {
      setClipboardReadPermission('unavailable');
      return;
    }

    let cancelled = false;
    let status: PermissionStatus | undefined;
    let handleChange: (() => void) | undefined;
    const applyState = (state: PermissionState): void => {
      if (cancelled) return;
      setClipboardReadPermission(state === 'granted' || state === 'denied' || state === 'prompt' ? state : 'unknown');
    };

    void permissions
      .query({ name: 'clipboard-read' as PermissionName })
      .then((nextStatus) => {
        status = nextStatus;
        handleChange = () => applyState(nextStatus.state);
        applyState(nextStatus.state);
        nextStatus.addEventListener('change', handleChange);
      })
      .catch(() => {
        if (!cancelled) setClipboardReadPermission('unknown');
      });

    return () => {
      cancelled = true;
      if (status !== undefined && handleChange !== undefined) {
        status.removeEventListener('change', handleChange);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (font === undefined || editableLayout === undefined || editableWorldOrigin === undefined) {
      delete window.__royalTextEditorProbe;
      return;
    }

    const origin = editableWorldOrigin;
    const range = sortedTextRange(selection);
    const placement = caretPlacement(editableLayout, selection.focus, selection.focusLine) ??
      editableLayout.caretPlacements.at(-1) ??
      { index: 0, line: 0, x: 0 };
    const hitTest = hitTestMetricsRef.current;
    const canvas = rendererTextCanvas();
    const menuCommandProbe = menuCommands.map((command): TextContextMenuCommandProbe => {
      const [clientX, clientY] = canvas === undefined
        ? [0, 0]
        : worldPointToCanvasClient(canvas, command.x + command.width / 2, command.y - command.height / 2);
      return { ...command, clientX, clientY };
    });
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
        const canvas = document.querySelector('canvas[aria-label="Renderer text editor"]');
        if (!(canvas instanceof HTMLCanvasElement)) return undefined;
        return nearestCaretPlacement(editableLayout, origin, canvas, clientX, clientY);
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
          const layout = layoutEditableText({
            font,
            fontSize,
            lineHeight,
            maxWidth: contentWidth,
            text: sampleText,
          });
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
      selectedText,
      clipboard: clipboardState,
      clipboardReadPermission,
      menu: {
        commands: menuCommandProbe,
        enabled: menuEnabled,
        failure: clipboardState.failure.active && clipboardState.failure.source === 'menu',
        failureReason: clipboardState.failure.source === 'menu' ? clipboardState.failure.reason : 'none',
        open: contextMenu.open,
        unavailableReason: {
          paste: menuEnabled.paste ? 'none' : customMenuPasteUnavailableReason,
        },
        x: contextMenu.x,
        y: contextMenu.y,
      },
      text: sampleText,
      textLength: sampleText.length,
    };

    window.__royalTextEditorProbe = probe;
    return () => {
      if (window.__royalTextEditorProbe === probe) {
        delete window.__royalTextEditorProbe;
      }
    };
  }, [
    clipboardReadPermission,
    clipboardState,
    contextMenu,
    editableLayout,
    editableWorldOrigin,
    font,
    menuCommands,
    menuEnabled,
    sampleText,
    selectedText,
    selection,
  ]);

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

  const recordClipboardResult = (result: ClipboardOperationResult): void => {
    const completed: ClipboardOperationResult & Pick<ClipboardResult, 'at'> = {
      ...result,
      at: performance.now(),
    };
    setClipboardState((current) => ({
      counters: incrementClipboardCounters(
        current.counters,
        completed.action,
        completed.source,
        !completed.ok,
      ),
      failure: !completed.ok
        ? {
            action: completed.action,
            active: true,
            message: completed.message,
            reason: completed.reason,
            source: completed.source,
          }
        : initialClipboardFailure,
      last: completed,
    }));
  };

  const recordKeyboardShortcut = (action: ClipboardAction): void => {
    setClipboardState((current) => ({
      ...current,
      counters: incrementKeyboardShortcutCounter(current.counters, action),
    }));
  };

  const clearPendingKeyboardPaste = (): void => {
    const pending = pendingKeyboardPasteRef.current;
    if (pending !== undefined) {
      window.clearTimeout(pending.timeoutId);
      pendingKeyboardPasteRef.current = undefined;
    }
  };

  const scheduleKeyboardPasteUnsupportedReport = (): void => {
    clearPendingKeyboardPaste();
    pendingKeyboardPasteRef.current = {
      timeoutId: window.setTimeout(() => {
        pendingKeyboardPasteRef.current = undefined;
        recordClipboardResult({
          action: 'paste',
          message: 'Browser did not dispatch a paste event to the focused canvas and clipboard-read permission is not granted',
          ok: false,
          reason: 'unavailable',
          source: 'native',
          textLength: 0,
        });
      }, 250),
    };
  };

  const runKeyboardClipboardShortcut = (action: ClipboardAction): void => {
    recordKeyboardShortcut(action);
    if (action === 'paste') {
      scheduleKeyboardPasteUnsupportedReport();
    }
  };

  const writeTextToSystemClipboard = async (
    text: string,
    action: 'copy' | 'cut',
    source: ClipboardSource,
  ): Promise<boolean> => {
    if (text === '') {
      recordClipboardResult({
        action,
        message: 'No selected text',
        ok: false,
        reason: 'empty-selection',
        source,
        textLength: 0,
      });
      return false;
    }

    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
      recordClipboardResult({
        action,
        message: 'navigator.clipboard.writeText is unavailable',
        ok: false,
        reason: 'unavailable',
        source,
        textLength: text.length,
      });
      return false;
    }

    try {
      await clipboard.writeText(text);
      recordClipboardResult({
        action,
        message: '',
        ok: true,
        reason: 'success',
        source,
        textLength: text.length,
      });
      return true;
    } catch (error) {
      recordClipboardResult({
        action,
        message: clipboardErrorMessage(error),
        ok: false,
        reason: clipboardErrorReason(error),
        source,
        textLength: text.length,
      });
      return false;
    }
  };

  const readTextFromNativeClipboard = async (source: ClipboardSource): Promise<boolean> => {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.readText !== 'function') {
      recordClipboardResult({
        action: 'paste',
        message: 'navigator.clipboard.readText is unavailable',
        ok: false,
        reason: 'unavailable',
        source,
        textLength: 0,
      });
      return false;
    }

    try {
      const pastedText = await clipboard.readText();
      if (pastedText === '') {
        recordClipboardResult({
          action: 'paste',
          message: 'Clipboard text was empty',
          ok: false,
          reason: 'empty-paste',
          source,
          textLength: 0,
        });
        return false;
      }

      replaceSelection(pastedText);
      recordClipboardResult({
        action: 'paste',
        message: '',
        ok: true,
        reason: 'success',
        source,
        textLength: pastedText.length,
      });
      return true;
    } catch (error) {
      recordClipboardResult({
        action: 'paste',
        message: clipboardErrorMessage(error),
        ok: false,
        reason: clipboardErrorReason(error),
        source,
        textLength: 0,
      });
      return false;
    }
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
    if (editableLayout === undefined || editableWorldOrigin === undefined) return undefined;

    const startedAt = performance.now();
    const placement = nearestCaretPlacement(
      editableLayout,
      editableWorldOrigin,
      event.currentTarget,
      event.clientX,
      event.clientY,
    );
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

    if ((event.metaKey || event.ctrlKey) && !event.altKey) {
      const shortcutKey = event.key.toLowerCase();
      if (shortcutKey === 'c' || shortcutKey === 'x' || shortcutKey === 'v') {
        const action = shortcutKey === 'c' ? 'copy' : shortcutKey === 'x' ? 'cut' : 'paste';
        runKeyboardClipboardShortcut(action);
        return;
      }
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

  const writeTextToClipboardEvent = (
    event: ClipboardEvent<HTMLCanvasElement>,
    action: 'copy' | 'cut',
  ): boolean => {
    if (selectedText === '') {
      event.preventDefault();
      recordClipboardResult({
        action,
        message: 'No selected text',
        ok: false,
        reason: 'empty-selection',
        source: 'native',
        textLength: 0,
      });
      return false;
    }

    try {
      event.clipboardData.setData('text/plain', selectedText);
      event.preventDefault();
      recordClipboardResult({
        action,
        message: '',
        ok: true,
        reason: 'success',
        source: 'native',
        textLength: selectedText.length,
      });
      return true;
    } catch (error) {
      recordClipboardResult({
        action,
        message: clipboardErrorMessage(error),
        ok: false,
        reason: clipboardErrorReason(error),
        source: 'native',
        textLength: selectedText.length,
      });
      return false;
    }
  };

  const handleCanvasCopy = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    writeTextToClipboardEvent(event, 'copy');
  };

  const handleCanvasCut = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    const didWrite = writeTextToClipboardEvent(event, 'cut');
    if (didWrite) replaceSelection('');
  };

  const handleCanvasPaste = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    clearPendingKeyboardPaste();
    let pastedText: string;
    try {
      pastedText = event.clipboardData.getData('text/plain');
    } catch (error) {
      recordClipboardResult({
        action: 'paste',
        message: clipboardErrorMessage(error),
        ok: false,
        reason: clipboardErrorReason(error),
        source: 'native',
        textLength: 0,
      });
      return;
    }

    if (pastedText === '') {
      recordClipboardResult({
        action: 'paste',
        message: 'Clipboard event text was empty',
        ok: false,
        reason: 'empty-paste',
        source: 'native',
        textLength: 0,
      });
      return;
    }

    event.preventDefault();
    replaceSelection(pastedText);
    recordClipboardResult({
      action: 'paste',
      message: '',
      ok: true,
      reason: 'success',
      source: 'native',
      textLength: pastedText.length,
    });
  };

  const handleCanvasCompositionEnd = (event: CompositionEvent<HTMLCanvasElement>): void => {
    if (event.data === '') return;
    replaceSelection(event.data);
  };

  const closeContextMenu = (): void => setContextMenu(closedTextContextMenu);

  const handleMenuCopy = (): void => {
    void writeTextToSystemClipboard(selectedText, 'copy', 'menu');
    closeContextMenu();
    focusRendererTextCanvas();
  };

  const handleMenuCut = (): void => {
    const cutText = selectedText;
    void writeTextToSystemClipboard(cutText, 'cut', 'menu').then((ok) => {
      if (ok) replaceSelection('');
    });
    closeContextMenu();
    focusRendererTextCanvas();
  };

  const handleMenuPaste = (): void => {
    void readTextFromNativeClipboard('menu');
    closeContextMenu();
    focusRendererTextCanvas();
  };

  const runContextMenuCommand = (action: ClipboardAction): void => {
    if (action === 'copy') {
      handleMenuCopy();
      return;
    }
    if (action === 'cut') {
      handleMenuCut();
      return;
    }
    handleMenuPaste();
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;

    if (contextMenu.open) {
      const [worldX, worldY] = canvasPointToWorld(event.currentTarget, event.clientX, event.clientY);
      const command = contextMenuCommandAt(menuCommands, worldX, worldY);
      if (command !== undefined) {
        event.preventDefault();
        pendingContextMenuCommandRef.current = command.enabled
          ? { action: command.action, pointerId: event.pointerId }
          : undefined;
        return;
      }
    }

    event.preventDefault();
    pendingContextMenuCommandRef.current = undefined;
    closeContextMenu();
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
    const pendingCommand = pendingContextMenuCommandRef.current;
    if (pendingCommand?.pointerId === event.pointerId) {
      pendingContextMenuCommandRef.current = undefined;
      event.preventDefault();
      const [worldX, worldY] = canvasPointToWorld(event.currentTarget, event.clientX, event.clientY);
      const command = contextMenuCommandAt(menuCommands, worldX, worldY);
      if (command?.enabled === true && command.action === pendingCommand.action) {
        runContextMenuCommand(command.action);
      }
      return;
    }

    const drag = dragStateRef.current;
    if (drag?.moved === true) {
      event.preventDefault();
      setCaretFromCanvasPoint(event, true, drag.anchor);
    }
    dragStateRef.current = undefined;
    pendingContextMenuCommandRef.current = undefined;
    releasePointer(event.currentTarget, event.pointerId);
  };

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    if (!hasSelection) {
      closeContextMenu();
      return;
    }
    const [worldX, worldY] = canvasPointToWorld(event.currentTarget, event.clientX, event.clientY);
    event.currentTarget.focus({ preventScroll: true });
    setFocused(true);
    setContextMenu({
      open: true,
      worldX,
      worldY,
      x: event.clientX,
      y: event.clientY,
    });
  };

  return createElement(Canvas, {
    'aria-label': 'Renderer text editor',
    'aria-multiline': true,
    'aria-roledescription': 'editable canvas text',
    'aria-valuetext': sampleText,
    children: scene,
    onBlur: () => setFocused(false),
    onCompositionEnd: handleCanvasCompositionEnd,
    onContextMenu: handleCanvasContextMenu,
    onCopy: handleCanvasCopy,
    onCut: handleCanvasCut,
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
  });
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

/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  unlitMaterial,
  type Rgba,
  type Vec3,
} from '@royal/renderer-core';
import {
  applyEditableTextEditorKeyInput,
  createEditableTextEditorState,
  createEditableTextFragment,
  editableTextCaretPlacement,
  editableTextClipboardMenuCommands,
  editableTextEditorCaretSelection,
  editableTextEditorContextMenuSelection,
  editableTextEditorPointerSelection,
  editableTextEditorSelectedRange,
  editableTextEditorSelectedText,
  editableTextMenuCommandAt,
  layoutEditableTextMenu,
  nearestEditableTextCaret,
  pasteEditableTextEditorText,
  setEditableTextEditorSelection,
  type EditableTextCaretEndpoint,
  type EditableTextCaretPlacement,
  type EditableTextFragment,
  type EditableTextLayout,
  type EditableTextMenuAction,
  type EditableTextMenuCommandRect,
  type EditableTextMenuLayout,
  type EditableTextSelection,
  type EditableTextSelectionRect,
  type TextFontFace,
} from '@royal/renderer-core/text';
import {
  Canvas,
  canvasPointToWorld,
  captureCanvasPointer,
  releaseCanvasPointer,
  worldPointToCanvasClient,
  type CanvasWorldBounds,
} from '@royal/react';
import {
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

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const cameraBounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const satisfies CanvasWorldBounds;

const origin: Vec3 = [-4.72, 1.35, 0];
const contentWidth = 7.1;
const editorTextColor: Rgba = [0.28, 0.95, 0.48, 1];
const labelColor: Rgba = [0.98, 0.94, 0.55, 1];
const noteColor: Rgba = [0.52, 0.9, 0.84, 1];
const defaultText = 'Click to place the caret. Drag to select text. Use Ctrl-C, Ctrl-X, and Ctrl-V.';
const fontSize = 0.52;
const lineHeight = fontSize * 1.2;
const caretWidth = 0.035;
const menuPasteUnavailableReason = 'custom-menu-paste-requires-native-paste-event';

const menuMaterial = unlitMaterial({ color: [0.07, 0.09, 0.11, 0.96] });
const menuItemMaterial = unlitMaterial({ color: [0.12, 0.15, 0.18, 1] });
const menuWidth = 1.34;
const menuItemHeight = 0.36;
const menuPadding = 0.08;
const menuGap = 0.025;
const menuZ = 0.28;
const menuBoundsMargin = 0.12;
const menuMetrics = {
  commandGap: menuGap,
  commandHeight: menuItemHeight,
  paddingX: menuPadding,
  paddingY: menuPadding,
  width: menuWidth,
} as const;
const menuLayoutBounds = {
  height: cameraBounds.top - cameraBounds.bottom - menuBoundsMargin * 2,
  width: cameraBounds.right - cameraBounds.left - menuBoundsMargin * 2,
  x: cameraBounds.left + menuBoundsMargin,
  y: menuBoundsMargin,
} as const;

type ClipboardAction = EditableTextMenuAction;
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
  readonly worldX: number;
  readonly worldY: number;
  readonly x: number;
  readonly y: number;
};

type TextContextMenuCommandProbe = {
  readonly action: ClipboardAction;
  readonly clientX: number;
  readonly clientY: number;
  readonly enabled: boolean;
  readonly height: number;
  readonly label: string;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type DragState = {
  readonly anchor: EditableTextCaretEndpoint;
  readonly moved: boolean;
};

type PendingMenuCommand = {
  readonly action: ClipboardAction;
  readonly pointerId: number;
};

type PendingKeyboardClipboard = {
  readonly action: ClipboardAction;
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
  readonly hitTestClientPoint: (clientX: number, clientY: number) => EditableTextCaretPlacement | undefined;
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
  readonly placements: readonly EditableTextCaretPlacement[];
  readonly selection: EditableTextSelection;
  readonly selectionRects: readonly EditableTextSelectionRect[];
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
      readonly paste: typeof menuPasteUnavailableReason | 'none';
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
  last: {
    action: 'none',
    at: 0,
    message: '',
    ok: false,
    reason: 'none',
    source: 'none',
    textLength: 0,
  },
};

const closedMenu: TextContextMenuState = {
  open: false,
  worldX: 0,
  worldY: 0,
  x: 0,
  y: 0,
};

const canvasElement = (): HTMLCanvasElement | undefined => {
  const canvas = document.querySelector('canvas[aria-label="Renderer text editor"]');
  return canvas instanceof HTMLCanvasElement ? canvas : undefined;
};

const focusCanvas = (): void => {
  canvasElement()?.focus({ preventScroll: true });
};

const worldToMenuPoint = (worldX: number, worldY: number): { readonly x: number; readonly y: number } => ({
  x: worldX,
  y: cameraBounds.top - worldY,
});

const menuYToWorldTop = (y: number): number => cameraBounds.top - y;

const clipboardErrorReason = (error: unknown): ClipboardReason =>
  error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'error';

const clipboardErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const incrementCounters = (
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

const incrementKeyboardCounter = (
  counters: ClipboardCounters,
  action: ClipboardAction,
): ClipboardCounters => ({
  ...counters,
  keyboardCopy: counters.keyboardCopy + (action === 'copy' ? 1 : 0),
  keyboardCut: counters.keyboardCut + (action === 'cut' ? 1 : 0),
  keyboardPaste: counters.keyboardPaste + (action === 'paste' ? 1 : 0),
});

const nearestCaretFromClientPoint = (
  layout: EditableTextLayout,
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): EditableTextCaretPlacement => {
  const [worldX, worldY] = canvasPointToWorld(canvas, cameraBounds, clientX, clientY);
  return nearestEditableTextCaret(layout, { x: worldX, y: worldY }, origin);
};

const menuLayoutFor = (
  menu: TextContextMenuState,
  enabled: { readonly copy: boolean; readonly cut: boolean; readonly paste: boolean },
): EditableTextMenuLayout | undefined =>
  layoutEditableTextMenu({
    anchor: worldToMenuPoint(menu.worldX, menu.worldY),
    bounds: menuLayoutBounds,
    commands: editableTextClipboardMenuCommands(enabled),
    metrics: menuMetrics,
    open: menu.open,
  });

const commandAt = (
  commands: readonly EditableTextMenuCommandRect[],
  worldX: number,
  worldY: number,
): EditableTextMenuCommandRect | undefined =>
  editableTextMenuCommandAt(commands, worldToMenuPoint(worldX, worldY));

const menuNodes = (
  font: TextFontFace,
  layout: EditableTextMenuLayout | undefined,
): readonly ReactNode[] => {
  if (layout === undefined) return [];

  const x = layout.bounds.x;
  const y = menuYToWorldTop(layout.bounds.y);
  const height = layout.bounds.height;
  const nodes: ReactNode[] = [
    (
      <mesh
        geometry={boxGeometry({ size: [menuWidth, height, 0.02] })}
        material={menuMaterial}
        transform={{
          position: [x + menuWidth / 2, y - height / 2, menuZ],
          rotation: [0, 0, 0],
        }}
      />
    ),
  ];

  for (const command of layout.commands) {
    const commandX = command.bounds.x;
    const commandY = menuYToWorldTop(command.bounds.y);
    nodes.push(
      (
        <mesh
          geometry={boxGeometry({ size: [command.bounds.width, command.bounds.height, 0.02] })}
          material={menuItemMaterial}
          transform={{
            position: [
              commandX + command.bounds.width / 2,
              commandY - command.bounds.height / 2,
              menuZ + 0.01,
            ],
            rotation: [0, 0, 0],
          }}
        />
      ),
      (
        <text
          color={command.enabled ? [0.92, 0.96, 0.98, 1] : [0.42, 0.47, 0.5, 1]}
          font={font}
          fontSize={0.18}
          lineHeight={0.24}
          origin={[commandX + 0.09, commandY - 0.095, menuZ + 0.03]}
          text={command.label}
        />
      ),
    );
  }

  return nodes;
};

const textScene = (
  font: TextFontFace,
  editor: EditableTextFragment,
  menuLayout: EditableTextMenuLayout | undefined,
): ReactNode => (
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
      <text
        color={labelColor}
        font={font}
        fontSize={0.56}
        lineHeight={0.68}
        origin={[-4.72, 2.42, 0]}
        text="Editable renderer text"
      />
      <text
        color={noteColor}
        font={font}
        fontSize={0.28}
        lineHeight={0.36}
        origin={[-4.72, 1.88, 0]}
        text="Caret placement, drag selection, native paste, and canvas context menu"
      />
      {editor.nodes}
      {menuNodes(font, menuLayout)}
    </pass>
  </scene>
);

export const RendererText = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const [state, setState] = useState(() => createEditableTextEditorState({ text: defaultText }));
  const [focused, setFocused] = useState(false);
  const [clipboard, setClipboard] = useState<ClipboardState>(initialClipboardState);
  const [menu, setMenu] = useState<TextContextMenuState>(closedMenu);
  const dragRef = useRef<DragState | undefined>(undefined);
  const pendingMenuCommandRef = useRef<PendingMenuCommand | undefined>(undefined);
  const pendingKeyboardClipboardRef = useRef<PendingKeyboardClipboard | undefined>(undefined);
  const hitTestRef = useRef({
    count: 0,
    lastClientX: 0,
    lastClientY: 0,
    lastIndex: -1,
    lastLine: -1,
    lastMs: 0,
    maxMs: 0,
  });
  const font = fontState.status === 'ready' ? fontState.font : undefined;
  const fragment = useMemo(
    () => font === undefined
      ? undefined
      : createEditableTextFragment({
          caretWidth,
          color: editorTextColor,
          font,
          fontSize,
          lineHeight,
          maxWidth: contentWidth,
          origin,
          selection: state.selection,
          showCaret: focused,
          text: state.text,
        }),
    [focused, font, state.selection, state.text],
  );
  const layout = fragment?.layout;
  const selectedRange = editableTextEditorSelectedRange(state);
  const selectedText = editableTextEditorSelectedText(state);
  const hasSelection = selectedRange.start !== selectedRange.end;
  const menuEnabled = {
    copy: hasSelection,
    cut: hasSelection,
    paste: false,
  } as const;
  const layoutMenu = menuLayoutFor(menu, menuEnabled);
  const menuCommands = layoutMenu?.commands ?? [];

  const recordClipboardResult = (result: Omit<ClipboardResult, 'at'>): void => {
    const completed = { ...result, at: performance.now() };
    setClipboard((current) => ({
      counters: result.action === 'none'
        ? current.counters
        : incrementCounters(current.counters, result.action, result.source as ClipboardSource, !result.ok),
      failure: result.ok || result.action === 'none'
        ? initialClipboardFailure
        : {
            action: result.action,
            active: true,
            message: result.message,
            reason: result.reason,
            source: result.source,
          },
      last: completed,
    }));
  };

  const recordKeyboardShortcut = (action: ClipboardAction): void => {
    setClipboard((current) => ({
      ...current,
      counters: incrementKeyboardCounter(current.counters, action),
    }));
  };

  const clearPendingKeyboardClipboard = (action?: ClipboardAction): void => {
    const pending = pendingKeyboardClipboardRef.current;
    if (pending === undefined || (action !== undefined && pending.action !== action)) return;
    window.clearTimeout(pending.timeoutId);
    pendingKeyboardClipboardRef.current = undefined;
  };

  const scheduleKeyboardClipboardUnsupportedReport = (action: ClipboardAction): void => {
    clearPendingKeyboardClipboard();
    const pending: PendingKeyboardClipboard = {
      action,
      timeoutId: window.setTimeout(() => {
        if (pendingKeyboardClipboardRef.current !== pending) return;
        pendingKeyboardClipboardRef.current = undefined;
        recordClipboardResult({
          action,
          message: `Browser did not dispatch a ${action} event to the focused canvas`,
          ok: false,
          reason: 'unavailable',
          source: 'native',
          textLength: 0,
        });
      }, 250),
    };
    pendingKeyboardClipboardRef.current = pending;
  };

  const replaceSelection = (text: string): void => {
    setState((current) => pasteEditableTextEditorText(current, text));
  };

  useEffect(() => () => {
    clearPendingKeyboardClipboard();
  }, []);

  useLayoutEffect(() => {
    if (font === undefined || fragment === undefined) {
      delete window.__royalTextEditorProbe;
      return;
    }

    const canvas = canvasElement();
    const caret = editableTextCaretPlacement(fragment.layout, fragment.selection.focus, fragment.selection.focusLine) ??
      fragment.layout.caretPlacements.at(-1) ??
      { index: 0, line: 0, x: 0 };
    const commandProbe = menuCommands.map((command): TextContextMenuCommandProbe => {
      const commandX = command.bounds.x;
      const commandY = menuYToWorldTop(command.bounds.y);
      const [clientX, clientY] = canvas === undefined
        ? [0, 0]
        : worldPointToCanvasClient(
            canvas,
            cameraBounds,
            commandX + command.bounds.width / 2,
            commandY - command.bounds.height / 2,
          );
      return {
        action: command.action,
        clientX,
        clientY,
        enabled: command.enabled,
        height: command.bounds.height,
        label: command.label,
        width: command.bounds.width,
        x: commandX,
        y: commandY,
      };
    });
    const hitTest = hitTestRef.current;
    const probe: TextEditorProbe = {
      caret: {
        height: fragment.layout.selectionHeight,
        index: caret.index,
        line: caret.line,
        x: origin[0] + caret.x,
        y: origin[1] - caret.line * fragment.layout.lineHeight + fragment.layout.selectionYOffset,
      },
      clipboard,
      clipboardReadPermission: 'unavailable',
      fontSize: fragment.layout.fontSize,
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
        const targetCanvas = canvasElement();
        return targetCanvas === undefined
          ? undefined
          : nearestCaretFromClientPoint(fragment.layout, targetCanvas, clientX, clientY);
      },
      layout: {
        lineCount: fragment.layout.lines.length,
        maxWidth: fragment.layout.maxWidth,
        selectionHeight: fragment.layout.selectionHeight,
        selectionYOffset: fragment.layout.selectionYOffset,
      },
      lineHeight: fragment.layout.lineHeight,
      measureFontSizes: (fontSizes) =>
        fontSizes.map((requestedFontSize) => {
          const nextFontSize = Number.isFinite(requestedFontSize) && requestedFontSize > 0
            ? requestedFontSize
            : fontSize;
          const nextLineHeight = nextFontSize * 1.2;
          const measured = createEditableTextFragment({
            color: editorTextColor,
            font,
            fontSize: nextFontSize,
            lineHeight: nextLineHeight,
            maxWidth: contentWidth,
            origin,
            selection: {
              anchor: 0,
              anchorLine: undefined,
              focus: state.text.length,
              focusLine: undefined,
            },
            text: state.text,
          });
          const heights = measured.selectionRects.map((rect) => rect.height);

          return {
            fontSize: nextFontSize,
            lineCount: measured.layout.lines.length,
            maxSelectionHeight: Math.max(measured.layout.selectionHeight, ...heights),
            minSelectionHeight: Math.min(measured.layout.selectionHeight, ...heights),
            selectionHeight: measured.layout.selectionHeight,
          };
        }),
      menu: {
        commands: commandProbe,
        enabled: menuEnabled,
        failure: clipboard.failure.active && clipboard.failure.source === 'menu',
        failureReason: clipboard.failure.source === 'menu' ? clipboard.failure.reason : 'none',
        open: menu.open,
        unavailableReason: {
          paste: menuEnabled.paste ? 'none' : menuPasteUnavailableReason,
        },
        x: menu.x,
        y: menu.y,
      },
      origin: {
        x: origin[0],
        y: origin[1],
      },
      placements: fragment.layout.caretPlacements,
      selectedText,
      selection: fragment.selection,
      selectionRects: fragment.selectionRects,
      text: state.text,
      textLength: state.text.length,
    };

    window.__royalTextEditorProbe = probe;
    return () => {
      if (window.__royalTextEditorProbe === probe) delete window.__royalTextEditorProbe;
    };
  }, [clipboard, font, fragment, menu, menuCommands, menuEnabled, selectedText, state.text]);

  const setCaretFromEvent = (
    event: ReactPointerEvent<HTMLCanvasElement>,
    extend: boolean,
    anchor?: EditableTextCaretEndpoint,
  ): EditableTextCaretEndpoint | undefined => {
    if (layout === undefined) return undefined;

    const startedAt = performance.now();
    const [worldX, worldY] = canvasPointToWorld(
      event.currentTarget,
      cameraBounds,
      event.clientX,
      event.clientY,
    );
    const anchoredState = anchor === undefined
      ? state
      : {
          ...state,
          selection: {
            ...state.selection,
            anchor: anchor.index,
            anchorLine: anchor.line,
          },
        };
    const nextSelection = editableTextEditorPointerSelection({
      extend,
      layout,
      origin,
      point: { x: worldX, y: worldY },
      state: anchoredState,
    });
    const elapsed = performance.now() - startedAt;
    hitTestRef.current = {
      count: hitTestRef.current.count + 1,
      lastClientX: event.clientX,
      lastClientY: event.clientY,
      lastIndex: nextSelection.focus,
      lastLine: nextSelection.focusLine ?? -1,
      lastMs: elapsed,
      maxMs: Math.max(hitTestRef.current.maxMs, elapsed),
    };
    setState((current) => setEditableTextEditorSelection(current, nextSelection));

    return { index: nextSelection.focus, line: nextSelection.focusLine };
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLCanvasElement>): void => {
    const { intent, state: nextState } = applyEditableTextEditorKeyInput(
      state,
      {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        keyCode: event.keyCode,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      { mode: 'multiline' },
    );
    if (intent === undefined) return;

    if (intent.type === 'clipboard-shortcut') {
      recordKeyboardShortcut(intent.shortcut);
      scheduleKeyboardClipboardUnsupportedReport(intent.shortcut);
      return;
    }

    event.preventDefault();
    if (
      layout !== undefined &&
      (
        intent.type === 'move-previous' ||
        intent.type === 'move-next' ||
        intent.type === 'move-start' ||
        intent.type === 'move-end'
      )
    ) {
      setState(setEditableTextEditorSelection(nextState, editableTextEditorCaretSelection({
        ...(intent.extend === undefined ? {} : { extend: intent.extend }),
        index: nextState.selection.focus,
        layout,
        state,
      })));
      return;
    }

    setState(nextState);
  };

  const writeClipboardEvent = (
    event: ClipboardEvent<HTMLCanvasElement>,
    action: 'copy' | 'cut',
  ): boolean => {
    clearPendingKeyboardClipboard(action);
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
  };

  const handleCopy = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    writeClipboardEvent(event, 'copy');
  };

  const handleCut = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    if (writeClipboardEvent(event, 'cut')) replaceSelection('');
  };

  const handlePaste = (event: ClipboardEvent<HTMLCanvasElement>): void => {
    clearPendingKeyboardClipboard('paste');
    const pastedText = event.clipboardData.getData('text/plain');
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

  const writeTextToSystemClipboard = async (
    action: 'copy' | 'cut',
    text: string,
  ): Promise<boolean> => {
    if (text === '') {
      recordClipboardResult({
        action,
        message: 'No selected text',
        ok: false,
        reason: 'empty-selection',
        source: 'menu',
        textLength: 0,
      });
      return false;
    }

    const clipboardApi = navigator.clipboard;
    if (clipboardApi === undefined || typeof clipboardApi.writeText !== 'function') {
      recordClipboardResult({
        action,
        message: 'navigator.clipboard.writeText is unavailable',
        ok: false,
        reason: 'unavailable',
        source: 'menu',
        textLength: text.length,
      });
      return false;
    }

    try {
      await clipboardApi.writeText(text);
      recordClipboardResult({
        action,
        message: '',
        ok: true,
        reason: 'success',
        source: 'menu',
        textLength: text.length,
      });
      return true;
    } catch (error) {
      recordClipboardResult({
        action,
        message: clipboardErrorMessage(error),
        ok: false,
        reason: clipboardErrorReason(error),
        source: 'menu',
        textLength: text.length,
      });
      return false;
    }
  };

  const runMenuCommand = (action: ClipboardAction): void => {
    if (action === 'paste') return;

    const text = selectedText;
    void writeTextToSystemClipboard(action, text).then((ok) => {
      if (ok && action === 'cut') replaceSelection('');
    });
    setMenu(closedMenu);
    focusCanvas();
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;

    if (menu.open) {
      const [worldX, worldY] = canvasPointToWorld(
        event.currentTarget,
        cameraBounds,
        event.clientX,
        event.clientY,
      );
      const command = commandAt(menuCommands, worldX, worldY);
      if (command !== undefined) {
        event.preventDefault();
        pendingMenuCommandRef.current = command.enabled
          ? { action: command.action, pointerId: event.pointerId }
          : undefined;
        return;
      }
    }

    event.preventDefault();
    pendingMenuCommandRef.current = undefined;
    setMenu(closedMenu);
    const clicked = setCaretFromEvent(event, event.shiftKey);
    event.currentTarget.focus({ preventScroll: true });
    setFocused(true);
    const anchor = event.shiftKey ? { index: state.selection.anchor, line: state.selection.anchorLine } : clicked;
    dragRef.current = anchor === undefined ? undefined : { anchor, moved: false };
    captureCanvasPointer(event.currentTarget, event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === undefined || (event.buttons & 1) === 0) return;
    event.preventDefault();
    dragRef.current = { ...drag, moved: true };
    setCaretFromEvent(event, true, drag.anchor);
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pendingCommand = pendingMenuCommandRef.current;
    if (pendingCommand?.pointerId === event.pointerId) {
      pendingMenuCommandRef.current = undefined;
      event.preventDefault();
      const [worldX, worldY] = canvasPointToWorld(
        event.currentTarget,
        cameraBounds,
        event.clientX,
        event.clientY,
      );
      const command = commandAt(menuCommands, worldX, worldY);
      if (command?.enabled === true && command.action === pendingCommand.action) {
        runMenuCommand(command.action);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag?.moved === true) {
      event.preventDefault();
      setCaretFromEvent(event, true, drag.anchor);
    }
    dragRef.current = undefined;
    pendingMenuCommandRef.current = undefined;
    releaseCanvasPointer(event.currentTarget, event.pointerId);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    if (layout === undefined) {
      setMenu(closedMenu);
      return;
    }

    const [worldX, worldY] = canvasPointToWorld(
      event.currentTarget,
      cameraBounds,
      event.clientX,
      event.clientY,
    );
    const nextSelection = editableTextEditorContextMenuSelection({
      layout,
      origin,
      point: { x: worldX, y: worldY },
      state,
    });
    event.currentTarget.focus({ preventScroll: true });
    setFocused(true);
    setState((current) => setEditableTextEditorSelection(current, nextSelection));
    setMenu({
      open: true,
      worldX,
      worldY,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const handleCompositionEnd = (event: CompositionEvent<HTMLCanvasElement>): void => {
    if (event.data !== '') replaceSelection(event.data);
  };

  return (
    <Canvas
      aria-label="Renderer text editor"
      aria-multiline
      aria-roledescription="editable canvas text"
      aria-valuetext={state.text}
      onBlur={() => setFocused(false)}
      onCompositionEnd={handleCompositionEnd}
      onContextMenu={handleContextMenu}
      onCopy={handleCopy}
      onCut={handleCut}
      onFocus={() => setFocused(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onPointerCancel={handlePointerEnd}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      role="textbox"
      renderer={renderer}
      tabIndex={0}
    >
      {font !== undefined && fragment !== undefined
        ? textScene(font, fragment, layoutMenu)
        : textScenePlaceholder}
    </Canvas>
  );
};

const textScenePlaceholder = (
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
    </pass>
  </scene>
);

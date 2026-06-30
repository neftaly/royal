/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  createEditableTextFragment,
  solidTexture,
  sortedEditableTextRange,
  type EditableTextSelection,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextFontFace,
  type Vec3,
  unlitMaterial,
} from '@royal/renderer-core';
import { Canvas, type CanvasWorldBounds } from '@royal/react';
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type CompositionEvent,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SyntheticEvent,
} from 'react';
import { useAtkinsonFont } from './text-font';

type HostMode = 'overlay' | 'offscreen';
type HostEventCounter =
  | 'beforeInput'
  | 'compositionEnd'
  | 'compositionStart'
  | 'compositionUpdate'
  | 'contextMenuCanvas'
  | 'contextMenuTextarea'
  | 'copy'
  | 'cut'
  | 'focus'
  | 'input'
  | 'keydown'
  | 'paste'
  | 'select';

type HostEventTarget = 'canvas' | 'textarea' | 'unknown';

type HostEventSnapshot = {
  readonly dataLength: number;
  readonly defaultPrevented: boolean;
  readonly inputType: string;
  readonly isComposing: boolean;
  readonly key: string;
  readonly mode: HostMode;
  readonly target: HostEventTarget;
  readonly type: string;
};

type HostEventState = {
  readonly counters: Readonly<Record<HostEventCounter, number>>;
  readonly last: HostEventSnapshot;
  readonly lastContextMenu: HostEventSnapshot;
};

type TextareaHostProbe = {
  readonly canvas: {
    readonly height: number;
    readonly width: number;
  };
  readonly eventState: HostEventState;
  readonly focusHost: () => void;
  readonly host: {
    readonly active: boolean;
    readonly display: string;
    readonly height: number;
    readonly left: number;
    readonly opacity: string;
    readonly pointerEvents: string;
    readonly top: number;
    readonly visibility: string;
    readonly width: number;
  };
  readonly internalClipboardCache: false;
  readonly mode: HostMode;
  readonly selectAll: () => void;
  readonly selectRange: (start: number, end: number) => void;
  readonly selectedLength: number;
  readonly selection: EditableTextSelection;
  readonly setMode: (mode: HostMode) => void;
  readonly text: string;
  readonly textLength: number;
};

declare global {
  interface Window {
    __royalTextareaHostProbe?: TextareaHostProbe;
  }
}

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const cameraBounds = {
  bottom: -3,
  left: -5,
  right: 5,
  top: 3,
} as const satisfies CanvasWorldBounds;

const textHostBounds = {
  height: 2.08,
  width: 7.72,
  x: -3.86,
  y: 1.06,
} as const;

const textOrigin: Vec3 = [textHostBounds.x + 0.2, textHostBounds.y - 0.32, 0.16];
const fontSize = 0.22;
const lineHeight = 0.32;
const textMaxWidth = textHostBounds.width - 0.4;
const defaultText =
  'Textarea host polyfill: the DOM textarea owns keyboard input, IME, selection, and native clipboard. The canvas underneath renders this text.';

const palette = {
  accent: [0.1, 0.58, 0.74, 1],
  bg: [0.034, 0.04, 0.046, 1],
  border: [0.2, 0.26, 0.31, 1],
  field: [0.065, 0.08, 0.092, 1],
  fieldOverlay: [0.08, 0.1, 0.115, 1],
  ink: [0.9, 0.95, 0.97, 1],
  muted: [0.54, 0.62, 0.66, 1],
  selection: [0.13, 0.34, 0.44, 0.86],
} as const satisfies Readonly<Record<string, Rgba>>;

const emptySelection = (index: number): EditableTextSelection => ({
  anchor: index,
  anchorLine: undefined,
  focus: index,
  focusLine: undefined,
});

const initialCounters: Readonly<Record<HostEventCounter, number>> = {
  beforeInput: 0,
  compositionEnd: 0,
  compositionStart: 0,
  compositionUpdate: 0,
  contextMenuCanvas: 0,
  contextMenuTextarea: 0,
  copy: 0,
  cut: 0,
  focus: 0,
  input: 0,
  keydown: 0,
  paste: 0,
  select: 0,
};

const initialEventState: HostEventState = {
  counters: initialCounters,
  last: {
    dataLength: 0,
    defaultPrevented: false,
    inputType: '',
    isComposing: false,
    key: '',
    mode: 'overlay',
    target: 'unknown',
    type: 'none',
  },
  lastContextMenu: {
    dataLength: 0,
    defaultPrevented: false,
    inputType: '',
    isComposing: false,
    key: '',
    mode: 'overlay',
    target: 'unknown',
    type: 'none',
  },
};

const material = (color: Rgba) =>
  unlitMaterial({ baseColor: solidTexture({ color }) });

const rect = (
  color: Rgba,
  width: number,
  height: number,
  position: Vec3,
): RenderNode =>
  (
    <mesh
      geometry={boxGeometry({ size: [width, height, 0.02] })}
      material={material(color)}
      transform={{ position, rotation: [0, 0, 0] }}
    />
  ) as RenderNode;

const rectFromTopLeft = (
  color: Rgba,
  x: number,
  y: number,
  width: number,
  height: number,
  z = 0,
): RenderNode =>
  rect(color, width, height, [x + width / 2, y - height / 2, z]);

const textNode = (
  text: string,
  origin: Vec3,
  color: Rgba,
  font?: TextFontFace,
  size = 0.2,
  line = 0.28,
): RenderNode =>
  (
    <text
      color={color}
      {...(font === undefined ? {} : { font })}
      fontSize={size}
      lineHeight={line}
      origin={origin}
      text={text}
    />
  ) as RenderNode;

const textHostScene = (
  text: string,
  selection: EditableTextSelection,
  focused: boolean,
  mode: HostMode,
  font?: TextFontFace,
): RenderRoot => {
  const fragment = createEditableTextFragment({
    color: palette.ink,
    ...(font === undefined ? {} : { font }),
    caretColor: palette.accent,
    caretWidth: 0.028,
    fontSize,
    lineHeight,
    maxWidth: textMaxWidth,
    origin: textOrigin,
    placeholder: 'Type through the textarea host',
    placeholderColor: palette.muted,
    selection,
    selectionColor: palette.selection,
    showCaret: focused,
    text,
  });
  const range = sortedEditableTextRange(selection);
  const selectedLabel = range.start === range.end
    ? 'selection: collapsed'
    : `selection: ${range.start}-${range.end}`;

  return (
    <scene>
      <pass clearColor={palette.bg}>
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
        {rectFromTopLeft(palette.field, textHostBounds.x, textHostBounds.y, textHostBounds.width, textHostBounds.height, 0)}
        {rectFromTopLeft(
          mode === 'overlay' ? palette.accent : palette.border,
          textHostBounds.x - 0.035,
          textHostBounds.y + 0.035,
          textHostBounds.width + 0.07,
          textHostBounds.height + 0.07,
          -0.02,
        )}
        {rectFromTopLeft(palette.fieldOverlay, -4.3, 2.66, 8.6, 0.58, 0)}
        {textNode('Textarea-backed text host probe', [-4.08, 2.35, 0.18], palette.ink, font, 0.32, 0.42)}
        {textNode(
          mode === 'overlay'
            ? 'overlay mode: textarea receives pointer and native contextmenu'
            : 'offscreen mode: textarea stays focused, pointer contextmenu targets canvas',
          [-4.08, 2.02, 0.18],
          palette.muted,
          font,
          0.16,
          0.22,
        )}
        {fragment.nodes}
        {textNode(selectedLabel, [textHostBounds.x, -1.5, 0.18], palette.muted, font, 0.15, 0.22)}
      </pass>
    </scene>
  ) as RenderRoot;
};

const percent = (value: number): string => `${value * 100}%`;

const overlayFrameStyle = (): CSSProperties => {
  const width = cameraBounds.right - cameraBounds.left;
  const height = cameraBounds.top - cameraBounds.bottom;

  return {
    height: percent(textHostBounds.height / height),
    left: percent((textHostBounds.x - cameraBounds.left) / width),
    top: percent((cameraBounds.top - textHostBounds.y) / height),
    width: percent(textHostBounds.width / width),
  };
};

const targetFromEvent = (event: SyntheticEvent, textarea: HTMLTextAreaElement | null): HostEventTarget => {
  if (event.currentTarget === textarea) return 'textarea';
  if (event.currentTarget instanceof HTMLCanvasElement) return 'canvas';
  return 'unknown';
};

const inputEventDetails = (event: FormEvent<HTMLTextAreaElement>) => {
  const native = event.nativeEvent;
  return native instanceof InputEvent
    ? {
        dataLength: native.data?.length ?? 0,
        inputType: native.inputType,
        isComposing: native.isComposing,
      }
    : {
        dataLength: 0,
        inputType: '',
        isComposing: false,
      };
};

const clampSelectionIndex = (text: string, index: number): number =>
  Math.max(0, Math.min(text.length, Number.isFinite(index) ? index : 0));

const selectionFromTextarea = (textarea: HTMLTextAreaElement): EditableTextSelection => ({
  anchor: textarea.selectionStart,
  anchorLine: undefined,
  focus: textarea.selectionEnd,
  focusLine: undefined,
});

const textareaHostCanvas = (): HTMLCanvasElement | null => {
  const canvas = document.querySelector('canvas[aria-label="Textarea text host canvas"]');
  return canvas instanceof HTMLCanvasElement ? canvas : null;
};

const routeStyle: CSSProperties = {
  display: 'grid',
  gap: '1rem',
  minHeight: '100%',
  padding: '1.25rem',
};

const headingStyle: CSSProperties = {
  borderBottom: '1px solid var(--line)',
  display: 'grid',
  gap: '0.35rem',
  paddingBottom: '1rem',
};

const controlsStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.55rem',
};

const modeButtonStyle = (active: boolean): CSSProperties => ({
  background: active ? 'var(--accent)' : 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  color: active ? 'Canvas' : 'var(--fg)',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 700,
  padding: '0.45rem 0.65rem',
});

const utilityButtonStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  color: 'var(--accent-strong)',
  cursor: 'pointer',
  font: 'inherit',
  fontWeight: 700,
  padding: '0.45rem 0.65rem',
};

const hostFrameStyle: CSSProperties = {
  aspectRatio: '16 / 10',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  boxShadow: 'var(--shadow)',
  minHeight: '28rem',
  overflow: 'hidden',
  position: 'relative',
};

const canvasStyle: CSSProperties = {
  inset: 0,
  position: 'absolute',
};

const baseTextareaStyle: CSSProperties = {
  borderRadius: '5px',
  font:
    '18px / 1.36 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  outline: 'none',
  resize: 'none',
  whiteSpace: 'pre-wrap',
};

const overlayTextareaStyle: CSSProperties = {
  ...baseTextareaStyle,
  ...overlayFrameStyle(),
  background: 'rgb(255 255 255 / 0.025)',
  border: '1px solid rgb(114 212 189 / 0.45)',
  caretColor: 'rgb(114 212 189)',
  color: 'transparent',
  overflow: 'hidden',
  padding: '0.65rem',
  position: 'absolute',
  zIndex: 2,
};

const offscreenTextareaStyle: CSSProperties = {
  ...baseTextareaStyle,
  height: '1px',
  left: 0,
  opacity: 0,
  pointerEvents: 'none',
  position: 'fixed',
  top: 0,
  transform: 'translate(-10000px, -10000px)',
  width: '1px',
  zIndex: -1,
};

const reportStyle: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '8px',
  display: 'grid',
  gap: '0.45rem',
  padding: '0.85rem',
};

const reportGridStyle: CSSProperties = {
  display: 'grid',
  gap: '0.45rem',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
};

const reportItemStyle: CSSProperties = {
  background: 'var(--panel-strong)',
  border: '1px solid var(--line)',
  borderRadius: '6px',
  display: 'grid',
  gap: '0.18rem',
  padding: '0.55rem',
};

const reportLabelStyle: CSSProperties = {
  color: 'var(--muted)',
  fontSize: '0.72rem',
  fontWeight: 750,
  letterSpacing: 0,
  textTransform: 'uppercase',
};

const reportValueStyle: CSSProperties = {
  fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
  fontSize: '0.82rem',
  overflowWrap: 'anywhere',
};

export const TextareaTextHostPolyfill = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const font = fontState.status === 'ready' ? fontState.font : undefined;
  const [hostMode, setHostMode] = useState<HostMode>('overlay');
  const [text, setText] = useState(defaultText);
  const [selection, setSelection] = useState<EditableTextSelection>(
    emptySelection(defaultText.length),
  );
  const [focused, setFocused] = useState(false);
  const [eventState, setEventState] = useState<HostEventState>(initialEventState);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scene = useMemo(
    () => textHostScene(text, selection, focused, hostMode, font),
    [focused, font, hostMode, selection, text],
  );

  const recordEvent = useCallback((
    counter: HostEventCounter,
    type: string,
    event: SyntheticEvent,
    details: Partial<Omit<HostEventSnapshot, 'defaultPrevented' | 'mode' | 'target' | 'type'>> = {},
  ): void => {
    const target = targetFromEvent(event, textareaRef.current);
    const defaultPrevented = event.defaultPrevented;

    setEventState((current) => ({
      counters: {
        ...current.counters,
        [counter]: current.counters[counter] + 1,
      },
      last: {
        dataLength: details.dataLength ?? 0,
        defaultPrevented,
        inputType: details.inputType ?? '',
        isComposing: details.isComposing ?? false,
        key: details.key ?? '',
        mode: hostMode,
        target,
        type,
      },
      lastContextMenu: type === 'contextmenu'
        ? {
            dataLength: details.dataLength ?? 0,
            defaultPrevented,
            inputType: details.inputType ?? '',
            isComposing: details.isComposing ?? false,
            key: details.key ?? '',
            mode: hostMode,
            target,
            type,
          }
        : current.lastContextMenu,
    }));
  }, [hostMode]);

  const syncSelectionFromTextarea = useCallback((textarea: HTMLTextAreaElement): void => {
    setSelection(selectionFromTextarea(textarea));
  }, []);

  const focusHost = useCallback((): void => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    textarea.focus({ preventScroll: true });
    setFocused(true);
    syncSelectionFromTextarea(textarea);
  }, [syncSelectionFromTextarea]);

  const selectRange = useCallback((start: number, end: number): void => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const nextStart = clampSelectionIndex(textarea.value, start);
    const nextEnd = clampSelectionIndex(textarea.value, end);
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(Math.min(nextStart, nextEnd), Math.max(nextStart, nextEnd), 'forward');
    setFocused(true);
    syncSelectionFromTextarea(textarea);
  }, [syncSelectionFromTextarea]);

  const selectAll = useCallback((): void => {
    selectRange(0, text.length);
  }, [selectRange, text.length]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => focusHost());
    return () => window.cancelAnimationFrame(frame);
  }, [focusHost, hostMode]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    const canvas = textareaHostCanvas();
    const textareaRect = textarea?.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect();
    const style = textarea === null ? undefined : window.getComputedStyle(textarea);
    const range = sortedEditableTextRange(selection);
    const probe: TextareaHostProbe = {
      canvas: {
        height: canvasRect?.height ?? 0,
        width: canvasRect?.width ?? 0,
      },
      eventState,
      focusHost,
      host: {
        active: document.activeElement === textarea,
        display: style?.display ?? '',
        height: textareaRect?.height ?? 0,
        left: textareaRect?.left ?? 0,
        opacity: style?.opacity ?? '',
        pointerEvents: style?.pointerEvents ?? '',
        top: textareaRect?.top ?? 0,
        visibility: style?.visibility ?? '',
        width: textareaRect?.width ?? 0,
      },
      internalClipboardCache: false,
      mode: hostMode,
      selectAll,
      selectRange,
      selectedLength: range.end - range.start,
      selection,
      setMode: (mode) => {
        setHostMode(mode === 'offscreen' ? 'offscreen' : 'overlay');
      },
      text,
      textLength: text.length,
    };

    window.__royalTextareaHostProbe = probe;
    return () => {
      if (window.__royalTextareaHostProbe === probe) {
        delete window.__royalTextareaHostProbe;
      }
    };
  }, [
    eventState,
    focusHost,
    hostMode,
    selectAll,
    selectRange,
    selection,
    text,
  ]);

  const handleHostBeforeInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    recordEvent('beforeInput', 'beforeinput', event, inputEventDetails(event));
  };

  const handleHostInput = (event: FormEvent<HTMLTextAreaElement>): void => {
    const textarea = event.currentTarget;
    setText(textarea.value);
    syncSelectionFromTextarea(textarea);
    recordEvent('input', 'input', event, inputEventDetails(event));
  };

  const handleHostSelect = (event: SyntheticEvent<HTMLTextAreaElement>): void => {
    syncSelectionFromTextarea(event.currentTarget);
    recordEvent('select', 'select', event);
  };

  const handleHostClipboardEvent = (
    counter: 'copy' | 'cut' | 'paste',
    event: ClipboardEvent<HTMLTextAreaElement>,
  ): void => {
    recordEvent(counter, counter, event);
  };

  const handleHostComposition = (
    counter: 'compositionEnd' | 'compositionStart' | 'compositionUpdate',
    type: string,
    event: CompositionEvent<HTMLTextAreaElement>,
  ): void => {
    recordEvent(counter, type, event, {
      dataLength: event.data.length,
      isComposing: counter !== 'compositionEnd',
    });
  };

  const handleHostKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    recordEvent('keydown', 'keydown', event, {
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
    });
  };

  const handleHostContextMenu = (event: ReactMouseEvent<HTMLTextAreaElement>): void => {
    recordEvent('contextMenuTextarea', 'contextmenu', event);
  };

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (hostMode !== 'offscreen' || event.button !== 0) return;
    event.preventDefault();
    focusHost();
  };

  const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>): void => {
    if (hostMode !== 'offscreen') return;
    recordEvent('contextMenuCanvas', 'contextmenu', event);
  };

  const textareaStyle = hostMode === 'overlay'
    ? overlayTextareaStyle
    : offscreenTextareaStyle;
  const counterText = `key ${eventState.counters.keydown} / beforeinput ${eventState.counters.beforeInput} / input ${eventState.counters.input}`;
  const clipboardText = `copy ${eventState.counters.copy} / cut ${eventState.counters.cut} / paste ${eventState.counters.paste}`;
  const contextMenuText = `textarea ${eventState.counters.contextMenuTextarea} / canvas ${eventState.counters.contextMenuCanvas}`;

  return createElement(
    'section',
    {
      'data-text-host-polyfill': '',
      style: routeStyle,
    },
    createElement(
      'header',
      { style: headingStyle },
      createElement('h1', { style: { letterSpacing: 0, margin: 0 } }, 'Textarea Text Host Polyfill'),
      createElement(
        'p',
        { style: { color: 'var(--muted)', lineHeight: 1.5, margin: 0, maxWidth: '68rem' } },
        'Research route only. A native textarea owns input, IME, selection, and browser clipboard events while Royal renders the visible text on canvas.',
      ),
      createElement(
        'div',
        { 'aria-label': 'Text host positioning mode', role: 'group', style: controlsStyle },
        createElement(
          'button',
          {
            'aria-pressed': hostMode === 'overlay',
            onClick: () => setHostMode('overlay'),
            style: modeButtonStyle(hostMode === 'overlay'),
            type: 'button',
          },
          'Overlay',
        ),
        createElement(
          'button',
          {
            'aria-pressed': hostMode === 'offscreen',
            onClick: () => setHostMode('offscreen'),
            style: modeButtonStyle(hostMode === 'offscreen'),
            type: 'button',
          },
          'Offscreen',
        ),
        createElement(
          'button',
          {
            onClick: selectAll,
            style: utilityButtonStyle,
            type: 'button',
          },
          'Select All',
        ),
        createElement(
          'button',
          {
            onClick: focusHost,
            style: utilityButtonStyle,
            type: 'button',
          },
          'Focus Host',
        ),
      ),
    ),
    createElement(
      'div',
      { style: hostFrameStyle },
      createElement(Canvas, {
        'aria-hidden': true,
        'aria-label': 'Textarea text host canvas',
        children: scene,
        onContextMenu: handleCanvasContextMenu,
        onPointerDown: handleCanvasPointerDown,
        rootOptions,
        style: canvasStyle,
      }),
      createElement('textarea', {
        'aria-label': 'Textarea-backed text host',
        'data-text-host-mode': hostMode,
        onBeforeInput: handleHostBeforeInput,
        onBlur: () => setFocused(false),
        onCompositionEnd: (event) => handleHostComposition('compositionEnd', 'compositionend', event),
        onCompositionStart: (event) => handleHostComposition('compositionStart', 'compositionstart', event),
        onCompositionUpdate: (event) => handleHostComposition('compositionUpdate', 'compositionupdate', event),
        onContextMenu: handleHostContextMenu,
        onCopy: (event) => handleHostClipboardEvent('copy', event),
        onCut: (event) => handleHostClipboardEvent('cut', event),
        onFocus: (event) => {
          setFocused(true);
          recordEvent('focus', 'focus', event);
        },
        onInput: handleHostInput,
        onKeyDown: handleHostKeyDown,
        onPaste: (event) => handleHostClipboardEvent('paste', event),
        onSelect: handleHostSelect,
        ref: textareaRef,
        spellCheck: false,
        style: textareaStyle,
        value: text,
      }),
    ),
    createElement(
      'section',
      { 'aria-label': 'Text host probe report', style: reportStyle },
      createElement('h2', { style: { fontSize: '1rem', letterSpacing: 0, margin: 0 } }, 'Probe'),
      createElement(
        'div',
        { style: reportGridStyle },
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Mode'),
          createElement('span', { 'data-text-host-report-mode': '', style: reportValueStyle }, hostMode),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Focus'),
          createElement(
            'span',
            { 'data-text-host-report-focus': '', style: reportValueStyle },
            focused ? 'textarea focused' : 'not focused',
          ),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Selection'),
          createElement(
            'span',
            { 'data-text-host-report-selection': '', style: reportValueStyle },
            `${selection.anchor}:${selection.focus}`,
          ),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Input Events'),
          createElement('span', { 'data-text-host-report-input': '', style: reportValueStyle }, counterText),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Clipboard Events'),
          createElement('span', { 'data-text-host-report-clipboard': '', style: reportValueStyle }, clipboardText),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Contextmenu Target'),
          createElement('span', { 'data-text-host-report-contextmenu': '', style: reportValueStyle }, contextMenuText),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Last Event'),
          createElement(
            'span',
            { 'data-text-host-report-last': '', style: reportValueStyle },
            `${eventState.last.type} -> ${eventState.last.target}`,
          ),
        ),
        createElement(
          'div',
          { style: reportItemStyle },
          createElement('span', { style: reportLabelStyle }, 'Clipboard Cache'),
          createElement(
            'span',
            { 'data-text-host-report-cache': '', style: reportValueStyle },
            'none',
          ),
        ),
      ),
    ),
  );
};

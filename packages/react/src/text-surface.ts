import {
  boxGeometry,
  mesh,
  text,
  unlitMaterial,
  type RenderNode,
  type Rgba,
  type Vec3,
} from "@royal/renderer-core";
import {
  applyEditableTextEditorKeyInput,
  collapseEditableTextEditorSelection,
  createEditableTextEditorState,
  createEditableTextFragment,
  editableTextClipboardMenuCommands,
  editableTextEditorCaretSelection,
  editableTextEditorContextMenuSelection,
  editableTextEditorPointerSelection,
  editableTextEditorSelectedRange,
  editableTextEditorSelectedText,
  editableTextMenuCommandAt,
  layoutEditableTextMenu,
  pasteEditableTextEditorText,
  sameEditableTextSelection,
  setEditableTextEditorSelection,
  type EditableTextCaretEndpoint,
  type EditableTextEditorState,
  type EditableTextFragmentMode,
  type EditableTextLayout,
  type EditableTextMenuAction,
  type EditableTextMenuCommandRect,
  type EditableTextMenuLayout,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { TextFontFace } from "@royal/renderer-core/text/font";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useStore } from "zustand/react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { Canvas, type CanvasProps } from "./canvas";
import { canvasPointToWorld, type CanvasWorldBounds } from "./canvas-coordinate";
import { captureCanvasPointer, releaseCanvasPointer } from "./canvas-pointer";
import { rendererOutputToReact } from "./renderer-output";

export type TextControlMode = EditableTextFragmentMode;

export interface TextInteractionStyle {
  readonly backgroundColor?: Rgba;
  readonly caretColor?: Rgba;
  readonly caretWidth?: number;
  readonly color?: Rgba;
  readonly fieldColor?: Rgba;
  readonly fieldPaddingX?: number;
  readonly fieldPaddingY?: number;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly menuColor?: Rgba;
  readonly menuItemColor?: Rgba;
  readonly placeholderColor?: Rgba;
  readonly selectionColor?: Rgba;
}

export type TextSurfaceBox = {
  readonly height?: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly z?: number;
};

export type TextFieldHeightOptions = {
  readonly lineHeight?: number;
  readonly paddingY?: number;
  readonly rows?: number;
};

export interface TextSurfaceProps
  extends Omit<
    CanvasProps,
    | "children"
    | "onBlur"
    | "onCompositionEnd"
    | "onContextMenu"
    | "onKeyDown"
    | "onPointerCancel"
    | "onPointerDown"
    | "onPointerMove"
    | "onPointerUp"
    | "ref"
    | "role"
    | "tabIndex"
  > {
  readonly bounds?: CanvasWorldBounds;
  readonly children: CanvasProps["children"];
  readonly styleOptions?: TextInteractionStyle;
}

export interface TextPrimitiveProps {
  readonly box?: TextSurfaceBox;
  readonly children?: ReactNode;
  readonly color?: Rgba;
  readonly copyable?: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly maxWidth?: number;
  readonly origin?: Vec3;
  readonly selectable?: boolean;
  readonly text?: string;
}

export interface TextFieldPrimitiveProps {
  readonly ariaLabel?: string;
  readonly box?: TextSurfaceBox;
  readonly color?: Rgba;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly maxWidth?: number;
  readonly onValueChange?: (value: string) => void;
  readonly origin?: Vec3;
  readonly placeholder?: string;
  readonly value: string;
}

export interface TextAreaPrimitiveProps extends TextFieldPrimitiveProps {
  readonly rows?: number;
}

type ClipboardAction = EditableTextMenuAction;
type ClipboardSource = "keyboard" | "menu";

type TextControlBounds = {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

type TextControlRegistration = {
  readonly bounds: TextControlBounds;
  readonly copyable: boolean;
  readonly editable: boolean;
  readonly font?: TextFontFace;
  readonly id: string;
  readonly layout: EditableTextLayout;
  readonly mode: TextControlMode;
  readonly onValueChange?: (value: string) => void;
  readonly origin: Vec3;
  readonly selectable: boolean;
  readonly selectedText: string;
  readonly selection: EditableTextSelection;
  readonly state: EditableTextEditorState;
  readonly text: string;
};

type PendingMenuCommand = {
  readonly action: ClipboardAction;
  readonly controlId: string;
  readonly pointerId: number;
};

type DragState = {
  readonly anchor: EditableTextCaretEndpoint;
  readonly controlId: string;
  readonly moved: boolean;
};

type TextMenuState = {
  readonly controlId: string | undefined;
  readonly open: boolean;
  readonly worldX: number;
  readonly worldY: number;
};

type TextSurfaceStoreState = {
  readonly activeId: string | undefined;
  readonly applyEditorState: (id: string, state: EditableTextEditorState) => void;
  readonly clearSelectionsExcept: (id: string | undefined) => void;
  readonly closeMenu: () => void;
  readonly getControl: (id: string) => TextControlRegistration | undefined;
  readonly getControls: () => readonly TextControlRegistration[];
  readonly menu: TextMenuState;
  readonly registerControl: (control: TextControlRegistration) => void;
  readonly selections: ReadonlyMap<string, EditableTextSelection>;
  readonly setActiveId: (id: string | undefined) => void;
  readonly setMenu: (menu: TextMenuState) => void;
  readonly unregisterControl: (id: string) => void;
};

type TextSurfaceStore = StoreApi<TextSurfaceStoreState>;

type TextSurfaceContextValue = {
  readonly activeId: string | undefined;
  readonly bounds: CanvasWorldBounds;
  readonly menu: TextMenuState;
  readonly menuLayoutFor: (control: TextControlRegistration) => EditableTextMenuLayout | undefined;
  readonly registerControl: (control: TextControlRegistration) => void;
  readonly store: TextSurfaceStore;
  readonly style: Required<TextInteractionStyle>;
  readonly unregisterControl: (id: string) => void;
};

const defaultSurfaceBounds = {
  bottom: -3.2,
  left: -5.6,
  right: 5.6,
  top: 3.2,
} as const satisfies CanvasWorldBounds;

const defaultTextStyle = {
  backgroundColor: [0.025, 0.032, 0.038, 1],
  caretColor: [0.98, 0.94, 0.55, 1],
  caretWidth: 0.035,
  color: [0.92, 0.96, 0.98, 1],
  fieldColor: [0.07, 0.09, 0.11, 0.9],
  fieldPaddingX: 0.14,
  fieldPaddingY: 0.11,
  fontSize: 0.42,
  lineHeight: 0.5,
  menuColor: [0.07, 0.09, 0.11, 0.96],
  menuItemColor: [0.12, 0.15, 0.18, 1],
  placeholderColor: [0.55, 0.62, 0.62, 1],
  selectionColor: [0.08, 0.28, 0.42, 1],
} as const satisfies Required<TextInteractionStyle>;

export const textFieldHeight = ({
  lineHeight = defaultTextStyle.lineHeight,
  paddingY = defaultTextStyle.fieldPaddingY,
  rows = 1,
}: TextFieldHeightOptions = {}): number =>
  Math.max(1, rows) * lineHeight + paddingY * 2;

const closedMenu: TextMenuState = {
  controlId: undefined,
  open: false,
  worldX: 0,
  worldY: 0,
};

const TextSurfaceContext = createContext<TextSurfaceContextValue | undefined>(undefined);

const menuWidth = 1.34;
const menuItemHeight = 0.36;
const menuPadding = 0.08;
const menuGap = 0.025;
const menuZ = 0.28;
const menuBoundsMargin = 0.12;
const menuTextFontSize = 0.18;
const menuTextLineHeight = 0.24;
const menuTextInsetX = 0.09;

const textFromChildren = (children: ReactNode): string => {
  if (children === null || children === undefined || typeof children === "boolean") return "";
  if (typeof children === "string" || typeof children === "number" || typeof children === "bigint") {
    return String(children);
  }
  if (Array.isArray(children)) return children.map(textFromChildren).join("");

  throw new Error("Royal text primitives only accept text children.");
};

const textBaselineForVerticalCenter = (
  font: TextFontFace | undefined,
  fontSizeValue: number,
  topY: number,
  height: number,
): number => {
  if (font === undefined) return topY - height * 0.62;

  const scale = fontSizeValue / font.unitsPerEm;
  const visualCenterFromBaseline = ((font.ascender + font.descender) * scale) / 2;
  return topY - height / 2 - visualCenterFromBaseline;
};

const menuYToWorldTop = (bounds: CanvasWorldBounds, y: number): number => bounds.top - y;

const worldToMenuPoint = (
  bounds: CanvasWorldBounds,
  worldX: number,
  worldY: number,
): { readonly x: number; readonly y: number } => ({
  x: worldX,
  y: bounds.top - worldY,
});

const menuLayoutBoundsFor = (bounds: CanvasWorldBounds) => ({
  height: bounds.top - bounds.bottom - menuBoundsMargin * 2,
  width: bounds.right - bounds.left - menuBoundsMargin * 2,
  x: bounds.left + menuBoundsMargin,
  y: menuBoundsMargin,
});

const hasSelection = (control: TextControlRegistration): boolean => {
  const range = editableTextEditorSelectedRange(control.state);
  return range.start !== range.end;
};

const sameMenuState = (left: TextMenuState, right: TextMenuState): boolean =>
  left.controlId === right.controlId &&
  left.open === right.open &&
  left.worldX === right.worldX &&
  left.worldY === right.worldY;

const withSelection = (
  control: TextControlRegistration,
  nextSelection: EditableTextSelection,
): TextControlRegistration => {
  const state = createEditableTextEditorState({
    selection: nextSelection,
    text: control.text,
  });

  return {
    ...control,
    selectedText: editableTextEditorSelectedText(state),
    selection: state.selection,
    state,
  };
};

const createTextSurfaceStore = (): TextSurfaceStore => {
  let controls = new Map<string, TextControlRegistration>();

  return createStore<TextSurfaceStoreState>()((set, get) => {
    const setSelection = (id: string, selection: EditableTextSelection): void => {
      const current = get().selections.get(id);
      if (current !== undefined && sameEditableTextSelection(current, selection)) return;

      const nextSelections = new Map(get().selections).set(id, selection);
      const control = controls.get(id);
      if (control !== undefined) {
        controls = new Map(controls).set(id, withSelection(control, selection));
      }
      set({ selections: nextSelections });
    };

    return {
      activeId: undefined,
      applyEditorState: (id, nextState) => {
        const control = controls.get(id);
        setSelection(id, nextState.selection);
        if (control !== undefined && control.text !== nextState.text) {
          control.onValueChange?.(nextState.text);
        }
      },
      clearSelectionsExcept: (id) => {
        let changed = false;
        let nextControls = controls;
        let nextSelections = get().selections;

        for (const control of controls.values()) {
          if (control.id === id || !hasSelection(control)) continue;
          const nextState = collapseEditableTextEditorSelection(
            control.state,
            control.state.selection.focus,
            control.layout,
          );
          const current = nextSelections.get(control.id);
          if (current !== undefined && sameEditableTextSelection(current, nextState.selection)) continue;
          changed = true;
          nextSelections = new Map(nextSelections).set(control.id, nextState.selection);
          nextControls = new Map(nextControls).set(control.id, withSelection(control, nextState.selection));
        }

        if (!changed) return;
        controls = nextControls;
        set({ selections: nextSelections });
      },
      closeMenu: () => {
        if (sameMenuState(get().menu, closedMenu)) return;
        set({ menu: closedMenu });
      },
      getControl: (id) => controls.get(id),
      getControls: () => Array.from(controls.values()),
      menu: closedMenu,
      registerControl: (control) => {
        const selection = get().selections.get(control.id);
        controls = new Map(controls).set(
          control.id,
          selection === undefined ? control : withSelection(control, selection),
        );
      },
      selections: new Map(),
      setActiveId: (id) => {
        if (get().activeId === id) return;
        set({ activeId: id });
      },
      setMenu: (menu) => {
        if (sameMenuState(get().menu, menu)) return;
        set({ menu });
      },
      unregisterControl: (id) => {
        if (!controls.has(id)) return;
        const nextControls = new Map(controls);
        nextControls.delete(id);
        controls = nextControls;
      },
    };
  });
};

const emptyTextSurfaceStore = createStore<Pick<TextSurfaceStoreState, "selections">>()(() => ({
  selections: new Map(),
}));

const menuLayoutForControl = (
  bounds: CanvasWorldBounds,
  menu: TextMenuState,
  control: TextControlRegistration,
): EditableTextMenuLayout | undefined =>
  layoutEditableTextMenu({
    anchor: worldToMenuPoint(bounds, menu.worldX, menu.worldY),
    bounds: menuLayoutBoundsFor(bounds),
    commands: editableTextClipboardMenuCommands({
      copy: control.copyable && hasSelection(control),
      cut: control.editable && hasSelection(control),
      paste: control.editable,
    }),
    metrics: {
      commandGap: menuGap,
      commandHeight: menuItemHeight,
      paddingX: menuPadding,
      paddingY: menuPadding,
      width: menuWidth,
    },
    open: menu.open && menu.controlId === control.id,
  });

const commandAt = (
  bounds: CanvasWorldBounds,
  commands: readonly EditableTextMenuCommandRect[],
  worldX: number,
  worldY: number,
): EditableTextMenuCommandRect | undefined =>
  editableTextMenuCommandAt(commands, worldToMenuPoint(bounds, worldX, worldY));

const pointInControl = (
  control: TextControlRegistration,
  worldX: number,
  worldY: number,
): boolean =>
  worldX >= control.bounds.left &&
  worldX <= control.bounds.right &&
  worldY <= control.bounds.top &&
  worldY >= control.bounds.bottom;

const controlBounds = (
  origin: Vec3,
  maxWidth: number,
  lineHeight: number,
  lineCount: number,
  paddingX: number,
  paddingY: number,
): TextControlBounds => ({
  bottom: origin[1] - Math.max(1, lineCount) * lineHeight - paddingY,
  left: origin[0] - paddingX,
  right: origin[0] + maxWidth + paddingX,
  top: origin[1] + lineHeight * 0.7 + paddingY,
});

const boxWorldLeft = (bounds: CanvasWorldBounds, box: TextSurfaceBox): number =>
  bounds.left + box.left;

const boxWorldTop = (bounds: CanvasWorldBounds, box: TextSurfaceBox): number =>
  bounds.top - box.top;

const boxBounds = (
  surfaceBounds: CanvasWorldBounds,
  box: TextSurfaceBox,
  fallbackHeight: number,
): TextControlBounds => {
  const left = boxWorldLeft(surfaceBounds, box);
  const top = boxWorldTop(surfaceBounds, box);
  const height = box.height ?? fallbackHeight;

  return {
    bottom: top - height,
    left,
    right: left + box.width,
    top,
  };
};

const boxMaxWidth = (
  box: TextSurfaceBox,
  paddingX = 0,
): number => Math.max(0, box.width - paddingX * 2);

const textOriginForBox = (
  context: TextSurfaceContextValue,
  box: TextSurfaceBox,
  font: TextFontFace | undefined,
  fontSize: number,
  lineHeight: number,
): Vec3 => [
  boxWorldLeft(context.bounds, box),
  textBaselineForVerticalCenter(
    font,
    fontSize,
    boxWorldTop(context.bounds, box),
    box.height ?? lineHeight,
  ),
  box.z ?? 0,
];

const fieldOriginForBox = (
  context: TextSurfaceContextValue,
  box: TextSurfaceBox,
  lineHeight: number,
  paddingX: number,
): Vec3 => [
  boxWorldLeft(context.bounds, box) + paddingX,
  boxWorldTop(context.bounds, box) - lineHeight / 2,
  box.z ?? 0,
];

const menuNodes = (
  context: TextSurfaceContextValue,
  control: TextControlRegistration,
): readonly RenderNode[] => {
  const layout = context.menuLayoutFor(control);
  if (layout === undefined) return [];

  const x = layout.bounds.x;
  const y = menuYToWorldTop(context.bounds, layout.bounds.y);
  const height = layout.bounds.height;
  const nodes: RenderNode[] = [
    mesh({
      geometry: boxGeometry({ size: [menuWidth, height, 0.02] }),
      material: unlitMaterial({ color: context.style.menuColor }),
      transform: {
        position: [x + menuWidth / 2, y - height / 2, menuZ],
        rotation: [0, 0, 0],
      },
    }),
  ];

  for (const command of layout.commands) {
    const commandX = command.bounds.x;
    const commandY = menuYToWorldTop(context.bounds, command.bounds.y);
    nodes.push(
      mesh({
        geometry: boxGeometry({ size: [command.bounds.width, command.bounds.height, 0.02] }),
        material: unlitMaterial({ color: context.style.menuItemColor }),
        transform: {
          position: [
            commandX + command.bounds.width / 2,
            commandY - command.bounds.height / 2,
            menuZ + 0.01,
          ],
          rotation: [0, 0, 0],
        },
      }),
      text({
        color: command.enabled ? [0.92, 0.96, 0.98, 1] : [0.42, 0.47, 0.5, 1],
        ...(control.font === undefined ? {} : { font: control.font }),
        fontSize: menuTextFontSize,
        lineHeight: menuTextLineHeight,
        origin: [
          commandX + menuTextInsetX,
          textBaselineForVerticalCenter(control.font, menuTextFontSize, commandY, command.bounds.height),
          menuZ + 0.03,
        ],
        text: command.label,
      }),
    );
  }

  return nodes;
};

const writeClipboardText = async (value: string): Promise<boolean> => {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.writeText !== "function" || value === "") return false;

  try {
    await clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
};

const readClipboardText = async (): Promise<string | undefined> => {
  const clipboard = navigator.clipboard;
  if (clipboard === undefined || typeof clipboard.readText !== "function") return undefined;

  try {
    const value = await clipboard.readText();
    return value === "" ? undefined : value;
  } catch {
    return undefined;
  }
};

export const TextSurface = ({
  bounds = defaultSurfaceBounds,
  children,
  onPaste,
  styleOptions,
  ...canvasProps
}: TextSurfaceProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const pendingMenuCommandRef = useRef<PendingMenuCommand | undefined>(undefined);
  const store = useMemo(createTextSurfaceStore, []);
  const activeId = useStore(store, (state) => state.activeId);
  const menu = useStore(store, (state) => state.menu);
  const style = useMemo<Required<TextInteractionStyle>>(() => ({
    ...defaultTextStyle,
    ...styleOptions,
  }), [styleOptions]);

  const findControlAt = useCallback((
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { readonly control: TextControlRegistration; readonly worldX: number; readonly worldY: number } | undefined => {
    const [worldX, worldY] = canvasPointToWorld(canvas, bounds, clientX, clientY);
    const controls = Array.from(store.getState().getControls()).reverse();
    const control = controls.find((candidate) =>
      (candidate.selectable || candidate.editable || candidate.copyable) &&
      pointInControl(candidate, worldX, worldY)
    );

    return control === undefined ? undefined : { control, worldX, worldY };
  }, [bounds, store]);

  const focusCanvas = useCallback((): void => {
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  const setCaretFromPoint = useCallback((
    control: TextControlRegistration,
    worldX: number,
    worldY: number,
    extend: boolean,
    anchor?: EditableTextCaretEndpoint,
  ): EditableTextCaretEndpoint | undefined => {
    const anchoredState = anchor === undefined
      ? control.state
      : {
          ...control.state,
          selection: {
            ...control.state.selection,
            anchor: anchor.index,
            anchorLine: anchor.line,
          },
        };
    const nextSelection = editableTextEditorPointerSelection({
      extend,
      layout: control.layout,
      origin: control.origin,
      point: { x: worldX, y: worldY },
      state: anchoredState,
    });

    store.getState().applyEditorState(control.id, setEditableTextEditorSelection(control.state, nextSelection));
    return { index: nextSelection.focus, line: nextSelection.focusLine };
  }, [store]);

  const runClipboardCommand = useCallback(async (
    control: TextControlRegistration,
    action: ClipboardAction,
    _source: ClipboardSource,
  ): Promise<void> => {
    if (action === "paste") {
      if (!control.editable) return;
      const value = await readClipboardText();
      if (value !== undefined) store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, value));
      store.getState().closeMenu();
      focusCanvas();
      return;
    }

    if (!control.copyable || control.selectedText === "") return;
    const ok = await writeClipboardText(control.selectedText);
    if (ok && action === "cut" && control.editable) {
      store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, ""));
    }
    store.getState().closeMenu();
    focusCanvas();
  }, [focusCanvas, store]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLCanvasElement>): void => {
    onPaste?.(event);
    if (event.defaultPrevented) return;

    const control = activeId === undefined ? undefined : store.getState().getControl(activeId);
    if (control === undefined || !control.editable) return;

    const value = event.clipboardData.getData("text/plain");
    if (value === "") return;

    event.preventDefault();
    store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, value));
    store.getState().closeMenu();
    focusCanvas();
  }, [activeId, focusCanvas, onPaste, store]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLCanvasElement>): void => {
    const control = activeId === undefined ? undefined : store.getState().getControl(activeId);
    if (control === undefined) return;

    const { intent, state: nextState } = applyEditableTextEditorKeyInput(
      control.state,
      {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        isComposing: event.nativeEvent.isComposing,
        key: event.key,
        keyCode: event.keyCode,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
      },
      { mode: control.mode },
    );
    if (intent === undefined) return;

    if (intent.type === "clipboard-shortcut") {
      if (intent.shortcut === "paste") {
        return;
      }

      event.preventDefault();
      void runClipboardCommand(control, intent.shortcut, "keyboard");
      return;
    }

    event.preventDefault();
    if (!control.editable && intent.type !== "select-all" && !intent.type.startsWith("move-")) return;
    if (
      intent.type === "move-previous" ||
      intent.type === "move-next" ||
      intent.type === "move-start" ||
      intent.type === "move-end"
    ) {
      store.getState().applyEditorState(control.id, setEditableTextEditorSelection(nextState, editableTextEditorCaretSelection({
        ...(intent.extend === undefined ? {} : { extend: intent.extend }),
        index: nextState.selection.focus,
        layout: control.layout,
        state: control.state,
      })));
      return;
    }

    if (intent.type !== "enter-key") store.getState().applyEditorState(control.id, nextState);
  }, [activeId, runClipboardCommand, store]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;

    if (menu.open && menu.controlId !== undefined) {
      const control = store.getState().getControl(menu.controlId);
      if (control !== undefined) {
        const [worldX, worldY] = canvasPointToWorld(event.currentTarget, bounds, event.clientX, event.clientY);
        const layout = menuLayoutForControl(bounds, menu, control);
        const command = layout === undefined ? undefined : commandAt(bounds, layout.commands, worldX, worldY);
        if (command !== undefined) {
          event.preventDefault();
          pendingMenuCommandRef.current = command.enabled
            ? { action: command.action, controlId: control.id, pointerId: event.pointerId }
            : undefined;
          return;
        }
      }
    }

    const hit = findControlAt(event.currentTarget, event.clientX, event.clientY);
    pendingMenuCommandRef.current = undefined;
    store.getState().closeMenu();
    if (hit === undefined) {
      store.getState().clearSelectionsExcept(undefined);
      store.getState().setActiveId(undefined);
      return;
    }

    event.preventDefault();
    const { control, worldX, worldY } = hit;
    store.getState().clearSelectionsExcept(control.id);
    store.getState().setActiveId(control.id);
    const clicked = setCaretFromPoint(control, worldX, worldY, event.shiftKey);
    event.currentTarget.focus({ preventScroll: true });
    const anchor = event.shiftKey ? { index: control.selection.anchor, line: control.selection.anchorLine } : clicked;
    dragRef.current = anchor === undefined ? undefined : { anchor, controlId: control.id, moved: false };
    captureCanvasPointer(event.currentTarget, event.pointerId);
  }, [bounds, findControlAt, menu, setCaretFromPoint, store]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (drag === undefined || (event.buttons & 1) === 0) return;
    const control = store.getState().getControl(drag.controlId);
    if (control === undefined) return;

    event.preventDefault();
    const [worldX, worldY] = canvasPointToWorld(event.currentTarget, bounds, event.clientX, event.clientY);
    dragRef.current = { ...drag, moved: true };
    setCaretFromPoint(control, worldX, worldY, true, drag.anchor);
  }, [bounds, setCaretFromPoint, store]);

  const handlePointerEnd = useCallback((event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pendingCommand = pendingMenuCommandRef.current;
    if (pendingCommand?.pointerId === event.pointerId) {
      pendingMenuCommandRef.current = undefined;
      event.preventDefault();
      const control = store.getState().getControl(pendingCommand.controlId);
      if (control !== undefined) void runClipboardCommand(control, pendingCommand.action, "menu");
      return;
    }

    const drag = dragRef.current;
    if (drag?.moved === true) {
      const control = store.getState().getControl(drag.controlId);
      if (control !== undefined) {
        event.preventDefault();
        const [worldX, worldY] = canvasPointToWorld(event.currentTarget, bounds, event.clientX, event.clientY);
        setCaretFromPoint(control, worldX, worldY, true, drag.anchor);
      }
    }
    dragRef.current = undefined;
    pendingMenuCommandRef.current = undefined;
    releaseCanvasPointer(event.currentTarget, event.pointerId);
  }, [bounds, runClipboardCommand, setCaretFromPoint, store]);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const hit = findControlAt(event.currentTarget, event.clientX, event.clientY);
    if (hit === undefined) {
      store.getState().clearSelectionsExcept(undefined);
      store.getState().closeMenu();
      return;
    }

    const { control, worldX, worldY } = hit;
    if (!control.copyable && !control.editable) return;

    const nextSelection = editableTextEditorContextMenuSelection({
      layout: control.layout,
      origin: control.origin,
      point: { x: worldX, y: worldY },
      state: control.state,
    });
    store.getState().clearSelectionsExcept(control.id);
    store.getState().applyEditorState(control.id, setEditableTextEditorSelection(control.state, nextSelection));
    store.getState().setActiveId(control.id);
    event.currentTarget.focus({ preventScroll: true });
    store.getState().setMenu({
      controlId: control.id,
      open: true,
      worldX,
      worldY,
    });
  }, [findControlAt, store]);

  const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLCanvasElement>): void => {
    const control = activeId === undefined ? undefined : store.getState().getControl(activeId);
    if (control === undefined || !control.editable || event.data === "") return;
    store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, event.data));
  }, [activeId, store]);

  const context = useMemo<TextSurfaceContextValue>(() => ({
    activeId,
    bounds,
    menu,
    menuLayoutFor: (control) => menuLayoutForControl(bounds, menu, control),
    registerControl: store.getState().registerControl,
    store,
    style,
    unregisterControl: store.getState().unregisterControl,
  }), [activeId, bounds, menu, store, style]);

  return createElement(Canvas, {
    ...canvasProps,
    "aria-multiline": true,
    onBlur: () => {
      store.getState().clearSelectionsExcept(undefined);
      store.getState().setActiveId(undefined);
      store.getState().closeMenu();
    },
    onCompositionEnd: handleCompositionEnd,
    onContextMenu: handleContextMenu,
    onKeyDown: handleKeyDown,
    onPaste: handlePaste,
    onPointerCancel: handlePointerEnd,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: handlePointerEnd,
    ref: canvasRef,
    role: "textbox",
    tabIndex: 0,
    children: createElement(
      TextSurfaceContext.Provider,
      { value: context },
      children as ReactNode,
    ),
  });
};

const useTextPrimitiveState = (textValue: string): {
  readonly id: string;
  readonly state: EditableTextEditorState;
} => {
  const id = useId();
  const context = useContext(TextSurfaceContext);
  const store = context?.store;
  const selection = useStore(
    (store ?? emptyTextSurfaceStore) as StoreApi<Pick<TextSurfaceStoreState, "selections">>,
    (state) => state.selections.get(id),
  );

  return useMemo(() => ({
    id,
    state: createEditableTextEditorState({
      ...(selection === undefined ? {} : { selection }),
      text: textValue,
    }),
  }), [id, selection, textValue]);
};

const useRegisterTextControl = (control: TextControlRegistration): void => {
  const context = useContext(TextSurfaceContext);
  const store = context?.store;

  useLayoutEffect(() => {
    if (store === undefined) return undefined;

    store.getState().registerControl(control);
    return () => {
      store.getState().unregisterControl(control.id);
    };
  }, [control, store]);
};

const fieldNodes = ({
  context,
  height,
  lineHeight,
  maxWidth,
  origin,
  rows,
}: {
  readonly context: TextSurfaceContextValue;
  readonly height?: number;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly origin: Vec3;
  readonly rows: number;
}): readonly RenderNode[] => {
  const width = maxWidth + context.style.fieldPaddingX * 2;
  const resolvedHeight = height ?? textFieldHeight({
    lineHeight,
    paddingY: context.style.fieldPaddingY,
    rows,
  });

  return [
    mesh({
      geometry: boxGeometry({ size: [width, resolvedHeight, 0.02] }),
      material: unlitMaterial({ color: context.style.fieldColor }),
      transform: {
        position: [
          origin[0] + maxWidth / 2,
          origin[1] - (resolvedHeight - lineHeight) / 2,
          origin[2] - 0.05,
        ],
        rotation: [0, 0, 0],
      },
    }),
  ];
};

const usePrimitiveRegistration = ({
  bounds,
  copyable,
  editable,
  font,
  fontSize,
  id,
  lineHeight,
  maxWidth,
  mode,
  onValueChange,
  origin,
  selectable,
  state,
}: {
  readonly bounds?: TextControlBounds;
  readonly copyable: boolean;
  readonly editable: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly id: string;
  readonly lineHeight?: number;
  readonly maxWidth: number;
  readonly mode: TextControlMode;
  readonly onValueChange?: (value: string) => void;
  readonly origin: Vec3;
  readonly selectable: boolean;
  readonly state: EditableTextEditorState;
}): {
  readonly active: boolean;
  readonly context: TextSurfaceContextValue | undefined;
  readonly control: TextControlRegistration;
} => {
  const context = useContext(TextSurfaceContext);
  const style = context?.style ?? defaultTextStyle;
  const effectiveFontSize = fontSize ?? style.fontSize;
  const effectiveLineHeight = lineHeight ?? style.lineHeight;
  const fragment = useMemo(() => createEditableTextFragment({
    color: style.color,
    ...(font === undefined ? {} : { font }),
    fontSize: effectiveFontSize,
    lineHeight: effectiveLineHeight,
    maxWidth,
    mode,
    origin,
    selection: state.selection,
    text: state.text,
  }), [effectiveFontSize, effectiveLineHeight, font, maxWidth, mode, origin, state.selection, state.text, style.color]);
  const control = useMemo<TextControlRegistration>(() => ({
    bounds: bounds ?? controlBounds(
      origin,
      maxWidth,
      effectiveLineHeight,
      fragment.layout.lines.length,
      style.fieldPaddingX,
      style.fieldPaddingY,
    ),
    copyable,
    editable,
    ...(font === undefined ? {} : { font }),
    id,
    layout: fragment.layout,
    mode,
    ...(onValueChange === undefined ? {} : { onValueChange }),
    origin,
    selectable,
    selectedText: editableTextEditorSelectedText(state),
    selection: state.selection,
    state,
    text: state.text,
  }), [
    bounds,
    copyable,
    editable,
    font,
    fragment.layout,
    effectiveLineHeight,
    id,
    maxWidth,
    mode,
    onValueChange,
    origin,
    selectable,
    state,
    style.fieldPaddingX,
    style.fieldPaddingY,
  ]);

  useRegisterTextControl(control);

  return {
    active: context?.activeId === id,
    context,
    control,
  };
};

export const TextPrimitive = ({
  box,
  children,
  color,
  copyable,
  font,
  fontSize,
  lineHeight,
  maxWidth = 7,
  origin = [0, 0, 0],
  selectable,
  text: textProp,
}: TextPrimitiveProps): ReactNode => {
  const value = textProp ?? textFromChildren(children);
  const interactive = selectable === true || copyable === true;
  const { id, state } = useTextPrimitiveState(value);
  const surfaceContext = useContext(TextSurfaceContext);
  const style = surfaceContext?.style ?? defaultTextStyle;
  const effectiveFontSize = fontSize ?? style.fontSize;
  const effectiveLineHeight = lineHeight ?? style.lineHeight;
  const resolvedOrigin = box === undefined || surfaceContext === undefined
    ? origin
    : textOriginForBox(surfaceContext, box, font, effectiveFontSize, effectiveLineHeight);
  const resolvedMaxWidth = box === undefined ? maxWidth : boxMaxWidth(box);
  const resolvedBounds = box === undefined || surfaceContext === undefined
    ? undefined
    : boxBounds(surfaceContext.bounds, box, box.height ?? effectiveLineHeight);
  const { context, control } = usePrimitiveRegistration({
    ...(resolvedBounds === undefined ? {} : { bounds: resolvedBounds }),
    copyable: copyable === true || selectable === true,
    editable: false,
    ...(font === undefined ? {} : { font }),
    ...(fontSize === undefined ? {} : { fontSize }),
    id,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    maxWidth: resolvedMaxWidth,
    mode: "multiline",
    origin: resolvedOrigin,
    selectable: interactive,
    state,
  });
  if (box !== undefined && surfaceContext === undefined) {
    throw new Error("Royal text box props require a TextSurface ancestor.");
  }

  const textColor = color ?? (context?.style ?? style).color;
  const fragment = createEditableTextFragment({
    color: textColor,
    ...(font === undefined ? {} : { font }),
    fontSize: effectiveFontSize,
    lineHeight: effectiveLineHeight,
    maxWidth: resolvedMaxWidth,
    origin: resolvedOrigin,
    selection: interactive ? state.selection : createEditableTextEditorState({ text: value }).selection,
    selectionColor: (context?.style ?? style).selectionColor,
    text: value,
  });

  if (!interactive) {
    return rendererOutputToReact([
      text({
        color: textColor,
        ...(font === undefined ? {} : { font }),
        ...(fontSize === undefined ? {} : { fontSize }),
        ...(lineHeight === undefined ? {} : { lineHeight }),
        origin: resolvedOrigin,
        text: value,
      }),
    ]);
  }

  return rendererOutputToReact([
    ...fragment.nodes,
    ...(context === undefined ? [] : menuNodes(context, control)),
  ]);
};

const TextFieldPrimitive = ({
  box,
  color,
  font,
  fontSize,
  lineHeight,
  maxWidth = 7,
  mode,
  onValueChange,
  origin = [0, 0, 0],
  placeholder,
  rows,
  value,
}: TextFieldPrimitiveProps & {
  readonly mode: TextControlMode;
  readonly rows: number;
}): readonly RenderNode[] => {
  const { id, state } = useTextPrimitiveState(value);
  const surfaceContext = useContext(TextSurfaceContext);
  const surfaceStyle = surfaceContext?.style ?? defaultTextStyle;
  const fieldFontSize = fontSize ?? surfaceStyle.fontSize;
  const fieldLineHeight = lineHeight ?? surfaceStyle.lineHeight;
  const defaultFieldHeight = textFieldHeight({
    lineHeight: fieldLineHeight,
    paddingY: surfaceStyle.fieldPaddingY,
    rows,
  });
  const resolvedHeight = box?.height ?? defaultFieldHeight;
  const resolvedMaxWidth = box === undefined ? maxWidth : boxMaxWidth(box, surfaceStyle.fieldPaddingX);
  const resolvedOrigin = box === undefined || surfaceContext === undefined
    ? origin
    : fieldOriginForBox(surfaceContext, box, fieldLineHeight, surfaceStyle.fieldPaddingX);
  const resolvedBounds = box === undefined || surfaceContext === undefined
    ? undefined
    : boxBounds(surfaceContext.bounds, box, resolvedHeight);
  const { active, context, control } = usePrimitiveRegistration({
    ...(resolvedBounds === undefined ? {} : { bounds: resolvedBounds }),
    copyable: true,
    editable: true,
    ...(font === undefined ? {} : { font }),
    ...(fontSize === undefined ? {} : { fontSize }),
    id,
    ...(lineHeight === undefined ? {} : { lineHeight }),
    maxWidth: resolvedMaxWidth,
    mode,
    ...(onValueChange === undefined ? {} : { onValueChange }),
    origin: resolvedOrigin,
    selectable: true,
    state,
  });
  if (box !== undefined && surfaceContext === undefined) {
    throw new Error("Royal text box props require a TextSurface ancestor.");
  }

  const style = context?.style ?? defaultTextStyle;
  const fragment = createEditableTextFragment({
    caretColor: style.caretColor,
    caretWidth: style.caretWidth,
    color: color ?? style.color,
    ...(font === undefined ? {} : { font }),
    fontSize: fieldFontSize,
    lineHeight: fieldLineHeight,
    maxWidth: resolvedMaxWidth,
    mode,
    origin: resolvedOrigin,
    ...(placeholder === undefined ? {} : { placeholder }),
    placeholderColor: style.placeholderColor,
    selection: state.selection,
    selectionColor: style.selectionColor,
    showCaret: active,
    text: state.text,
  });

  return [
    ...(context === undefined
      ? []
      : fieldNodes({
        context,
        height: resolvedHeight,
        lineHeight: fieldLineHeight,
        maxWidth: resolvedMaxWidth,
        origin: resolvedOrigin,
        rows,
      })),
    ...fragment.nodes,
    ...(context === undefined ? [] : menuNodes(context, control)),
  ];
};

export const InputPrimitive = (props: TextFieldPrimitiveProps): ReactNode =>
  rendererOutputToReact(TextFieldPrimitive({
    ...props,
    mode: "single-line",
    rows: 1,
  }));

export const TextareaPrimitive = ({
  rows = 4,
  ...props
}: TextAreaPrimitiveProps): ReactNode =>
  rendererOutputToReact(TextFieldPrimitive({
    ...props,
    mode: "multiline",
    rows,
  }));

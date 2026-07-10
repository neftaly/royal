import {
  boxGeometry,
  mesh,
  text,
  unlitMaterial,
  type RenderNode,
  type Rgba,
  type UiNodeSemantics,
  type Vec3,
} from "@royal/renderer-core";
import {
  applyEditableTextEditorKeyInput,
  createEditableTextEditorState,
  createEditableTextFragment,
  editableTextClipboardMenuCommands,
  editableTextEditorCaretSelection,
  editableTextEditorContextMenuSelection,
  editableTextEditorPointerSelection,
  editableTextEditorSelectedText,
  editableTextMenuCommandAt,
  layoutEditableTextMenu,
  pasteEditableTextEditorText,
  setEditableTextEditorSelection,
  type EditableTextCaretEndpoint,
  type EditableTextEditorState,
  type EditableTextLayout,
  type EditableTextMenuAction,
  type EditableTextMenuCommandRect,
  type EditableTextMenuLayout,
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
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useStore } from "zustand/react";
import { createStore, type StoreApi } from "zustand/vanilla";
import { Canvas, type CanvasProps } from "../canvas";
import { canvasPointToWorld, type CanvasWorldBounds } from "../canvas-coordinate";
import { captureCanvasPointer, releaseCanvasPointer } from "../canvas-pointer";
import { rendererOutputToReact } from "../renderer-output";
import {
  actionControlSemantics,
  hasSelection,
  initialTextSurfaceState,
  reduceTextSurfaceState,
  textControlSemantics,
  type ActionControlKind,
  type ActionControlRegistration,
  type PressedActionControl,
  type TextControlBounds,
  type TextControlMode,
  type TextControlRegistration,
  type TextMenuState,
  type TextSurfaceState,
  type TextSurfaceStateAction,
  type TextSurfaceStateEffect,
} from "./surface-state";

export type { TextControlMode } from "./surface-state";

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

export type TextSurfaceControlStyle = {
  readonly color?: Rgba;
  readonly fontSize?: number;
  readonly height?: number;
  readonly left?: number;
  readonly lineHeight?: number;
  readonly maxWidth?: number;
  readonly top?: number;
  readonly width?: number;
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

export interface TextProps {
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
  readonly style?: TextSurfaceControlStyle;
  readonly text?: string;
}

export interface TextFieldProps {
  readonly "aria-label"?: string;
  readonly box?: TextSurfaceBox;
  readonly color?: Rgba;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly maxWidth?: number;
  readonly onValueChange?: (value: string) => void;
  readonly origin?: Vec3;
  readonly placeholder?: string;
  readonly style?: TextSurfaceControlStyle;
  readonly value: string;
}

export interface TextInputProps extends TextFieldProps {
  readonly type?: "text";
}

export interface TextareaProps extends TextFieldProps {
  readonly rows?: number;
}

export interface ButtonProps {
  readonly "aria-label"?: string;
  readonly box?: TextSurfaceBox;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly onPress?: () => void;
  readonly style?: TextSurfaceControlStyle;
  readonly type?: "button";
}

export interface CheckboxInputProps {
  readonly "aria-label"?: string;
  readonly box?: TextSurfaceBox;
  readonly checked: boolean;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly onCheckedChange?: (checked: boolean) => void;
  readonly style?: TextSurfaceControlStyle;
  readonly type: "checkbox";
}

export interface FileInputProps {
  readonly accept?: string;
  readonly "aria-label"?: string;
  readonly box?: TextSurfaceBox;
  readonly capture?: "environment" | "user";
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly multiple?: boolean;
  readonly onFilesChange?: (files: readonly File[]) => void;
  readonly style?: TextSurfaceControlStyle;
  readonly type: "file";
}

export interface ColorInputProps {
  readonly "aria-label"?: string;
  readonly box?: TextSurfaceBox;
  readonly children?: ReactNode;
  readonly disabled?: boolean;
  readonly font?: TextFontFace;
  readonly fontSize?: number;
  readonly lineHeight?: number;
  readonly onValueChange?: (value: string) => void;
  readonly style?: TextSurfaceControlStyle;
  readonly type: "color";
  readonly value: string;
}

export type InputProps =
  | CheckboxInputProps
  | ColorInputProps
  | FileInputProps
  | TextInputProps;

type ClipboardAction = EditableTextMenuAction;
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

type TextSurfaceStoreState = TextSurfaceState & {
  readonly applyEditorState: (id: string, state: EditableTextEditorState) => void;
  readonly clearSelectionsExcept: (id: string | undefined) => void;
  readonly closeMenu: () => void;
  readonly getActionControl: (id: string) => ActionControlRegistration | undefined;
  readonly getActionControls: () => readonly ActionControlRegistration[];
  readonly getControl: (id: string) => TextControlRegistration | undefined;
  readonly getControls: () => readonly TextControlRegistration[];
  readonly registerActionControl: (control: ActionControlRegistration) => void;
  readonly registerControl: (control: TextControlRegistration) => void;
  readonly setActiveActionId: (id: string | undefined) => void;
  readonly setActiveId: (id: string | undefined) => void;
  readonly setMenu: (menu: TextMenuState) => void;
  readonly setPressedAction: (pressedAction: PressedActionControl | undefined) => void;
  readonly unregisterActionControl: (id: string) => void;
  readonly unregisterControl: (id: string) => void;
};

type TextSurfaceStore = StoreApi<TextSurfaceStoreState>;

type TextSurfaceContextValue = {
  readonly activeActionId: string | undefined;
  readonly activeId: string | undefined;
  readonly bounds: CanvasWorldBounds;
  readonly font: TextFontFace | undefined;
  readonly menu: TextMenuState;
  readonly menuLayoutFor: (control: TextControlRegistration) => EditableTextMenuLayout | undefined;
  readonly pressedActionId: string | undefined;
  readonly registerActionControl: (control: ActionControlRegistration) => void;
  readonly registerControl: (control: TextControlRegistration) => void;
  readonly store: TextSurfaceStore;
  readonly style: Required<TextInteractionStyle>;
  readonly unregisterActionControl: (id: string) => void;
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

const configurePasteSink = (sink: HTMLTextAreaElement): void => {
  sink.setAttribute("aria-label", "Text clipboard input");
  sink.setAttribute("autoCapitalize", "off");
  sink.setAttribute("autoComplete", "off");
  sink.setAttribute("autoCorrect", "off");
  sink.setAttribute("data-royal-text-clipboard-staging", "true");
  sink.spellcheck = false;
  sink.tabIndex = -1;
  sink.value = "";
  sink.wrap = "off";
  Object.assign(sink.style, {
    height: "1px",
    left: "0",
    opacity: "0",
    pointerEvents: "none",
    position: "fixed",
    top: "0",
    transform: "translate(-100vw, -100vh)",
    width: "1px",
    zIndex: "-1",
  });
};

export const textFieldHeight = ({
  lineHeight = defaultTextStyle.lineHeight,
  paddingY = defaultTextStyle.fieldPaddingY,
  rows = 1,
}: TextFieldHeightOptions = {}): number =>
  Math.max(1, rows) * lineHeight + paddingY * 2;

const TextSurfaceContext = createContext<TextSurfaceContextValue | undefined>(undefined);
const TextFontContext = createContext<TextFontFace | undefined>(undefined);

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

const createTextSurfaceStore = (): TextSurfaceStore => {
  return createStore<TextSurfaceStoreState>()((set, get) => {
    const runEffects = (effects: readonly TextSurfaceStateEffect[]): void => {
      for (const effect of effects) {
        get().controls.get(effect.id)?.onValueChange?.(effect.value);
      }
    };

    const dispatch = (action: TextSurfaceStateAction): void => {
      const current = get();
      const result = reduceTextSurfaceState(current, action);
      if (result.state !== current) set(result.state);
      runEffects(result.effects);
    };

    return {
      actionControls: new Map(initialTextSurfaceState.actionControls),
      activeActionId: initialTextSurfaceState.activeActionId,
      activeId: initialTextSurfaceState.activeId,
      applyEditorState: (id, nextState) => dispatch({ editorState: nextState, id, type: "editor/apply-state" }),
      clearSelectionsExcept: (id) => dispatch({ id, type: "selection/clear-except" }),
      closeMenu: () => dispatch({ type: "menu/close" }),
      controls: new Map(initialTextSurfaceState.controls),
      getActionControl: (id) => get().actionControls.get(id),
      getActionControls: () => Array.from(get().actionControls.values()),
      getControl: (id) => get().controls.get(id),
      getControls: () => Array.from(get().controls.values()),
      menu: initialTextSurfaceState.menu,
      pressedAction: initialTextSurfaceState.pressedAction,
      registerActionControl: (control) => dispatch({ control, type: "action-control/register" }),
      registerControl: (control) => dispatch({ control, type: "text-control/register" }),
      scrollLines: new Map(initialTextSurfaceState.scrollLines),
      selections: new Map(initialTextSurfaceState.selections),
      setActiveActionId: (id) => dispatch({ id, type: "active-action/set" }),
      setActiveId: (id) => dispatch({ id, type: "active-text/set" }),
      setMenu: (menu) => dispatch({ menu, type: "menu/set" }),
      setPressedAction: (pressedAction) => dispatch({ pressedAction, type: "pressed-action/set" }),
      unregisterActionControl: (id) => dispatch({ id, type: "action-control/unregister" }),
      unregisterControl: (id) => dispatch({ id, type: "text-control/unregister" }),
    };
  });
};

export interface TextFontProviderProps {
  readonly children: ReactNode;
  readonly font: TextFontFace;
}

export const TextFontProvider = ({
  children,
  font,
}: TextFontProviderProps): ReactNode =>
  createElement(TextFontContext.Provider, { value: font }, children);

export const useTextFont = (): TextFontFace | undefined =>
  useContext(TextFontContext);

const useResolvedTextFont = (font: TextFontFace | undefined): TextFontFace | undefined => {
  const contextFont = useContext(TextFontContext);
  const surfaceContext = useContext(TextSurfaceContext);
  return font ?? contextFont ?? surfaceContext?.font;
};

const requireResolvedTextFont = (font: TextFontFace | undefined): TextFontFace => {
  if (font !== undefined) return font;

  throw new Error("Royal text controls require a TextFontFace. Pass font or wrap them in TextFontProvider.");
};

const emptyTextSurfaceStore = createStore<Pick<TextSurfaceStoreState, "scrollLines" | "selections">>()(() => ({
  scrollLines: new Map(),
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

const pointInActionControl = (
  control: ActionControlRegistration,
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

const isFiniteNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const styleHasBoxLayout = (style: TextSurfaceControlStyle | undefined): boolean =>
  style?.left !== undefined ||
  style?.top !== undefined ||
  style?.width !== undefined ||
  style?.height !== undefined ||
  style?.z !== undefined;

const boxFromStyle = (
  style: TextSurfaceControlStyle | undefined,
  componentName: string,
): TextSurfaceBox | undefined => {
  if (!styleHasBoxLayout(style)) return undefined;
  if (style === undefined) return undefined;

  if (!isFiniteNumber(style.left) || !isFiniteNumber(style.top) || !isFiniteNumber(style.width)) {
    throw new Error(`${componentName} style layout requires finite left, top, and width values.`);
  }
  if (style.height !== undefined && !Number.isFinite(style.height)) {
    throw new Error(`${componentName} style height must be finite when provided.`);
  }
  if (style.z !== undefined && !Number.isFinite(style.z)) {
    throw new Error(`${componentName} style z must be finite when provided.`);
  }

  return {
    ...(style.height === undefined ? {} : { height: style.height }),
    left: style.left,
    top: style.top,
    width: style.width,
    ...(style.z === undefined ? {} : { z: style.z }),
  };
};

const resolveSurfaceBox = (
  box: TextSurfaceBox | undefined,
  style: TextSurfaceControlStyle | undefined,
  componentName: string,
): TextSurfaceBox | undefined => box ?? boxFromStyle(style, componentName);

const resolveRequiredSurfaceBox = (
  box: TextSurfaceBox | undefined,
  style: TextSurfaceControlStyle | undefined,
  componentName: string,
): TextSurfaceBox => {
  const resolvedBox = resolveSurfaceBox(box, style, componentName);
  if (resolvedBox === undefined) {
    throw new Error(`${componentName} requires box or style layout props inside TextSurface.`);
  }

  return resolvedBox;
};

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

const visibleLineCountFor = (
  height: number | undefined,
  lineHeight: number,
  paddingY = 0,
): number => {
  if (height === undefined) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.floor(Math.max(0, height - paddingY * 2) / lineHeight));
};

const interactionOriginForScroll = (
  origin: Vec3,
  lineHeight: number,
  scrollLine: number,
): Vec3 => [
  origin[0],
  origin[1] + scrollLine * lineHeight,
  origin[2],
];

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
        font: control.font,
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

const isKeyboardComposing = (
  event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent,
): boolean =>
  "nativeEvent" in event
    ? event.nativeEvent.isComposing
    : event.isComposing;

export const TextSurface = ({
  bounds = defaultSurfaceBounds,
  children,
  onPaste,
  styleOptions,
  ...canvasProps
}: TextSurfaceProps): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | undefined>(undefined);
  const pasteSinkRef = useRef<HTMLTextAreaElement | null>(null);
  const pendingKeyboardPasteControlIdRef = useRef<string | undefined>(undefined);
  const pendingMenuCommandRef = useRef<PendingMenuCommand | undefined>(undefined);
  const providedFont = useContext(TextFontContext);
  const store = useMemo(createTextSurfaceStore, []);
  const activeActionId = useStore(store, (state) => state.activeActionId);
  const activeId = useStore(store, (state) => state.activeId);
  const menu = useStore(store, (state) => state.menu);
  const pressedAction = useStore(store, (state) => state.pressedAction);
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

  const findActionControlAt = useCallback((
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ): { readonly control: ActionControlRegistration; readonly worldX: number; readonly worldY: number } | undefined => {
    const [worldX, worldY] = canvasPointToWorld(canvas, bounds, clientX, clientY);
    const controls = Array.from(store.getState().getActionControls()).reverse();
    const control = controls.find((candidate) =>
      !candidate.disabled &&
      pointInActionControl(candidate, worldX, worldY)
    );

    return control === undefined ? undefined : { control, worldX, worldY };
  }, [bounds, store]);

  const focusCanvas = useCallback((): void => {
    canvasRef.current?.focus({ preventScroll: true });
  }, []);

  const focusControl = useCallback((control: TextControlRegistration | undefined): void => {
    if (control?.editable === true && pasteSinkRef.current !== null) {
      pasteSinkRef.current.focus({ preventScroll: true });
      return;
    }

    focusCanvas();
  }, [focusCanvas]);

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

  const activateActionControl = useCallback((control: ActionControlRegistration): void => {
    if (control.disabled) return;
    store.getState().closeMenu();
    control.onPress();
    focusCanvas();
  }, [focusCanvas, store]);

  const runClipboardCommand = useCallback(async (
    control: TextControlRegistration,
    action: ClipboardAction,
  ): Promise<void> => {
    if (action === "paste") {
      if (!control.editable) return;
      const value = await readClipboardText();
      const currentControl = store.getState().getControl(control.id);
      if (value !== undefined && currentControl?.editable === true) {
        store.getState().applyEditorState(
          currentControl.id,
          pasteEditableTextEditorText(currentControl.state, value),
        );
      }
      store.getState().closeMenu();
      focusControl(currentControl);
      return;
    }

    if (!control.copyable || control.selectedText === "") return;
    const ok = await writeClipboardText(control.selectedText);
    const currentControl = store.getState().getControl(control.id);
    if (
      ok &&
      action === "cut" &&
      currentControl?.editable === true &&
      currentControl.state === control.state
    ) {
      store.getState().applyEditorState(
        currentControl.id,
        pasteEditableTextEditorText(currentControl.state, ""),
      );
    }
    store.getState().closeMenu();
    focusControl(currentControl);
  }, [focusControl, store]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLElement> | globalThis.ClipboardEvent): void => {
    const fromPasteSink = event.currentTarget === pasteSinkRef.current;
    if (event.currentTarget === canvasRef.current) {
      onPaste?.(event as ClipboardEvent<HTMLCanvasElement>);
      if (event.defaultPrevented) return;
    }

    const controlId = pendingKeyboardPasteControlIdRef.current ?? store.getState().activeId;
    pendingKeyboardPasteControlIdRef.current = undefined;
    const control = controlId === undefined ? undefined : store.getState().getControl(controlId);
    if (control === undefined || !control.editable) return;

    const value = event.clipboardData?.getData("text/plain") ?? "";
    if (fromPasteSink) event.preventDefault();
    if (value === "") return;

    event.preventDefault();
    store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, value));
    store.getState().closeMenu();
    focusControl(control);
  }, [focusControl, onPaste, store]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLElement> | globalThis.KeyboardEvent): void => {
    const { activeActionId: currentActiveActionId, activeId: currentActiveId } = store.getState();
    const control = currentActiveId === undefined ? undefined : store.getState().getControl(currentActiveId);
    if (control === undefined) {
      const actionControl = currentActiveActionId === undefined
        ? undefined
        : store.getState().getActionControl(currentActiveActionId);
      if (
        actionControl !== undefined &&
        (event.key === " " || event.key === "Enter")
      ) {
        event.preventDefault();
        activateActionControl(actionControl);
      }
      return;
    }

    const { intent, state: nextState } = applyEditableTextEditorKeyInput(
      control.state,
      {
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        isComposing: isKeyboardComposing(event),
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
        if (control.editable) {
          pendingKeyboardPasteControlIdRef.current = control.id;
          focusControl(control);
        }
        return;
      }

      event.preventDefault();
      void runClipboardCommand(control, intent.shortcut);
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
  }, [activateActionControl, focusControl, runClipboardCommand, store]);

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
    const actionHit = findActionControlAt(event.currentTarget, event.clientX, event.clientY);
    pendingMenuCommandRef.current = undefined;
    store.getState().closeMenu();
    if (actionHit !== undefined) {
      event.preventDefault();
      store.getState().clearSelectionsExcept(undefined);
      store.getState().setActiveId(undefined);
      store.getState().setActiveActionId(actionHit.control.id);
      store.getState().setPressedAction({
        controlId: actionHit.control.id,
        pointerId: event.pointerId,
      });
      focusCanvas();
      captureCanvasPointer(event.currentTarget, event.pointerId);
      return;
    }

    if (hit === undefined) {
      store.getState().clearSelectionsExcept(undefined);
      store.getState().setActiveId(undefined);
      store.getState().setActiveActionId(undefined);
      return;
    }

    event.preventDefault();
    const { control, worldX, worldY } = hit;
    store.getState().clearSelectionsExcept(control.id);
    store.getState().setActiveActionId(undefined);
    store.getState().setActiveId(control.id);
    const clicked = setCaretFromPoint(control, worldX, worldY, event.shiftKey);
    focusControl(control);
    const anchor = event.shiftKey ? { index: control.selection.anchor, line: control.selection.anchorLine } : clicked;
    dragRef.current = anchor === undefined ? undefined : { anchor, controlId: control.id, moved: false };
    captureCanvasPointer(event.currentTarget, event.pointerId);
  }, [bounds, findActionControlAt, findControlAt, focusCanvas, focusControl, menu, setCaretFromPoint, store]);

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
      if (control !== undefined) void runClipboardCommand(control, pendingCommand.action);
      return;
    }

    const pressed = store.getState().pressedAction;
    if (pressed?.pointerId === event.pointerId) {
      store.getState().setPressedAction(undefined);
      event.preventDefault();
      const hit = event.type === "pointercancel"
        ? undefined
        : findActionControlAt(event.currentTarget, event.clientX, event.clientY);
      const control = store.getState().getActionControl(pressed.controlId);
      if (control !== undefined && hit?.control.id === control.id) activateActionControl(control);
      releaseCanvasPointer(event.currentTarget, event.pointerId);
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
  }, [activateActionControl, bounds, findActionControlAt, runClipboardCommand, setCaretFromPoint, store]);

  const handleContextMenu = useCallback((event: ReactMouseEvent<HTMLCanvasElement>): void => {
    event.preventDefault();
    const [worldX, worldY] = canvasPointToWorld(event.currentTarget, bounds, event.clientX, event.clientY);
    const hit = findControlAt(event.currentTarget, event.clientX, event.clientY);
    const selectedControl = store.getState().getControls().find((candidate) => hasSelection(candidate));
    const control = hit?.control ?? selectedControl;
    if (control === undefined) {
      store.getState().clearSelectionsExcept(undefined);
      store.getState().closeMenu();
      return;
    }

    if (!control.copyable && !control.editable) return;

    const nextSelection = selectedControl?.id === control.id
      ? control.selection
      : editableTextEditorContextMenuSelection({
          layout: control.layout,
          origin: control.origin,
          point: { x: worldX, y: worldY },
          state: control.state,
        });
    store.getState().clearSelectionsExcept(control.id);
    store.getState().setActiveActionId(undefined);
    store.getState().applyEditorState(control.id, setEditableTextEditorSelection(control.state, nextSelection));
    store.getState().setActiveId(control.id);
    focusControl(control);
    store.getState().setMenu({
      controlId: control.id,
      open: true,
      worldX,
      worldY,
    });
  }, [findControlAt, focusControl, store]);

  const handleCompositionEnd = useCallback((event: CompositionEvent<HTMLElement> | globalThis.CompositionEvent): void => {
    const { activeId: currentActiveId } = store.getState();
    const control = currentActiveId === undefined ? undefined : store.getState().getControl(currentActiveId);
    if (control === undefined || !control.editable || event.data === "") return;
    store.getState().applyEditorState(control.id, pasteEditableTextEditorText(control.state, event.data));
  }, [store]);

  const handleBlur = useCallback((event: FocusEvent<HTMLElement> | globalThis.FocusEvent): void => {
    if (event.relatedTarget === canvasRef.current || event.relatedTarget === pasteSinkRef.current) return;
    store.getState().clearSelectionsExcept(undefined);
    store.getState().setActiveActionId(undefined);
    store.getState().setActiveId(undefined);
    store.getState().setPressedAction(undefined);
    store.getState().closeMenu();
  }, [store]);

  const sinkEventHandlersRef = useRef({
    handleBlur,
    handleCompositionEnd,
    handleKeyDown,
    handlePaste,
  });
  sinkEventHandlersRef.current = {
    handleBlur,
    handleCompositionEnd,
    handleKeyDown,
    handlePaste,
  };

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || typeof document === "undefined") return undefined;

    const sink = document.createElement("textarea");
    configurePasteSink(sink);
    pasteSinkRef.current = sink;

    const handleSinkPaste = (event: globalThis.ClipboardEvent): void =>
      sinkEventHandlersRef.current.handlePaste(event);
    const handleSinkKeyDown = (event: globalThis.KeyboardEvent): void =>
      sinkEventHandlersRef.current.handleKeyDown(event);
    const handleSinkCompositionEnd = (event: globalThis.CompositionEvent): void =>
      sinkEventHandlersRef.current.handleCompositionEnd(event);
    const handleSinkBlur = (event: globalThis.FocusEvent): void =>
      sinkEventHandlersRef.current.handleBlur(event);

    sink.addEventListener("paste", handleSinkPaste);
    sink.addEventListener("keydown", handleSinkKeyDown);
    sink.addEventListener("compositionend", handleSinkCompositionEnd);
    sink.addEventListener("blur", handleSinkBlur);
    (canvas.parentElement ?? document.body).append(sink);

    return () => {
      sink.removeEventListener("paste", handleSinkPaste);
      sink.removeEventListener("keydown", handleSinkKeyDown);
      sink.removeEventListener("compositionend", handleSinkCompositionEnd);
      sink.removeEventListener("blur", handleSinkBlur);
      if (pasteSinkRef.current === sink) pasteSinkRef.current = null;
      sink.remove();
    };
  }, []);

  const context = useMemo<TextSurfaceContextValue>(() => ({
    activeActionId,
    activeId,
    bounds,
    font: providedFont,
    menu,
    menuLayoutFor: (control) => menuLayoutForControl(bounds, menu, control),
    pressedActionId: pressedAction?.controlId,
    registerActionControl: store.getState().registerActionControl,
    registerControl: store.getState().registerControl,
    store,
    style,
    unregisterActionControl: store.getState().unregisterActionControl,
    unregisterControl: store.getState().unregisterControl,
  }), [activeActionId, activeId, bounds, menu, pressedAction, providedFont, store, style]);

  return createElement(Canvas, {
    ...canvasProps,
    "aria-multiline": true,
    onBlur: handleBlur,
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
    children: [
      createElement(
        TextSurfaceContext.Provider,
        { key: "scene", value: context },
        children as ReactNode,
      ),
    ],
  });
};

const useTextControlState = (textValue: string): {
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

const useTextControlScrollLine = (id: string): number => {
  const context = useContext(TextSurfaceContext);
  const store = context?.store;

  return useStore(
    (store ?? emptyTextSurfaceStore) as StoreApi<Pick<TextSurfaceStoreState, "scrollLines">>,
    (state) => state.scrollLines.get(id) ?? 0,
  );
};

const useRegisterTextControl = (control: TextControlRegistration): void => {
  const context = useContext(TextSurfaceContext);
  const store = context?.store;

  useLayoutEffect(() => {
    if (store === undefined) return undefined;

    return () => {
      store.getState().unregisterControl(control.id);
    };
  }, [control.id, store]);

  useLayoutEffect(() => {
    store?.getState().registerControl(control);
  }, [control, store]);
};

const useRegisterActionControl = (control: ActionControlRegistration | undefined): void => {
  const context = useContext(TextSurfaceContext);
  const store = context?.store;

  useLayoutEffect(() => {
    if (store === undefined || control === undefined) return undefined;

    return () => {
      store.getState().unregisterActionControl(control.id);
    };
  }, [control?.id, store]);

  useLayoutEffect(() => {
    if (control !== undefined) store?.getState().registerActionControl(control);
  }, [control, store]);
};

const fieldNodes = ({
  context,
  height,
  lineHeight,
  maxWidth,
  origin,
  rows,
  semantics,
}: {
  readonly context: TextSurfaceContextValue;
  readonly height?: number;
  readonly lineHeight: number;
  readonly maxWidth: number;
  readonly origin: Vec3;
  readonly rows: number;
  readonly semantics?: UiNodeSemantics;
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
      ...(semantics === undefined ? {} : { semantics }),
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

const actionControlHeight = 0.5;
const actionControlTextInsetX = 0.16;
const actionControlBorder = 0.035;
const checkboxMark = "x";

const disabledControlColor: Rgba = [0.12, 0.13, 0.14, 1];
const disabledTextColor: Rgba = [0.46, 0.5, 0.52, 1];

const labelFromChildren = (children: ReactNode, fallback: string): string => {
  const value = textFromChildren(children);
  return value === "" ? fallback : value;
};

const actionControlBounds = (
  context: TextSurfaceContextValue,
  box: TextSurfaceBox,
): TextControlBounds => boxBounds(context.bounds, box, box.height ?? actionControlHeight);

const actionControlRect = ({
  box,
  color,
  context,
  height = box.height ?? actionControlHeight,
  inset = 0,
  semantics,
  z = 0,
}: {
  readonly box: TextSurfaceBox;
  readonly color: Rgba;
  readonly context: TextSurfaceContextValue;
  readonly height?: number;
  readonly inset?: number;
  readonly semantics?: UiNodeSemantics;
  readonly z?: number;
}): RenderNode => {
  const left = boxWorldLeft(context.bounds, box) + inset;
  const top = boxWorldTop(context.bounds, box) - inset;
  const width = Math.max(0.01, box.width - inset * 2);
  const resolvedHeight = Math.max(0.01, height - inset * 2);

  return mesh({
    geometry: boxGeometry({ size: [width, resolvedHeight, 0.02] }),
    material: unlitMaterial({ color }),
    ...(semantics === undefined ? {} : { semantics }),
    transform: {
      position: [
        left + width / 2,
        top - resolvedHeight / 2,
        (box.z ?? 0) + z,
      ],
      rotation: [0, 0, 0],
    },
  });
};

const actionLabelNode = ({
  box,
  color,
  context,
  font,
  fontSize,
  height = box.height ?? actionControlHeight,
  label,
  lineHeight,
  x,
}: {
  readonly box: TextSurfaceBox;
  readonly color: Rgba;
  readonly context: TextSurfaceContextValue;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly height?: number;
  readonly label: string;
  readonly lineHeight: number;
  readonly x?: number;
}): RenderNode => {
  const left = boxWorldLeft(context.bounds, box);
  const top = boxWorldTop(context.bounds, box);
  const originX = x ?? left + actionControlTextInsetX;

  return text({
    color,
    font,
    fontSize,
    lineHeight,
    origin: [
      originX,
      textBaselineForVerticalCenter(font, fontSize, top, height),
      (box.z ?? 0) + 0.08,
    ],
    text: label,
  });
};

const useActionPrimitiveRegistration = ({
  ariaLabel,
  box,
  checked,
  disabled,
  kind,
  label,
  onPress,
  value,
}: {
  readonly ariaLabel?: string;
  readonly box: TextSurfaceBox;
  readonly checked?: boolean;
  readonly disabled: boolean;
  readonly kind: ActionControlKind;
  readonly label: string;
  readonly onPress: () => void;
  readonly value?: string;
}): {
  readonly active: boolean;
  readonly context: TextSurfaceContextValue;
  readonly pressed: boolean;
  readonly semantics: UiNodeSemantics;
} => {
  const id = useId();
  const context = useContext(TextSurfaceContext);
  const active = context?.activeActionId === id;
  const pressed = context?.pressedActionId === id;
  const control = useMemo<ActionControlRegistration | undefined>(() => {
    if (context === undefined) return undefined;

    const bounds = actionControlBounds(context, box);
    return {
        bounds,
        disabled,
        id,
        kind,
        onPress,
        semantics: actionControlSemantics({
          active,
          bounds,
          ...(checked === undefined ? {} : { checked }),
          disabled,
          id,
          kind,
          label: ariaLabel ?? label,
          pressed,
          ...(value === undefined ? {} : { value }),
        }),
    };
  }, [active, ariaLabel, box, checked, context, disabled, id, kind, label, onPress, pressed, value]);

  useRegisterActionControl(control);
  if (context === undefined || control === undefined) {
    throw new Error("Royal action control box props require a TextSurface ancestor.");
  }

  return {
    active,
    context,
    pressed,
    semantics: control.semantics,
  };
};

const openEphemeralInput = (input: HTMLInputElement): void => {
  if (typeof document === "undefined") return;

  let removed = false;
  const cleanup = (): void => {
    if (removed) return;
    removed = true;
    window.removeEventListener("focus", handleWindowFocus);
    input.remove();
  };
  const handleWindowFocus = (): void => {
    window.setTimeout(cleanup, 0);
  };

  input.style.height = "1px";
  input.style.left = "0";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  input.style.position = "fixed";
  input.style.top = "0";
  input.style.transform = "translate(-100vw, -100vh)";
  input.style.width = "1px";
  input.tabIndex = -1;
  document.body.append(input);
  window.addEventListener("focus", handleWindowFocus, { once: true });
  input.addEventListener("change", cleanup, { once: true });
  input.click();
};

const openFilePicker = ({
  accept,
  capture,
  multiple,
  onFilesChange,
}: Pick<FileInputProps, "accept" | "capture" | "multiple" | "onFilesChange">): void => {
  if (typeof document === "undefined") return;

  const input = document.createElement("input");
  input.type = "file";
  if (accept !== undefined) input.accept = accept;
  if (capture !== undefined) input.capture = capture;
  input.multiple = multiple === true;
  input.addEventListener("change", () => {
    onFilesChange?.(Array.from(input.files ?? []));
  }, { once: true });
  openEphemeralInput(input);
};

const colorInputPattern = /^#[\da-f]{6}$/i;

const normalizeColorInputValue = (value: string): string =>
  colorInputPattern.test(value) ? value : "#000000";

const colorInputToRgba = (value: string): Rgba => {
  const normalized = normalizeColorInputValue(value);
  return [
    Number.parseInt(normalized.slice(1, 3), 16) / 255,
    Number.parseInt(normalized.slice(3, 5), 16) / 255,
    Number.parseInt(normalized.slice(5, 7), 16) / 255,
    1,
  ];
};

const openColorPicker = ({
  onValueChange,
  value,
}: Pick<ColorInputProps, "onValueChange" | "value">): void => {
  if (typeof document === "undefined") return;

  const input = document.createElement("input");
  input.type = "color";
  input.value = normalizeColorInputValue(value);
  input.addEventListener("input", () => {
    onValueChange?.(input.value);
  });
  openEphemeralInput(input);
};

const usePrimitiveRegistration = ({
  ariaLabel,
  bounds,
  copyable,
  editable,
  font,
  id,
  layout,
  lineHeight,
  maxWidth,
  mode,
  onValueChange,
  origin,
  selectable,
  scrollLine,
  state,
  visibleLineCount,
}: {
  readonly ariaLabel?: string;
  readonly bounds?: TextControlBounds;
  readonly copyable: boolean;
  readonly editable: boolean;
  readonly font: TextFontFace;
  readonly id: string;
  readonly layout: EditableTextLayout;
  readonly lineHeight?: number;
  readonly maxWidth: number;
  readonly mode: TextControlMode;
  readonly onValueChange?: (value: string) => void;
  readonly origin: Vec3;
  readonly selectable: boolean;
  readonly scrollLine: number;
  readonly state: EditableTextEditorState;
  readonly visibleLineCount: number;
}): {
  readonly active: boolean;
  readonly context: TextSurfaceContextValue | undefined;
  readonly control: TextControlRegistration;
} => {
  const context = useContext(TextSurfaceContext);
  const style = context?.style ?? defaultTextStyle;
  const active = context?.activeId === id;
  const effectiveLineHeight = lineHeight ?? style.lineHeight;
  const control = useMemo<TextControlRegistration>(() => {
    const resolvedBounds = bounds ?? controlBounds(
      origin,
      maxWidth,
      effectiveLineHeight,
      layout.lines.length,
      style.fieldPaddingX,
      style.fieldPaddingY,
    );

    return {
      bounds: resolvedBounds,
      copyable,
      editable,
      font,
      id,
      layout,
      mode,
      ...(onValueChange === undefined ? {} : { onValueChange }),
      origin,
      selectable,
      selectedText: editableTextEditorSelectedText(state),
      selection: state.selection,
      semantics: textControlSemantics({
        active,
        bounds: resolvedBounds,
        copyable,
        editable,
        id,
        ...(ariaLabel === undefined ? {} : { label: ariaLabel }),
        selectable,
        text: state.text,
      }),
      scrollLine,
      state,
      text: state.text,
      visibleLineCount,
    };
  }, [
    active,
    ariaLabel,
    bounds,
    copyable,
    editable,
    font,
    effectiveLineHeight,
    id,
    layout,
    maxWidth,
    mode,
    onValueChange,
    origin,
    selectable,
    scrollLine,
    state,
    style.fieldPaddingX,
    style.fieldPaddingY,
    visibleLineCount,
  ]);

  useRegisterTextControl(control);

  return {
    active,
    context,
    control,
  };
};

const buttonControlNodes = ({
  active,
  box,
  context,
  disabled,
  font,
  fontSize,
  label,
  lineHeight,
  pressed,
  semantics,
}: {
  readonly active: boolean;
  readonly box: TextSurfaceBox;
  readonly context: TextSurfaceContextValue;
  readonly disabled: boolean;
  readonly font: TextFontFace;
  readonly fontSize?: number;
  readonly label: string;
  readonly lineHeight?: number;
  readonly pressed: boolean;
  readonly semantics: UiNodeSemantics;
}): readonly RenderNode[] => {
  const style = context.style;
  const effectiveFontSize = fontSize ?? style.fontSize;
  const effectiveLineHeight = lineHeight ?? style.lineHeight;
  const fill = disabled
    ? disabledControlColor
    : pressed
      ? style.caretColor
      : style.fieldColor;
  const textColor = disabled ? disabledTextColor : style.color;

  return [
    ...(active ? [actionControlRect({ box, color: style.caretColor, context })] : []),
    actionControlRect({
      box,
      color: fill,
      context,
      inset: active ? actionControlBorder : 0,
      semantics,
    }),
    actionLabelNode({
      box,
      color: textColor,
      context,
      font,
      fontSize: effectiveFontSize,
      label,
      lineHeight: effectiveLineHeight,
    }),
  ];
};

export const Button = ({
  "aria-label": ariaLabel,
  box: boxProp,
  children,
  disabled = false,
  font,
  fontSize,
  lineHeight,
  onPress,
  style: primitiveStyle,
}: ButtonProps): ReactNode => {
  const box = resolveRequiredSurfaceBox(boxProp, primitiveStyle, "button");
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const handlePress = useCallback((): void => {
    onPress?.();
  }, [onPress]);
  const disabledControl = disabled || onPress === undefined;
  const label = labelFromChildren(children, "Button");
  const { active, context, pressed, semantics } = useActionPrimitiveRegistration({
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    box,
    disabled: disabledControl,
    kind: "button",
    label,
    onPress: handlePress,
  });

  return rendererOutputToReact(buttonControlNodes({
    active,
    box,
    context,
    disabled: disabledControl,
    font: resolvedFont,
    ...(styledFontSize === undefined ? {} : { fontSize: styledFontSize }),
    label,
    ...(styledLineHeight === undefined ? {} : { lineHeight: styledLineHeight }),
    pressed,
    semantics,
  }));
};

const FileInputControl = ({
  accept,
  "aria-label": ariaLabel,
  box: boxProp,
  capture,
  children,
  disabled = false,
  font,
  fontSize,
  lineHeight,
  multiple,
  onFilesChange,
  style: primitiveStyle,
}: FileInputProps): ReactNode => {
  const box = resolveRequiredSurfaceBox(boxProp, primitiveStyle, 'input type="file"');
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const handlePress = useCallback((): void => {
    openFilePicker({
      ...(accept === undefined ? {} : { accept }),
      ...(capture === undefined ? {} : { capture }),
      ...(multiple === undefined ? {} : { multiple }),
      ...(onFilesChange === undefined ? {} : { onFilesChange }),
    });
  }, [accept, capture, multiple, onFilesChange]);
  const disabledControl = disabled || onFilesChange === undefined;
  const label = labelFromChildren(children, multiple === true ? "Choose files" : "Choose file");
  const { active, context, pressed, semantics } = useActionPrimitiveRegistration({
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    box,
    disabled: disabledControl,
    kind: "file",
    label,
    onPress: handlePress,
  });

  return rendererOutputToReact(buttonControlNodes({
    active,
    box,
    context,
    disabled: disabledControl,
    font: resolvedFont,
    ...(styledFontSize === undefined ? {} : { fontSize: styledFontSize }),
    label,
    ...(styledLineHeight === undefined ? {} : { lineHeight: styledLineHeight }),
    pressed,
    semantics,
  }));
};

const ColorInputControl = ({
  "aria-label": ariaLabel,
  box: boxProp,
  children,
  disabled = false,
  font,
  fontSize,
  lineHeight,
  onValueChange,
  style: primitiveStyle,
  value,
}: ColorInputProps): ReactNode => {
  const box = resolveRequiredSurfaceBox(boxProp, primitiveStyle, 'input type="color"');
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const handlePress = useCallback((): void => {
    openColorPicker({
      ...(onValueChange === undefined ? {} : { onValueChange }),
      value,
    });
  }, [onValueChange, value]);
  const disabledControl = disabled || onValueChange === undefined;
  const label = labelFromChildren(children, "Color");
  const { active, context, pressed, semantics } = useActionPrimitiveRegistration({
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    box,
    disabled: disabledControl,
    kind: "color",
    label,
    onPress: handlePress,
    value,
  });
  const style = context.style;
  const effectiveFontSize = styledFontSize ?? style.fontSize;
  const effectiveLineHeight = styledLineHeight ?? style.lineHeight;
  const height = box.height ?? actionControlHeight;
  const fill = disabledControl
    ? disabledControlColor
    : pressed
      ? style.caretColor
      : style.fieldColor;
  const swatchSize = Math.max(0.16, height - 0.18);
  const swatchBox = {
    height: swatchSize,
    left: box.left + box.width - swatchSize - 0.1,
    top: box.top + (height - swatchSize) / 2,
    width: swatchSize,
    z: (box.z ?? 0) + 0.03,
  } satisfies TextSurfaceBox;

  return rendererOutputToReact([
    ...(active ? [actionControlRect({ box, color: style.caretColor, context })] : []),
    actionControlRect({
      box,
      color: fill,
      context,
      inset: active ? actionControlBorder : 0,
      semantics,
    }),
    actionLabelNode({
      box,
      color: disabledControl ? disabledTextColor : style.color,
      context,
      font: resolvedFont,
      fontSize: effectiveFontSize,
      label,
      lineHeight: effectiveLineHeight,
    }),
    actionControlRect({
      box: swatchBox,
      color: disabledControl ? disabledTextColor : colorInputToRgba(value),
      context,
    }),
  ]);
};

const CheckboxInputControl = ({
  "aria-label": ariaLabel,
  box: boxProp,
  checked,
  children,
  disabled = false,
  font,
  fontSize,
  lineHeight,
  onCheckedChange,
  style: primitiveStyle,
}: CheckboxInputProps): ReactNode => {
  const box = resolveRequiredSurfaceBox(boxProp, primitiveStyle, 'input type="checkbox"');
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const handlePress = useCallback((): void => {
    onCheckedChange?.(!checked);
  }, [checked, onCheckedChange]);
  const disabledControl = disabled || onCheckedChange === undefined;
  const label = textFromChildren(children);
  const { active, context, pressed, semantics } = useActionPrimitiveRegistration({
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    box,
    checked,
    disabled: disabledControl,
    kind: "checkbox",
    label: label === "" ? "Checkbox" : label,
    onPress: handlePress,
  });
  const style = context.style;
  const effectiveFontSize = styledFontSize ?? style.fontSize;
  const effectiveLineHeight = styledLineHeight ?? style.lineHeight;
  const height = box.height ?? actionControlHeight;
  const left = boxWorldLeft(context.bounds, box);
  const top = boxWorldTop(context.bounds, box);
  const squareSize = Math.max(0.18, Math.min(0.34, height - 0.12));
  const squareX = left;
  const squareY = top - (height - squareSize) / 2;
  const fill = disabledControl
    ? disabledControlColor
    : checked
      ? style.caretColor
      : style.fieldColor;
  const border = active || pressed ? style.caretColor : style.placeholderColor;
  const textColor = disabledControl ? disabledTextColor : style.color;
  const squareBox = {
    height: squareSize,
    left: squareX - context.bounds.left,
    top: context.bounds.top - squareY,
    width: squareSize,
    z: (box.z ?? 0) + 0.01,
  } satisfies TextSurfaceBox;

  return rendererOutputToReact([
    actionControlRect({ box: squareBox, color: border, context }),
    actionControlRect({
      box: squareBox,
      color: fill,
      context,
      inset: actionControlBorder,
      semantics,
    }),
    ...(checked
      ? [
          text({
            color: disabledControl ? disabledTextColor : [0.025, 0.032, 0.038, 1],
            font: resolvedFont,
            fontSize: squareSize * 0.68,
            lineHeight: squareSize * 0.78,
            origin: [
              squareX + squareSize * 0.28,
              textBaselineForVerticalCenter(resolvedFont, squareSize * 0.68, squareY, squareSize),
              (box.z ?? 0) + 0.12,
            ],
            text: checkboxMark,
          }),
        ]
      : []),
    ...(label === ""
      ? []
      : [
          actionLabelNode({
            box,
            color: textColor,
            context,
            font: resolvedFont,
            fontSize: effectiveFontSize,
            height,
            label,
            lineHeight: effectiveLineHeight,
            x: squareX + squareSize + 0.16,
          }),
        ]),
  ]);
};

export const Text = ({
  box: boxProp,
  children,
  color,
  copyable,
  font,
  fontSize,
  lineHeight,
  maxWidth,
  origin = [0, 0, 0],
  selectable,
  style: primitiveStyle,
  text: textProp,
}: TextProps): ReactNode => {
  const value = textProp ?? textFromChildren(children);
  const box = resolveSurfaceBox(boxProp, primitiveStyle, "text");
  const styledColor = color ?? primitiveStyle?.color;
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const styledMaxWidth = maxWidth ?? primitiveStyle?.maxWidth ?? 7;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const interactive = selectable === true || copyable === true;
  const { id, state } = useTextControlState(value);
  const scrollLine = useTextControlScrollLine(id);
  const surfaceContext = useContext(TextSurfaceContext);
  const style = surfaceContext?.style ?? defaultTextStyle;
  const effectiveFontSize = styledFontSize ?? style.fontSize;
  const effectiveLineHeight = styledLineHeight ?? style.lineHeight;
  const resolvedOrigin = box === undefined || surfaceContext === undefined
    ? origin
    : textOriginForBox(surfaceContext, box, resolvedFont, effectiveFontSize, effectiveLineHeight);
  const resolvedMaxWidth = box === undefined ? styledMaxWidth : boxMaxWidth(box);
  const visibleLineCount = box === undefined
    ? Number.POSITIVE_INFINITY
    : visibleLineCountFor(box.height ?? effectiveLineHeight, effectiveLineHeight);
  const interactionOrigin = interactionOriginForScroll(resolvedOrigin, effectiveLineHeight, scrollLine);
  const resolvedBounds = box === undefined || surfaceContext === undefined
    ? undefined
    : boxBounds(surfaceContext.bounds, box, box.height ?? effectiveLineHeight);
  const textColor = styledColor ?? style.color;
  const fragment = useMemo(() => createEditableTextFragment({
    color: textColor,
    font: resolvedFont,
    fontSize: effectiveFontSize,
    lineHeight: effectiveLineHeight,
    lineWindow: {
      lineCount: visibleLineCount,
      startLine: scrollLine,
    },
    maxWidth: resolvedMaxWidth,
    origin: resolvedOrigin,
    selection: state.selection,
    selectionColor: style.selectionColor,
    text: value,
  }), [
    effectiveFontSize,
    effectiveLineHeight,
    resolvedFont,
    resolvedMaxWidth,
    resolvedOrigin,
    scrollLine,
    state.selection,
    style.selectionColor,
    textColor,
    value,
    visibleLineCount,
  ]);
  const { context, control } = usePrimitiveRegistration({
    ...(resolvedBounds === undefined ? {} : { bounds: resolvedBounds }),
    copyable: copyable === true || selectable === true,
    editable: false,
    font: resolvedFont,
    id,
    layout: fragment.layout,
    ...(styledLineHeight === undefined ? {} : { lineHeight: styledLineHeight }),
    maxWidth: resolvedMaxWidth,
    mode: "multiline",
    origin: interactionOrigin,
    selectable: interactive,
    scrollLine,
    state,
    visibleLineCount,
  });
  if ((box !== undefined || interactive) && surfaceContext === undefined) {
    throw new Error("Royal interactive text requires a TextSurface ancestor.");
  }

  if (!interactive) {
    return rendererOutputToReact(box === undefined
      ? [
          text({
            color: textColor,
            font: resolvedFont,
            ...(styledFontSize === undefined ? {} : { fontSize: styledFontSize }),
            ...(styledLineHeight === undefined ? {} : { lineHeight: styledLineHeight }),
            origin: resolvedOrigin,
            text: value,
          }),
        ]
      : fragment.nodes);
  }

  return rendererOutputToReact([
    ...fragment.nodes,
    ...(context === undefined ? [] : menuNodes(context, control)),
  ]);
};

const TextFieldControl = ({
  "aria-label": ariaLabel,
  box: boxProp,
  color,
  font,
  fontSize,
  lineHeight,
  maxWidth,
  mode,
  onValueChange,
  origin = [0, 0, 0],
  placeholder,
  rows,
  style: primitiveStyle,
  value,
}: TextFieldProps & {
  readonly mode: TextControlMode;
  readonly rows: number;
}): ReactNode => {
  const box = resolveSurfaceBox(boxProp, primitiveStyle, mode === "single-line" ? "input" : "textarea");
  const styledColor = color ?? primitiveStyle?.color;
  const styledFontSize = fontSize ?? primitiveStyle?.fontSize;
  const styledLineHeight = lineHeight ?? primitiveStyle?.lineHeight;
  const styledMaxWidth = maxWidth ?? primitiveStyle?.maxWidth ?? 7;
  const resolvedFont = requireResolvedTextFont(useResolvedTextFont(font));
  const { id, state } = useTextControlState(value);
  const scrollLine = useTextControlScrollLine(id);
  const surfaceContext = useContext(TextSurfaceContext);
  const surfaceStyle = surfaceContext?.style ?? defaultTextStyle;
  const fieldFontSize = styledFontSize ?? surfaceStyle.fontSize;
  const fieldLineHeight = styledLineHeight ?? surfaceStyle.lineHeight;
  const defaultFieldHeight = textFieldHeight({
    lineHeight: fieldLineHeight,
    paddingY: surfaceStyle.fieldPaddingY,
    rows,
  });
  const resolvedHeight = box?.height ?? defaultFieldHeight;
  const resolvedMaxWidth = box === undefined ? styledMaxWidth : boxMaxWidth(box, surfaceStyle.fieldPaddingX);
  const resolvedOrigin = box === undefined || surfaceContext === undefined
    ? origin
    : fieldOriginForBox(surfaceContext, box, fieldLineHeight, surfaceStyle.fieldPaddingX);
  const visibleLineCount = visibleLineCountFor(resolvedHeight, fieldLineHeight, surfaceStyle.fieldPaddingY);
  const interactionOrigin = interactionOriginForScroll(resolvedOrigin, fieldLineHeight, scrollLine);
  const resolvedBounds = box === undefined || surfaceContext === undefined
    ? undefined
    : boxBounds(surfaceContext.bounds, box, resolvedHeight);
  const active = surfaceContext?.activeId === id;
  const fragment = useMemo(() => createEditableTextFragment({
    caretColor: surfaceStyle.caretColor,
    caretWidth: surfaceStyle.caretWidth,
    color: styledColor ?? surfaceStyle.color,
    font: resolvedFont,
    fontSize: fieldFontSize,
    lineHeight: fieldLineHeight,
    lineWindow: {
      lineCount: visibleLineCount,
      startLine: scrollLine,
    },
    maxWidth: resolvedMaxWidth,
    mode,
    origin: resolvedOrigin,
    ...(placeholder === undefined ? {} : { placeholder }),
    placeholderColor: surfaceStyle.placeholderColor,
    selection: state.selection,
    selectionColor: surfaceStyle.selectionColor,
    showCaret: active,
    text: state.text,
  }), [
    active,
    fieldFontSize,
    fieldLineHeight,
    mode,
    placeholder,
    resolvedFont,
    resolvedMaxWidth,
    resolvedOrigin,
    scrollLine,
    state.selection,
    state.text,
    styledColor,
    surfaceStyle.caretColor,
    surfaceStyle.caretWidth,
    surfaceStyle.color,
    surfaceStyle.placeholderColor,
    surfaceStyle.selectionColor,
    visibleLineCount,
  ]);
  const { context, control } = usePrimitiveRegistration({
    ...(ariaLabel === undefined ? {} : { ariaLabel }),
    ...(resolvedBounds === undefined ? {} : { bounds: resolvedBounds }),
    copyable: true,
    editable: onValueChange !== undefined,
    font: resolvedFont,
    id,
    layout: fragment.layout,
    ...(styledLineHeight === undefined ? {} : { lineHeight: styledLineHeight }),
    maxWidth: resolvedMaxWidth,
    mode,
    ...(onValueChange === undefined ? {} : { onValueChange }),
    origin: interactionOrigin,
    selectable: true,
    scrollLine,
    state,
    visibleLineCount,
  });
  if (surfaceContext === undefined) {
    throw new Error("Royal text fields require a TextSurface ancestor.");
  }

  return rendererOutputToReact([
    ...(context === undefined
      ? []
      : fieldNodes({
        context,
        height: resolvedHeight,
        lineHeight: fieldLineHeight,
        maxWidth: resolvedMaxWidth,
        origin: resolvedOrigin,
        rows,
        semantics: control.semantics,
      })),
    ...fragment.nodes,
    ...(context === undefined ? [] : menuNodes(context, control)),
  ]);
};

export const Input = (props: InputProps): ReactNode => {
  if (props.type === "checkbox") return createElement(CheckboxInputControl, props);
  if (props.type === "file") return createElement(FileInputControl, props);
  if (props.type === "color") return createElement(ColorInputControl, props);

  return createElement(TextFieldControl, {
    ...props,
    mode: "single-line",
    rows: 1,
  });
};

export const Textarea = ({
  rows = 4,
  ...props
}: TextareaProps): ReactNode =>
  createElement(TextFieldControl, {
    ...props,
    mode: "multiline",
    rows,
  });

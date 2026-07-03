import type { Vec3 } from "@royal/renderer-core";
import {
  collapseEditableTextEditorSelection,
  createEditableTextEditorState,
  editableTextCaretPlacement,
  editableTextEditorSelectedRange,
  editableTextEditorSelectedText,
  sameEditableTextSelection,
  type EditableTextEditorState,
  type EditableTextFragmentMode,
  type EditableTextLayout,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { TextFontFace } from "@royal/renderer-core/text/font";

export type TextControlMode = EditableTextFragmentMode;
export type ActionControlKind = "button" | "checkbox" | "color" | "file";

export type TextControlBounds = {
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
};

export type TextControlRegistration = {
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
  readonly scrollLine: number;
  readonly state: EditableTextEditorState;
  readonly text: string;
  readonly visibleLineCount: number;
};

export type ActionControlRegistration = {
  readonly bounds: TextControlBounds;
  readonly disabled: boolean;
  readonly id: string;
  readonly kind: ActionControlKind;
  readonly onPress: () => void;
};

export type PressedActionControl = {
  readonly controlId: string;
  readonly pointerId: number;
};

export type TextMenuState = {
  readonly controlId: string | undefined;
  readonly open: boolean;
  readonly worldX: number;
  readonly worldY: number;
};

export type TextSurfaceState = {
  readonly actionControls: ReadonlyMap<string, ActionControlRegistration>;
  readonly activeActionId: string | undefined;
  readonly activeId: string | undefined;
  readonly controls: ReadonlyMap<string, TextControlRegistration>;
  readonly menu: TextMenuState;
  readonly pressedAction: PressedActionControl | undefined;
  readonly scrollLines: ReadonlyMap<string, number>;
  readonly selections: ReadonlyMap<string, EditableTextSelection>;
};

export type TextSurfaceStateEffect = {
  readonly id: string;
  readonly type: "value-change";
  readonly value: string;
};

export type TextSurfaceStateAction =
  | {
      readonly control: TextControlRegistration;
      readonly type: "text-control/register";
    }
  | {
      readonly id: string;
      readonly type: "text-control/unregister";
    }
  | {
      readonly control: ActionControlRegistration;
      readonly type: "action-control/register";
    }
  | {
      readonly id: string;
      readonly type: "action-control/unregister";
    }
  | {
      readonly editorState: EditableTextEditorState;
      readonly id: string;
      readonly type: "editor/apply-state";
    }
  | {
      readonly id: string | undefined;
      readonly type: "selection/clear-except";
    }
  | {
      readonly id: string | undefined;
      readonly type: "active-text/set";
    }
  | {
      readonly id: string | undefined;
      readonly type: "active-action/set";
    }
  | {
      readonly menu: TextMenuState;
      readonly type: "menu/set";
    }
  | {
      readonly type: "menu/close";
    }
  | {
      readonly pressedAction: PressedActionControl | undefined;
      readonly type: "pressed-action/set";
    };

export type TextSurfaceStateReducerResult = {
  readonly effects: readonly TextSurfaceStateEffect[];
  readonly state: TextSurfaceState;
};

export const closedMenu: TextMenuState = {
  controlId: undefined,
  open: false,
  worldX: 0,
  worldY: 0,
};

export const initialTextSurfaceState: TextSurfaceState = {
  actionControls: new Map<string, ActionControlRegistration>(),
  activeActionId: undefined,
  activeId: undefined,
  controls: new Map<string, TextControlRegistration>(),
  menu: closedMenu,
  pressedAction: undefined,
  scrollLines: new Map<string, number>(),
  selections: new Map<string, EditableTextSelection>(),
};

export const sameMenuState = (left: TextMenuState, right: TextMenuState): boolean =>
  left.controlId === right.controlId &&
  left.open === right.open &&
  left.worldX === right.worldX &&
  left.worldY === right.worldY;

export const hasSelection = (control: TextControlRegistration): boolean => {
  const range = editableTextEditorSelectedRange(control.state);
  return range.start !== range.end;
};

export const withSelection = (
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

type TextControlScrollWindow = Pick<TextControlRegistration, "layout" | "scrollLine" | "visibleLineCount">;
type TextControlRegistrationScrollControl = TextControlScrollWindow & Pick<TextControlRegistration, "selection" | "text">;

export const maxScrollLineFor = (
  control: Pick<TextControlRegistration, "layout" | "visibleLineCount">,
): number => {
  if (!Number.isFinite(control.visibleLineCount)) return 0;
  return Math.max(0, control.layout.lines.length - Math.max(1, Math.floor(control.visibleLineCount)));
};

export const clampScrollLineFor = (
  control: TextControlScrollWindow,
  scrollLine: number,
): number => Math.max(0, Math.min(maxScrollLineFor(control), Math.floor(scrollLine)));

export const scrollLineForSelection = (
  control: TextControlScrollWindow,
  selection: EditableTextSelection,
): number => {
  const visibleLineCount = Math.max(1, Math.floor(control.visibleLineCount));
  if (!Number.isFinite(control.visibleLineCount)) return 0;

  const caret = editableTextCaretPlacement(control.layout, selection.focus, selection.focusLine) ??
    control.layout.caretPlacements.at(-1);
  const line = caret?.line ?? 0;
  const current = clampScrollLineFor(control, control.scrollLine);

  if (line < current) return clampScrollLineFor(control, line);
  if (line >= current + visibleLineCount) {
    return clampScrollLineFor(control, line - visibleLineCount + 1);
  }

  return current;
};

export const scrollLineForRegisteredTextControl = ({
  control,
  currentControl,
  persistedScrollLine,
}: {
  readonly control: TextControlRegistrationScrollControl;
  readonly currentControl: Pick<TextControlRegistration, "text"> | undefined;
  readonly persistedScrollLine: number | undefined;
}): number => {
  const persisted = persistedScrollLine ?? control.scrollLine;
  const clamped = clampScrollLineFor({ ...control, scrollLine: persisted }, persisted);

  if (currentControl !== undefined && currentControl.text !== control.text) {
    return scrollLineForSelection({ ...control, scrollLine: clamped }, control.selection);
  }

  return clamped;
};

const stateWith = (
  state: TextSurfaceState,
  patch: Partial<TextSurfaceState>,
): TextSurfaceState => ({
  actionControls: state.actionControls,
  activeActionId: state.activeActionId,
  activeId: state.activeId,
  controls: state.controls,
  menu: state.menu,
  pressedAction: state.pressedAction,
  scrollLines: state.scrollLines,
  selections: state.selections,
  ...patch,
});

const samePressedAction = (
  left: PressedActionControl | undefined,
  right: PressedActionControl | undefined,
): boolean =>
  left?.controlId === right?.controlId &&
  left?.pointerId === right?.pointerId;

const setSelection = (
  state: TextSurfaceState,
  id: string,
  selection: EditableTextSelection,
): TextSurfaceState => {
  const current = state.selections.get(id);
  if (current !== undefined && sameEditableTextSelection(current, selection)) return state;

  const nextSelections = new Map(state.selections).set(id, selection);
  const control = state.controls.get(id);
  let nextControls = state.controls;
  if (control !== undefined) {
    nextControls = new Map(state.controls).set(id, withSelection(control, selection));
  }

  return stateWith(state, {
    controls: nextControls,
    selections: nextSelections,
  });
};

const registerTextControl = (
  state: TextSurfaceState,
  control: TextControlRegistration,
): TextSurfaceState => {
  const currentControl = state.controls.get(control.id);
  const selection = state.selections.get(control.id);
  const selectedControl = selection === undefined || sameEditableTextSelection(control.selection, selection)
    ? control
    : withSelection(control, selection);
  const scrollLine = scrollLineForRegisteredTextControl({
    control: selectedControl,
    currentControl,
    persistedScrollLine: state.scrollLines.get(control.id),
  });
  const nextControl = {
    ...selectedControl,
    scrollLine,
  };
  const currentScroll = state.scrollLines.get(control.id);

  if (currentControl === nextControl && currentScroll === scrollLine) return state;

  const nextControls = new Map(state.controls).set(control.id, nextControl);
  if (currentScroll === scrollLine) {
    return stateWith(state, { controls: nextControls });
  }

  return stateWith(state, {
    controls: nextControls,
    scrollLines: new Map(state.scrollLines).set(control.id, scrollLine),
  });
};

const unregisterTextControl = (
  state: TextSurfaceState,
  id: string,
): TextSurfaceState => {
  if (!state.controls.has(id)) return state;

  const nextControls = new Map(state.controls);
  nextControls.delete(id);
  const nextScrollLines = new Map(state.scrollLines);
  nextScrollLines.delete(id);
  return stateWith(state, {
    controls: nextControls,
    scrollLines: nextScrollLines,
  });
};

const registerActionControl = (
  state: TextSurfaceState,
  control: ActionControlRegistration,
): TextSurfaceState => {
  if (state.actionControls.get(control.id) === control) return state;

  return stateWith(state, {
    actionControls: new Map(state.actionControls).set(control.id, control),
  });
};

const unregisterActionControl = (
  state: TextSurfaceState,
  id: string,
): TextSurfaceState => {
  if (!state.actionControls.has(id)) return state;

  const nextControls = new Map(state.actionControls);
  nextControls.delete(id);
  return stateWith(state, { actionControls: nextControls });
};

const applyEditorState = (
  state: TextSurfaceState,
  id: string,
  editorState: EditableTextEditorState,
): TextSurfaceStateReducerResult => {
  const control = state.controls.get(id);
  let nextState = setSelection(state, id, editorState.selection);
  const effects = control !== undefined && control.text !== editorState.text
    ? [{ id, type: "value-change", value: editorState.text } satisfies TextSurfaceStateEffect]
    : [];

  if (control !== undefined) {
    const scrollControl = {
      ...control,
      scrollLine: nextState.scrollLines.get(id) ?? control.scrollLine,
    };
    const nextScrollLine = scrollLineForSelection(scrollControl, editorState.selection);
    if (nextScrollLine !== scrollControl.scrollLine) {
      nextState = stateWith(nextState, {
        scrollLines: new Map(nextState.scrollLines).set(id, nextScrollLine),
      });
    }
  }

  return {
    effects,
    state: nextState,
  };
};

const clearSelectionsExcept = (
  state: TextSurfaceState,
  id: string | undefined,
): TextSurfaceState => {
  let changed = false;
  const currentControls = state.controls;
  let nextControls = currentControls;
  let nextSelections = state.selections;

  for (const control of currentControls.values()) {
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

  if (!changed) return state;
  return stateWith(state, {
    controls: nextControls,
    selections: nextSelections,
  });
};

export const reduceTextSurfaceState = (
  state: TextSurfaceState,
  action: TextSurfaceStateAction,
): TextSurfaceStateReducerResult => {
  switch (action.type) {
    case "text-control/register":
      return {
        effects: [],
        state: registerTextControl(state, action.control),
      };
    case "text-control/unregister":
      return {
        effects: [],
        state: unregisterTextControl(state, action.id),
      };
    case "action-control/register":
      return {
        effects: [],
        state: registerActionControl(state, action.control),
      };
    case "action-control/unregister":
      return {
        effects: [],
        state: unregisterActionControl(state, action.id),
      };
    case "editor/apply-state":
      return applyEditorState(state, action.id, action.editorState);
    case "selection/clear-except":
      return {
        effects: [],
        state: clearSelectionsExcept(state, action.id),
      };
    case "active-text/set":
      return {
        effects: [],
        state: state.activeId === action.id ? state : stateWith(state, { activeId: action.id }),
      };
    case "active-action/set":
      return {
        effects: [],
        state: state.activeActionId === action.id ? state : stateWith(state, { activeActionId: action.id }),
      };
    case "menu/set":
      return {
        effects: [],
        state: sameMenuState(state.menu, action.menu) ? state : stateWith(state, { menu: action.menu }),
      };
    case "menu/close":
      return {
        effects: [],
        state: sameMenuState(state.menu, closedMenu) ? state : stateWith(state, { menu: closedMenu }),
      };
    case "pressed-action/set":
      return {
        effects: [],
        state: samePressedAction(state.pressedAction, action.pressedAction)
          ? state
          : stateWith(state, { pressedAction: action.pressedAction }),
      };
  }
};

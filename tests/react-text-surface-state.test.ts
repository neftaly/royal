import { beforeAll, describe, expect, it } from "vitest";
import type { Vec3 } from "@royal/renderer-core";
import {
  createEditableTextEditorState,
  editableTextEditorSelectedText,
  layoutEditableText,
  type EditableTextLayout,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { TextFontFace } from "@royal/renderer-core/text/font";
import {
  closedMenu,
  initialTextSurfaceState,
  reduceTextSurfaceState,
  type ActionControlRegistration,
  type TextControlRegistration,
  type TextSurfaceState,
} from "../packages/react/src/text/surface-state";
import { loadTestTextFont } from "./text-font-fixture";

const origin: Vec3 = [0, 0, 0];
let textFont: TextFontFace;

beforeAll(async () => {
  textFont = await loadTestTextFont();
});

const emptyState = (): TextSurfaceState => ({
  ...initialTextSurfaceState,
  actionControls: new Map(),
  controls: new Map(),
  scrollLines: new Map(),
  selections: new Map(),
});

const selection = (
  anchor: number,
  focus = anchor,
  anchorLine?: number,
  focusLine?: number,
): EditableTextSelection => ({
  anchor,
  anchorLine,
  focus,
  focusLine,
});

const layoutFor = (text: string): EditableTextLayout =>
  layoutEditableText({
    font: textFont,
    fontSize: 1,
    lineHeight: 1.2,
    maxWidth: 100,
    text,
  });

const caretSelectionAtLine = (
  layout: EditableTextLayout,
  lineIndex: number,
): EditableTextSelection => {
  const line = layout.lines[lineIndex];
  if (line === undefined) throw new Error(`Missing test line ${lineIndex}`);
  return selection(line.start, line.start, line.index, line.index);
};

const textControl = ({
  id = "field",
  scrollLine = 0,
  selected = selection(0),
  text = "alpha",
  visibleLineCount = Number.POSITIVE_INFINITY,
}: {
  readonly id?: string;
  readonly scrollLine?: number;
  readonly selected?: EditableTextSelection;
  readonly text?: string;
  readonly visibleLineCount?: number;
} = {}): TextControlRegistration => {
  const layout = layoutFor(text);
  const state = createEditableTextEditorState({
    selection: selected,
    text,
  });

  return {
    bounds: {
      bottom: -1,
      left: 0,
      right: 10,
      top: 1,
    },
    copyable: true,
    editable: true,
    font: textFont,
    id,
    layout,
    mode: "multiline",
    origin,
    selectable: true,
    selectedText: editableTextEditorSelectedText(state),
    selection: state.selection,
    scrollLine,
    state,
    text: state.text,
    visibleLineCount,
  };
};

const actionControl = (id = "button"): ActionControlRegistration => ({
  bounds: {
    bottom: -1,
    left: 0,
    right: 1,
    top: 1,
  },
  disabled: false,
  id,
  kind: "button",
  onPress: () => undefined,
});

describe("React text surface state reducer", () => {
  it("updates editor selection and emits controlled value-change effects", () => {
    const control = textControl({ selected: selection(0), text: "hello" });
    const state: TextSurfaceState = {
      ...emptyState(),
      controls: new Map([[control.id, control]]),
    };
    const editorState = createEditableTextEditorState({
      selection: selection(3),
      text: "HELLO",
    });

    const result = reduceTextSurfaceState(state, {
      editorState,
      id: control.id,
      type: "editor/apply-state",
    });

    expect(result.effects).toEqual([
      {
        id: control.id,
        type: "value-change",
        value: "HELLO",
      },
    ]);
    expect(result.state.selections.get(control.id)).toEqual(editorState.selection);
    expect(result.state.controls.get(control.id)?.selection).toEqual(editorState.selection);
    expect(result.state.controls.get(control.id)?.text).toBe("hello");
  });

  it("clamps registered scroll lines and reveals editor selections", () => {
    const text = "zero\none\ntwo\nthree\nfour";
    const clampedControl = textControl({
      id: "clamped",
      scrollLine: 99,
      text,
      visibleLineCount: 2,
    });

    const clamped = reduceTextSurfaceState(emptyState(), {
      control: clampedControl,
      type: "text-control/register",
    });

    expect(clamped.state.scrollLines.get(clampedControl.id)).toBe(3);
    expect(clamped.state.controls.get(clampedControl.id)?.scrollLine).toBe(3);

    const revealControl = textControl({
      id: "reveal",
      scrollLine: 0,
      text,
      visibleLineCount: 2,
    });
    const registered = reduceTextSurfaceState(emptyState(), {
      control: revealControl,
      type: "text-control/register",
    }).state;
    const registeredControl = registered.controls.get(revealControl.id);
    if (registeredControl === undefined) throw new Error("Missing registered test control");

    const revealDown = reduceTextSurfaceState(registered, {
      editorState: createEditableTextEditorState({
        selection: caretSelectionAtLine(registeredControl.layout, 3),
        text,
      }),
      id: revealControl.id,
      type: "editor/apply-state",
    }).state;

    expect(revealDown.scrollLines.get(revealControl.id)).toBe(2);

    const revealUp = reduceTextSurfaceState(revealDown, {
      editorState: createEditableTextEditorState({
        selection: caretSelectionAtLine(registeredControl.layout, 1),
        text,
      }),
      id: revealControl.id,
      type: "editor/apply-state",
    }).state;

    expect(revealUp.scrollLines.get(revealControl.id)).toBe(1);
  });

  it("clears selections except the requested control", () => {
    const keep = textControl({
      id: "keep",
      selected: selection(1, 4, 0, 0),
      text: "abcdef",
    });
    const clear = textControl({
      id: "clear",
      selected: selection(1, 5, 0, 0),
      text: "uvwxyz",
    });
    const state: TextSurfaceState = {
      ...emptyState(),
      controls: new Map([
        [keep.id, keep],
        [clear.id, clear],
      ]),
    };

    const result = reduceTextSurfaceState(state, {
      id: keep.id,
      type: "selection/clear-except",
    });

    expect(result.state.controls.get(keep.id)?.selection).toEqual(keep.selection);
    expect(result.state.controls.get(clear.id)?.selection).toEqual(selection(5, 5, 0, 0));
    expect(result.state.selections.get(keep.id)).toBeUndefined();
    expect(result.state.selections.get(clear.id)).toEqual(selection(5, 5, 0, 0));
  });

  it("registers controls and unregisters text controls without dropping selections", () => {
    const text = "zero\none\ntwo\nthree";
    const selected = selection(1, 4, 0, 0);
    const control = textControl({
      id: "field",
      selected: selection(0),
      text,
      visibleLineCount: 2,
    });
    const state: TextSurfaceState = {
      ...emptyState(),
      scrollLines: new Map([[control.id, 2]]),
      selections: new Map([[control.id, selected]]),
    };

    const registered = reduceTextSurfaceState(state, {
      control,
      type: "text-control/register",
    }).state;

    expect(registered.controls.get(control.id)?.selection).toEqual(selected);
    expect(registered.controls.get(control.id)?.scrollLine).toBe(2);
    expect(registered.scrollLines.get(control.id)).toBe(2);

    const unregistered = reduceTextSurfaceState(registered, {
      id: control.id,
      type: "text-control/unregister",
    }).state;

    expect(unregistered.controls.has(control.id)).toBe(false);
    expect(unregistered.scrollLines.has(control.id)).toBe(false);
    expect(unregistered.selections.get(control.id)).toEqual(selected);

    const button = actionControl();
    const withAction = reduceTextSurfaceState(unregistered, {
      control: button,
      type: "action-control/register",
    }).state;
    expect(withAction.actionControls.get(button.id)).toBe(button);

    const withoutAction = reduceTextSurfaceState(withAction, {
      id: button.id,
      type: "action-control/unregister",
    }).state;
    expect(withoutAction.actionControls.has(button.id)).toBe(false);
  });

  it("keeps menu and pressed action updates idempotent", () => {
    const menu = {
      controlId: "field",
      open: true,
      worldX: 1,
      worldY: 2,
    };
    const opened = reduceTextSurfaceState(emptyState(), {
      menu,
      type: "menu/set",
    }).state;

    expect(opened.menu).toBe(menu);
    expect(reduceTextSurfaceState(opened, {
      menu: { ...menu },
      type: "menu/set",
    }).state).toBe(opened);

    const closed = reduceTextSurfaceState(opened, { type: "menu/close" }).state;
    expect(closed.menu).toEqual(closedMenu);
    expect(reduceTextSurfaceState(closed, { type: "menu/close" }).state).toBe(closed);

    const pressedAction = {
      controlId: "button",
      pointerId: 7,
    };
    const pressed = reduceTextSurfaceState(closed, {
      pressedAction,
      type: "pressed-action/set",
    }).state;

    expect(pressed.pressedAction).toBe(pressedAction);
    expect(reduceTextSurfaceState(pressed, {
      pressedAction: { ...pressedAction },
      type: "pressed-action/set",
    }).state).toBe(pressed);

    const released = reduceTextSurfaceState(pressed, {
      pressedAction: undefined,
      type: "pressed-action/set",
    }).state;
    expect(released.pressedAction).toBeUndefined();
    expect(reduceTextSurfaceState(released, {
      pressedAction: undefined,
      type: "pressed-action/set",
    }).state).toBe(released);
  });
});

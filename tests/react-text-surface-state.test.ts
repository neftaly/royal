import { beforeAll, describe, expect, it } from "vitest";
import type { Vec3 } from "@royal/renderer-core";
import {
  applyEditableTextEditorKeyInput,
  createEditableTextEditorState,
  editableTextCaretPlacement,
  editableTextEditorSelectedText,
  layoutEditableText,
  type EditableTextEditorState,
  type EditableTextLayout,
  type EditableTextKeyInput,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { TextFontFace } from "@royal/renderer-core/text/font";
import {
  closedMenu,
  clampScrollLineFor,
  initialTextSurfaceState,
  maxScrollLineFor,
  reduceTextSurfaceState,
  scrollLineForRegisteredTextControl,
  type ActionControlRegistration,
  type TextControlRegistration,
  type TextSurfaceState,
  type TextSurfaceStateAction,
  type TextSurfaceStateEffect,
} from "../packages/react/src/text/surface-state";
import { forEachFuzzCase, type SeededRandom } from "./fuzz";
import { loadTestTextFont } from "./text-font-fixture";

const origin: Vec3 = [0, 0, 0];
const textControlIds = ["field-a", "field-b", "field-c"] as const;
const actionControlIds = ["button-a", "button-b"] as const;
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

const textScrollControl = ({
  scrollLine = 0,
  selected = selection(0),
  text = "alpha",
  visibleLineCount = Number.POSITIVE_INFINITY,
}: {
  readonly scrollLine?: number;
  readonly selected?: EditableTextSelection;
  readonly text?: string;
  readonly visibleLineCount?: number;
} = {}) => ({
  layout: layoutFor(text),
  scrollLine,
  selection: selected,
  text,
  visibleLineCount,
});

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

const fuzzText = (random: SeededRandom): string => {
  const characters = ["a", "b", "c", "x", "y", "z", " ", "\n"] as const;
  const length = random.int(0, 28);
  return random.array(length, () => random.pick(characters)).join("");
};

const fuzzSelectionFor = (
  random: SeededRandom,
  layout: EditableTextLayout,
): EditableTextSelection => {
  const anchor = random.int(0, layout.text.length + 1);
  const focus = random.int(0, layout.text.length + 1);
  return {
    anchor,
    anchorLine: editableTextCaretPlacement(layout, anchor)?.line,
    focus,
    focusLine: editableTextCaretPlacement(layout, focus)?.line,
  };
};

const fuzzKeyInput = (random: SeededRandom): EditableTextKeyInput => {
  const key = random.pick([
    "a",
    "b",
    " ",
    "Enter",
    "Backspace",
    "Delete",
    "ArrowLeft",
    "ArrowRight",
    "Home",
    "End",
    "c",
    "x",
    "v",
  ] as const);

  if (key === "c" || key === "x" || key === "v") {
    return random.boolean(0.45) ? { ctrlKey: true, key } : { key };
  }

  return {
    key,
    shiftKey: random.boolean(0.25),
  };
};

const expectRegisteredTextInvariants = (
  state: TextSurfaceState,
  id: string,
  expectedText: string,
): TextControlRegistration => {
  const control = state.controls.get(id);
  if (control === undefined) throw new Error(`Missing registered control ${id}`);

  expect(control.text).toBe(expectedText);
  expect(control.state.text).toBe(expectedText);
  expect(control.layout.text).toBe(expectedText);
  expect(control.selection.anchor).toBeGreaterThanOrEqual(0);
  expect(control.selection.focus).toBeGreaterThanOrEqual(0);
  expect(control.selection.anchor).toBeLessThanOrEqual(expectedText.length);
  expect(control.selection.focus).toBeLessThanOrEqual(expectedText.length);
  expect(control.selectedText).toBe(editableTextEditorSelectedText(control.state));

  const persistedSelection = state.selections.get(id);
  if (persistedSelection !== undefined) {
    expect(control.selection).toEqual(createEditableTextEditorState({
      selection: persistedSelection,
      text: expectedText,
    }).selection);
  }

  expect(control.scrollLine).toBe(clampScrollLineFor(control, control.scrollLine));
  expect(control.scrollLine).toBeGreaterThanOrEqual(0);
  expect(control.scrollLine).toBeLessThanOrEqual(maxScrollLineFor(control));

  const scrollLine = state.scrollLines.get(id);
  if (scrollLine !== undefined) {
    expect(scrollLine).toBe(clampScrollLineFor(control, scrollLine));
    expect(scrollLine).toBeGreaterThanOrEqual(0);
    expect(scrollLine).toBeLessThanOrEqual(maxScrollLineFor(control));
  }

  return control;
};

const expectTextSurfaceStateInvariants = (state: TextSurfaceState): void => {
  for (const [id, control] of state.controls) {
    expect(id).toBe(control.id);
    expectRegisteredTextInvariants(state, id, control.text);
  }

  for (const [id, scrollLine] of state.scrollLines) {
    const control = state.controls.get(id);
    expect(control).toBeDefined();
    if (control === undefined) continue;

    expect(scrollLine).toBe(clampScrollLineFor(control, scrollLine));
  }

  for (const [id, control] of state.actionControls) {
    expect(id).toBe(control.id);
  }

  for (const selection of state.selections.values()) {
    expect(selection.anchor).toBeGreaterThanOrEqual(0);
    expect(selection.focus).toBeGreaterThanOrEqual(0);
  }
};

const expectReducerEffects = (
  before: TextSurfaceState,
  action: TextSurfaceStateAction,
  effects: readonly TextSurfaceStateEffect[],
): void => {
  if (action.type !== "editor/apply-state") {
    expect(effects).toEqual([]);
    return;
  }

  const control = before.controls.get(action.id);
  expect(effects).toEqual(
    control !== undefined && control.text !== action.editorState.text
      ? [{ id: action.id, type: "value-change", value: action.editorState.text }]
      : [],
  );
};

const expectReducerPostcondition = (
  action: TextSurfaceStateAction,
  state: TextSurfaceState,
): void => {
  switch (action.type) {
    case "text-control/register":
      expect(state.controls.get(action.control.id)?.id).toBe(action.control.id);
      expect(state.controls.get(action.control.id)?.scrollLine).toBe(state.scrollLines.get(action.control.id));
      return;
    case "text-control/unregister":
      expect(state.controls.has(action.id)).toBe(false);
      expect(state.scrollLines.has(action.id)).toBe(false);
      return;
    case "action-control/register":
      expect(state.actionControls.get(action.control.id)).toBe(action.control);
      return;
    case "action-control/unregister":
      expect(state.actionControls.has(action.id)).toBe(false);
      return;
    case "editor/apply-state":
      expect(state.selections.get(action.id)).toEqual(action.editorState.selection);
      return;
    case "selection/clear-except":
      for (const control of state.controls.values()) {
        if (control.id !== action.id) {
          expect(control.selection.anchor).toBe(control.selection.focus);
        }
      }
      return;
    case "active-text/set":
      expect(state.activeId).toBe(action.id);
      return;
    case "active-action/set":
      expect(state.activeActionId).toBe(action.id);
      return;
    case "menu/set":
      expect(state.menu).toEqual(action.menu);
      return;
    case "menu/close":
      expect(state.menu).toEqual(closedMenu);
      return;
    case "pressed-action/set":
      expect(state.pressedAction).toEqual(action.pressedAction);
      return;
  }
};

const fuzzVisibleLineCount = (random: SeededRandom): number =>
  random.pick([1, 2, 3, Number.POSITIVE_INFINITY] as const);

const fuzzRegisteredTextControl = (
  random: SeededRandom,
  state: TextSurfaceState,
  textValues: ReadonlyMap<string, string>,
  id: string,
): TextControlRegistration => {
  const text = random.boolean(0.75)
    ? textValues.get(id) ?? state.controls.get(id)?.text ?? fuzzText(random)
    : fuzzText(random);
  const layout = layoutFor(text);

  return textControl({
    id,
    scrollLine: random.int(0, layout.lines.length + 5),
    selected: random.boolean(0.5)
      ? state.selections.get(id) ?? fuzzSelectionFor(random, layout)
      : fuzzSelectionFor(random, layout),
    text,
    visibleLineCount: fuzzVisibleLineCount(random),
  });
};

const fuzzEditorState = (
  random: SeededRandom,
  state: TextSurfaceState,
  textValues: ReadonlyMap<string, string>,
  id: string,
): EditableTextEditorState => {
  const control = state.controls.get(id);
  if (control !== undefined && random.boolean(0.75)) {
    return applyEditableTextEditorKeyInput(control.state, fuzzKeyInput(random), {
      mode: control.mode,
    }).state;
  }

  const text = random.boolean(0.65)
    ? textValues.get(id) ?? control?.text ?? fuzzText(random)
    : fuzzText(random);
  const layout = layoutFor(text);
  return createEditableTextEditorState({
    selection: fuzzSelectionFor(random, layout),
    text,
  });
};

const fuzzTextSurfaceAction = (
  random: SeededRandom,
  state: TextSurfaceState,
  textValues: ReadonlyMap<string, string>,
): TextSurfaceStateAction => {
  const textId = random.pick(textControlIds);
  const actionId = random.pick(actionControlIds);

  switch (random.int(0, 11)) {
    case 0:
    case 1:
      return {
        control: fuzzRegisteredTextControl(random, state, textValues, textId),
        type: "text-control/register",
      };
    case 2:
      return {
        id: textId,
        type: "text-control/unregister",
      };
    case 3:
    case 4:
      return {
        editorState: fuzzEditorState(random, state, textValues, textId),
        id: textId,
        type: "editor/apply-state",
      };
    case 5:
      return {
        id: random.boolean(0.35) ? undefined : textId,
        type: "selection/clear-except",
      };
    case 6:
      return {
        id: random.boolean(0.25) ? undefined : textId,
        type: "active-text/set",
      };
    case 7:
      return {
        id: random.boolean(0.25) ? undefined : actionId,
        type: "active-action/set",
      };
    case 8:
      return {
        control: actionControl(actionId),
        type: "action-control/register",
      };
    case 9:
      return random.boolean(0.5)
        ? { id: actionId, type: "action-control/unregister" }
        : {
          menu: {
            controlId: random.boolean(0.25) ? undefined : textId,
            open: random.boolean(),
            worldX: random.number(-4, 4),
            worldY: random.number(-4, 4),
          },
          type: "menu/set",
        };
    default:
      return random.boolean(0.5)
        ? { type: "menu/close" }
        : {
          pressedAction: random.boolean(0.35)
            ? undefined
            : {
              controlId: actionId,
              pointerId: random.int(0, 6),
            },
          type: "pressed-action/set",
        };
  }
};

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

  it("computes registered scroll lines from small scroll inputs", () => {
    const text = "zero\none\ntwo\nthree\nfour";
    const layout = layoutFor(text);

    expect(scrollLineForRegisteredTextControl({
      control: textScrollControl({
        scrollLine: 0,
        selected: caretSelectionAtLine(layout, 4),
        text,
        visibleLineCount: 2,
      }),
      currentControl: { text },
      persistedScrollLine: 2,
    })).toBe(2);

    expect(scrollLineForRegisteredTextControl({
      control: textScrollControl({
        scrollLine: 0,
        text,
        visibleLineCount: 2,
      }),
      currentControl: undefined,
      persistedScrollLine: 99,
    })).toBe(3);

    expect(scrollLineForRegisteredTextControl({
      control: textScrollControl({
        scrollLine: 0,
        selected: caretSelectionAtLine(layout, 4),
        text,
        visibleLineCount: 2,
      }),
      currentControl: { text: "zero\none" },
      persistedScrollLine: 0,
    })).toBe(3);

    expect(scrollLineForRegisteredTextControl({
      control: textScrollControl({
        scrollLine: 0,
        selected: caretSelectionAtLine(layout, 1),
        text,
        visibleLineCount: 2,
      }),
      currentControl: { text: "zero\none" },
      persistedScrollLine: 3,
    })).toBe(1);

    expect(scrollLineForRegisteredTextControl({
      control: textScrollControl({
        scrollLine: 0,
        selected: caretSelectionAtLine(layout, 4),
        text,
        visibleLineCount: 2,
      }),
      currentControl: { text },
      persistedScrollLine: 0,
    })).toBe(0);
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

  it("keeps controlled editor key updates, re-registration, and scroll windows coherent", () => {
    forEachFuzzCase({ cases: 24, seed: 0x6ef3_7a11 }, ({ label, random }) => {
      const id = `field-${label}`;
      const visibleLineCount = random.pick([1, 2, 3] as const);
      let text = fuzzText(random);
      let layout = layoutFor(text);
      let state = reduceTextSurfaceState(emptyState(), {
        control: textControl({
          id,
          scrollLine: random.int(0, layout.lines.length + 4),
          selected: fuzzSelectionFor(random, layout),
          text,
          visibleLineCount,
        }),
        type: "text-control/register",
      }).state;

      expectRegisteredTextInvariants(state, id, text);

      for (let step = 0; step < 18; step += 1) {
        const control = expectRegisteredTextInvariants(state, id, text);
        const applied = applyEditableTextEditorKeyInput(control.state, fuzzKeyInput(random), {
          mode: "multiline",
        });
        const result = reduceTextSurfaceState(state, {
          editorState: applied.state,
          id,
          type: "editor/apply-state",
        });
        const changedText = applied.state.text !== control.text;

        expect(result.effects).toEqual(
          changedText
            ? [{ id, type: "value-change", value: applied.state.text }]
            : [],
        );
        expect(result.state.selections.get(id)).toEqual(applied.state.selection);

        text = changedText ? applied.state.text : text;
        layout = layoutFor(text);
        const previousControl = result.state.controls.get(id);
        const persistedScrollLine = result.state.scrollLines.get(id);
        state = reduceTextSurfaceState(result.state, {
          control: textControl({
            id,
            selected: selection(0),
            text,
            visibleLineCount,
          }),
          type: "text-control/register",
        }).state;

        const registered = expectRegisteredTextInvariants(state, id, text);
        expect(registered.selection).toEqual(applied.state.selection);
        expect(state.scrollLines.get(id)).toBe(
          scrollLineForRegisteredTextControl({
            control: {
              layout: registered.layout,
              scrollLine: 0,
              selection: registered.selection,
              text: registered.text,
              visibleLineCount: registered.visibleLineCount,
            },
            currentControl: previousControl,
            persistedScrollLine,
          }),
        );
        expect(registered.layout.lines).toEqual(layout.lines);
      }
    });
  });

  it("preserves state invariants across deterministic text surface action sequences", () => {
    forEachFuzzCase({ cases: 16, seed: 0x5a7e_51af }, ({ random }) => {
      const textValues = new Map<string, string>();
      let state = emptyState();

      for (const id of textControlIds.slice(0, 2)) {
        const control = fuzzRegisteredTextControl(random, state, textValues, id);
        textValues.set(id, control.text);
        state = reduceTextSurfaceState(state, {
          control,
          type: "text-control/register",
        }).state;
      }

      expectTextSurfaceStateInvariants(state);

      for (let step = 0; step < 28; step += 1) {
        const action = fuzzTextSurfaceAction(random, state, textValues);
        const result = reduceTextSurfaceState(state, action);

        expectReducerEffects(state, action, result.effects);
        expectReducerPostcondition(action, result.state);
        expectTextSurfaceStateInvariants(result.state);

        if (action.type === "text-control/register") {
          textValues.set(action.control.id, action.control.text);
        }
        for (const effect of result.effects) {
          textValues.set(effect.id, effect.value);
        }

        state = result.state;
      }

      expectTextSurfaceStateInvariants(state);
    });
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

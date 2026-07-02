import { describe, expect, it } from "vitest";
import {
  createEditableTextEditorState,
  applyEditableTextEditorKeyInput,
  editableTextEditorContextMenuSelection,
  layoutEditableText,
  pasteEditableTextEditorText,
  setEditableTextEditorSelection,
  type EditableTextCaretPlacement,
  type EditableTextHitPoint,
  type EditableTextLayout,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { Vec3 } from "@royal/renderer-core";

const origin: Vec3 = [0, 0, 0];

const singleLineLayout = (text: string): EditableTextLayout =>
  layoutEditableText({
    fontSize: 1,
    lineHeight: 1.2,
    maxWidth: 100,
    text,
  });

const selection = (anchor: number, focus = anchor): EditableTextSelection => ({
  anchor,
  anchorLine: undefined,
  focus,
  focusLine: undefined,
});

const lineSelection = (anchor: number, focus = anchor): EditableTextSelection => ({
  anchor,
  anchorLine: 0,
  focus,
  focusLine: 0,
});

const caretAt = (
  layout: EditableTextLayout,
  index: number,
): EditableTextCaretPlacement => {
  const placement = layout.caretPlacements.find((candidate) => candidate.index === index);
  if (placement === undefined) throw new Error(`Missing caret placement for ${index}`);
  return placement;
};

const pointAtCaret = (
  layout: EditableTextLayout,
  index: number,
): EditableTextHitPoint => {
  const caret = caretAt(layout, index);
  return {
    x: origin[0] + caret.x,
    y: origin[1] - caret.line * layout.lineHeight,
  };
};

describe("editable text interaction", () => {
  it("reports clipboard keyboard shortcuts without mutating editor state", () => {
    const state = createEditableTextEditorState({
      selection: selection(1, 4),
      text: "abcdef",
    });

    for (const [key, shortcut] of [
      ["c", "copy"],
      ["x", "cut"],
      ["v", "paste"],
    ] as const) {
      const result = applyEditableTextEditorKeyInput(state, {
        ctrlKey: true,
        key,
      });

      expect(result.intent).toEqual({ shortcut, type: "clipboard-shortcut" });
      expect(result.state).toBe(state);
    }
  });

  it("inserts a paste payload at the caret and updates selection", () => {
    const state = createEditableTextEditorState({
      selection: selection(5),
      text: "Hello world",
    });

    const next = pasteEditableTextEditorText(state, " brave");

    expect(next.text).toBe("Hello brave world");
    expect(next.selection).toEqual(selection(11));
  });

  it("moves the caret to a non-selected context-click position before paste", () => {
    const layout = singleLineLayout("abcdef");
    const selectedState = createEditableTextEditorState({
      selection: selection(1, 3),
      text: "abcdef",
    });

    const contextSelection = editableTextEditorContextMenuSelection({
      layout,
      origin,
      point: pointAtCaret(layout, 5),
      state: selectedState,
    });
    const menuState = setEditableTextEditorSelection(selectedState, contextSelection);
    const pasted = pasteEditableTextEditorText(menuState, "X");

    expect(contextSelection).toEqual(lineSelection(5));
    expect(pasted.text).toBe("abcdeXf");
    expect(pasted.selection).toEqual(selection(6));
  });

  it("preserves an existing selection when context-clicking inside it", () => {
    const layout = singleLineLayout("abcdef");
    const selectedState = createEditableTextEditorState({
      selection: selection(1, 4),
      text: "abcdef",
    });

    const contextSelection = editableTextEditorContextMenuSelection({
      layout,
      origin,
      point: pointAtCaret(layout, 2),
      state: selectedState,
    });
    const menuState = setEditableTextEditorSelection(selectedState, contextSelection);
    const pasted = pasteEditableTextEditorText(menuState, "X");

    expect(contextSelection).toEqual(selection(1, 4));
    expect(pasted.text).toBe("aXef");
    expect(pasted.selection).toEqual(selection(2));
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import {
  createEditableTextEditorState,
  createEditableTextFragment,
  applyEditableTextEditorKeyInput,
  editableTextEditorContextMenuSelection,
  editableTextEditorPointerSelection,
  layoutEditableText,
  nearestEditableTextCaret,
  pasteEditableTextEditorText,
  setEditableTextEditorSelection,
  type EditableTextCaretPlacement,
  type EditableTextHitPoint,
  type EditableTextLayout,
  type EditableTextSelection,
} from "@royal/renderer-core/text/editable";
import type { Vec3 } from "@royal/renderer-core";
import type { TextFontFace } from "@royal/renderer-core/text/font";
import { loadTestTextFont } from "./text-font-fixture";

const origin: Vec3 = [0, 0, 0];
let textFont: TextFontFace;

beforeAll(async () => {
  textFont = await loadTestTextFont();
});

const singleLineLayout = (text: string): EditableTextLayout =>
  layoutEditableText({
    font: textFont,
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

  it("places the pointer caret by x position in single-line infinite-width layouts", () => {
    const layout = layoutEditableText({
      font: textFont,
      fontSize: 1,
      lineHeight: 1.2,
      maxWidth: Number.POSITIVE_INFINITY,
      text: "abcdef",
    });
    const state = createEditableTextEditorState({ text: "abcdef" });
    const point = pointAtCaret(layout, 3);

    expect(nearestEditableTextCaret(layout, point, origin)).toMatchObject({
      index: 3,
      line: 0,
    });
    expect(editableTextEditorPointerSelection({
      layout,
      origin,
      point,
      state,
    })).toEqual(lineSelection(3));
  });

  it("renders editable text fragments through a visible line window", () => {
    const state = createEditableTextEditorState({
      selection: {
        anchor: 6,
        anchorLine: 1,
        focus: 17,
        focusLine: 2,
      },
      text: "alpha\nbravo\ncharlie\ndelta",
    });
    const fragment = createEditableTextFragment({
      color: [1, 1, 1, 1],
      font: textFont,
      fontSize: 1,
      lineHeight: 1.2,
      lineWindow: {
        lineCount: 2,
        startLine: 1,
      },
      maxWidth: 100,
      origin,
      selection: state.selection,
      showCaret: true,
      text: state.text,
    });
    const textNode = fragment.nodes.find((node) => node.kind === "text");

    expect(textNode).toMatchObject({
      layout: {
        source: "bravo\ncharlie",
      },
    });
    expect(fragment.selectionRects.map((rect) => rect.line)).toEqual([1, 2]);
    expect(fragment.caretPosition[1]).toBeGreaterThan(-2.4);
  });

  it("renders single-line fragments through one wrapped viewport line", () => {
    const fragment = createEditableTextFragment({
      color: [1, 1, 1, 1],
      font: textFont,
      fontSize: 1,
      lineHeight: 1.2,
      lineWindow: {
        lineCount: 1,
        startLine: 1,
      },
      maxWidth: 2,
      mode: "single-line",
      origin,
      selection: selection(8),
      showCaret: true,
      text: "alpha beta gamma",
    });
    const textNode = fragment.nodes.find((node) => node.kind === "text");

    expect(textNode?.layout.source.split("\n")).toHaveLength(1);
    expect(fragment.layout.lines.length).toBeGreaterThan(1);
  });
});

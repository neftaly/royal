import { describe, expect, it } from "vitest";
import { editableTextKeyIntent } from "@royal/renderer-core/text/editable";
import {
  editableTextKeyboardIntent,
  type EditableTextClipboardShortcut,
  type EditableTextClipboardShortcutIntent,
  type EditableTextEnterKeyIntent,
  type EditableTextKeyboardInput,
  type EditableTextKeyboardIntent,
  type EditableTextKeyboardMode,
  type EditableTextKeyboardOptions,
} from "@royal/react";

type KeyIntentCase = readonly [
  input: EditableTextKeyboardInput,
  options: EditableTextKeyboardOptions | undefined,
];

describe("React editable text keyboard public API", () => {
  it("adapts renderer-core key intents through React names", () => {
    const shortcut: EditableTextClipboardShortcut = "copy";
    const clipboardIntent = {
      shortcut,
      type: "clipboard-shortcut",
    } satisfies EditableTextClipboardShortcutIntent;
    const enterIntent = { type: "enter-key" } satisfies EditableTextEnterKeyIntent;
    const mode: EditableTextKeyboardMode = "multiline";
    const options: EditableTextKeyboardOptions = { mode };
    const publicIntents: readonly EditableTextKeyboardIntent[] = [
      clipboardIntent,
      enterIntent,
      { text: "\n", type: "insert-text" },
    ];

    expect(publicIntents).toEqual([
      { shortcut: "copy", type: "clipboard-shortcut" },
      { type: "enter-key" },
      { text: "\n", type: "insert-text" },
    ]);

    const cases: readonly KeyIntentCase[] = [
      [{ ctrlKey: true, key: "c" }, undefined],
      [{ key: "Enter" }, undefined],
      [{ key: "Enter" }, options],
      [{ key: "ArrowLeft", shiftKey: true }, undefined],
      [{ key: "Dead" }, undefined],
      [{ altKey: true, key: "a" }, undefined],
    ];

    for (const [input, currentOptions] of cases) {
      expect(editableTextKeyboardIntent(input, currentOptions)).toEqual(
        editableTextKeyIntent(input, currentOptions),
      );
    }
  });
});

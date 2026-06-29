#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const origin = { x: 0, y: 0 };
const lineHeight = 18;
const selectionHeight = 16;
const selectionYOffset = -4;
const requiredKinds = new Set(["input", "textarea", "checkbox", "radio", "select", "listbox", "button", "slider"]);

const reportJson = process.argv.includes("--json");

const controls = [
  textControl({
    id: "name",
    kind: "input",
    label: "Name",
    order: 1,
    value: "Ada",
    maxColumns: 18,
    bounds: rect(16, 16, 260, 32),
    required: true,
  }),
  textControl({
    id: "bio",
    kind: "textarea",
    label: "Biography",
    order: 2,
    value: "Line one\nLine two wraps here",
    maxColumns: 12,
    bounds: rect(16, 60, 260, 92),
  }),
  textControl({
    id: "readonly-token",
    kind: "input",
    label: "Read-only token",
    order: 3,
    value: "TOKEN-42",
    maxColumns: 12,
    bounds: rect(16, 164, 200, 32),
    readOnly: true,
  }),
  textControl({
    id: "disabled-secret",
    kind: "input",
    label: "Disabled secret",
    order: 4,
    value: "locked",
    maxColumns: 12,
    bounds: rect(16, 204, 200, 32),
    disabled: true,
  }),
  {
    id: "subscribe",
    kind: "checkbox",
    label: "Subscribe",
    order: 5,
    checked: false,
    disabled: false,
    bounds: rect(16, 248, 24, 24),
  },
  {
    id: "contact-email",
    kind: "radio",
    label: "Email",
    name: "contact",
    order: 6,
    checked: true,
    value: "email",
    disabled: false,
    bounds: rect(16, 288, 24, 24),
  },
  {
    id: "contact-phone",
    kind: "radio",
    label: "Phone",
    name: "contact",
    order: 7,
    checked: false,
    value: "phone",
    disabled: false,
    bounds: rect(96, 288, 24, 24),
  },
  {
    id: "country",
    kind: "select",
    label: "Country",
    order: 8,
    selectedIndex: 1,
    open: false,
    options: options("country-option", ["Australia", "New Zealand", "Samoa"]),
    disabled: false,
    bounds: rect(16, 328, 220, 34),
  },
  {
    id: "region",
    kind: "listbox",
    label: "Region",
    order: 9,
    selectedIndex: 0,
    activeIndex: 0,
    options: options("region-option", ["North", "South", "West"]),
    disabled: false,
    bounds: rect(16, 374, 220, 86),
  },
  {
    id: "volume",
    kind: "slider",
    label: "Volume",
    order: 10,
    min: 0,
    max: 100,
    step: 5,
    value: 35,
    disabled: false,
    bounds: rect(16, 474, 220, 28),
  },
  {
    id: "submit",
    kind: "button",
    label: "Submit",
    order: 11,
    pressCount: 0,
    disabled: false,
    bounds: rect(16, 518, 96, 34),
  },
];

const initialState = {
  controls,
  clipboard: {
    last: { action: "none", ok: false, reason: "none", fallback: false, text: "" },
    text: "",
  },
  composition: { active: false, controlId: undefined, text: "" },
  focusId: undefined,
  pointerCapture: undefined,
};

const checks = [
  ["primitive coverage", validatePrimitiveCoverage],
  ["renderer projection", validateRendererProjection],
  ["focus order", validateFocusOrder],
  ["keyboard navigation", validateKeyboardNavigation],
  ["pointer capture", validatePointerCapture],
  ["clipboard and IME", validateClipboardAndIme],
  ["selection geometry", validateSelectionGeometry],
  ["ARIA projection", validateAriaProjection],
  ["large form", validateLargeForm],
];

const started = performance.now();
const results = [];
for (const [name, validate] of checks) {
  const checkStarted = performance.now();
  const details = validate();
  results.push({
    name,
    ok: true,
    durationMs: round(performance.now() - checkStarted),
    details,
  });
}

const report = {
  schemaVersion: "royal.research.form-controls.prototype.v0",
  checkCount: results.length,
  durationMs: round(performance.now() - started),
  primitiveKinds: [...requiredKinds].sort(),
  controls: controls.map((control) => projectControlSummary(control, initialState)),
  results,
};

if (reportJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(
    `form controls prototype checks passed: ${report.checkCount} checks, ${controls.length} controls, ${report.durationMs} ms`,
  );
}

function validatePrimitiveCoverage() {
  const kinds = new Set(controls.map((control) => control.kind));
  for (const kind of requiredKinds) {
    assert(kinds.has(kind), `missing primitive kind ${kind}`);
  }

  const metadata = projectAccessibilityTree(initialState);
  assert(metadata.nodes.length === controls.length, "accessibility metadata should include every control");

  return {
    kinds: [...kinds].sort(),
    accessibilityNodeCount: metadata.nodes.length,
  };
}

function validateRendererProjection() {
  let state = setFocus(cloneState(initialState), "name");
  state = setSelection(state, "name", 0, 2);
  state = updateControl(state, "country", () => ({ open: true }));

  const tree = projectRenderTree(state);
  assert(tree.packets.length >= controls.length, "renderer projection should produce at least one packet per control");
  assert(
    tree.packets.some((packet) => packet.kind === "control-box" && packet.controlId === "name"),
    "input should produce a control box packet",
  );
  assert(
    tree.packets.some((packet) => packet.kind === "text-run" && packet.controlId === "name"),
    "input should produce text run packets",
  );
  assert(
    tree.packets.some((packet) => packet.kind === "selection-rect" && packet.controlId === "name"),
    "selected input should produce selection rect packets",
  );
  assert(
    tree.packets.some((packet) => packet.kind === "caret" && packet.controlId === "name"),
    "focused input should produce a caret packet",
  );
  assert(
    tree.packets.some((packet) => packet.kind === "slider-thumb" && packet.controlId === "volume"),
    "slider should produce a thumb packet",
  );
  assert(
    tree.packets.some((packet) => packet.kind === "option-row" && packet.controlId === "country"),
    "open select should produce option row packets",
  );
  assert(
    tree.packets.some((packet) => packet.controlId === "disabled-secret" && packet.state?.disabled === true),
    "disabled state should be present in renderer packets",
  );

  return {
    packetCount: tree.packets.length,
    coordinateSpace: tree.coordinateSpace,
  };
}

function validateFocusOrder() {
  let state = cloneState(initialState);
  state = focusNext(state, 1);
  assertEqual(state.focusId, "name", "first Tab should focus first input");

  const visited = [];
  for (let index = 0; index < 12; index += 1) {
    visited.push(state.focusId);
    state = focusNext(state, 1);
  }

  assert(!visited.includes("disabled-secret"), "disabled controls must not enter focus order");
  assert(visited.includes("readonly-token"), "read-only text controls should remain focusable");
  assert(visited.includes("contact-email"), "checked radio should be the group tab stop");
  assert(!visited.includes("contact-phone"), "unchecked radio should not be a separate tab stop");

  state = setFocus(cloneState(initialState), "contact-email");
  state = keyDown(state, { key: "ArrowRight" });
  assertEqual(state.focusId, "contact-phone", "radio ArrowRight should move focus inside group");
  assert(controlById(state, "contact-phone").checked, "radio ArrowRight should check focused radio");

  state = focusNext(state, 1);
  assertEqual(state.focusId, "country", "Tab after radio group should continue to next control");
  state = focusNext(state, -1);
  assertEqual(state.focusId, "contact-phone", "Shift+Tab should return to checked radio");

  return {
    visited,
    radioAfterArrow: checkedRadioId(state, "contact"),
  };
}

function validateKeyboardNavigation() {
  let state = setFocus(cloneState(initialState), "name");
  state = keyDown(state, { key: "End" });
  state = keyDown(state, { key: "ArrowLeft", shiftKey: true });
  assertEqual(selectedText(controlById(state, "name")), "a", "Shift+ArrowLeft should select previous character");

  state = keyDown(state, { key: "Z" });
  assertEqual(controlById(state, "name").value, "AdZ", "printable key should replace selection");
  assertEqual(controlById(state, "name").selection.focus, 3, "input caret should land after inserted text");

  state = keyDown(state, { key: "a", ctrlKey: true });
  assertEqual(selectedText(controlById(state, "name")), "AdZ", "Ctrl+A should select text control value");

  state = setFocus(state, "readonly-token");
  const beforeReadOnly = controlById(state, "readonly-token").value;
  state = keyDown(state, { key: "X" });
  assertEqual(controlById(state, "readonly-token").value, beforeReadOnly, "read-only input should not mutate");

  state = setFocus(state, "subscribe");
  state = keyDown(state, { key: " " });
  assert(controlById(state, "subscribe").checked, "Space should toggle checkbox");

  state = setFocus(state, "country");
  state = keyDown(state, { key: "ArrowDown" });
  assertEqual(selectedOption(controlById(state, "country")).label, "Samoa", "select ArrowDown should change option");
  state = keyDown(state, { key: "Enter" });
  assert(controlById(state, "country").open, "select Enter should toggle open state");

  state = setFocus(state, "region");
  state = keyDown(state, { key: "ArrowDown" });
  assertEqual(selectedOption(controlById(state, "region")).label, "South", "listbox ArrowDown should change option");

  state = setFocus(state, "volume");
  state = keyDown(state, { key: "ArrowRight" });
  assertEqual(controlById(state, "volume").value, 40, "slider ArrowRight should increment");
  state = keyDown(state, { key: "Home" });
  assertEqual(controlById(state, "volume").value, 0, "slider Home should move to minimum");
  state = keyDown(state, { key: "End" });
  assertEqual(controlById(state, "volume").value, 100, "slider End should move to maximum");

  state = setFocus(state, "submit");
  state = keyDown(state, { key: "Enter" });
  assertEqual(controlById(state, "submit").pressCount, 1, "button Enter should activate");

  return {
    nameValue: controlById(state, "name").value,
    selectedCountry: selectedOption(controlById(state, "country")).label,
    volume: controlById(state, "volume").value,
    submitPressCount: controlById(state, "submit").pressCount,
  };
}

function validatePointerCapture() {
  let state = cloneState(initialState);
  state = pointerDown(state, "volume", { pointerId: 7, x: 16, y: 486 });
  assertEqual(state.pointerCapture?.controlId, "volume", "slider pointer down should capture pointer");
  state = pointerMove(state, { pointerId: 7, x: 999, y: 486 });
  assertEqual(controlById(state, "volume").value, 100, "captured slider drag should clamp outside bounds");
  state = pointerUp(state, { pointerId: 7, x: 999, y: 486 });
  assertEqual(state.pointerCapture, undefined, "pointer up should release capture");

  state = pointerDown(state, "bio", { pointerId: 8, x: 1, y: 1 });
  state = pointerMove(state, { pointerId: 8, x: 24, y: 38 });
  const bio = controlById(state, "bio");
  const rects = selectionRects(layoutTextPrimitive(bio.value, bio.maxColumns), sortedRange(bio.selection), origin);
  assert(rects.length > 0, "captured textarea drag should produce selection rects");
  state = pointerUp(state, { pointerId: 8, x: 24, y: 38 });
  assertEqual(state.pointerCapture, undefined, "textarea pointer up should release capture");

  return {
    sliderAfterDrag: controlById(state, "volume").value,
    textareaSelectionRects: rects.length,
  };
}

function validateClipboardAndIme() {
  let state = setFocus(cloneState(initialState), "name");
  state = keyDown(state, { key: "a", ctrlKey: true });
  state = clipboardAction(state, "copy", { mode: "async-granted" });
  assertEqual(state.clipboard.text, "Ada", "async copy should write selected text");
  assert(state.clipboard.last.ok, "async copy should succeed");

  state = clipboardAction(state, "copy", { mode: "async-denied" });
  assert(!state.clipboard.last.ok, "denied async copy should fail");
  assertEqual(state.clipboard.last.reason, "denied", "denied async copy should expose denied reason");
  assert(state.clipboard.last.fallback, "denied async copy should request fallback UI");

  state = setSelection(state, "name", 3, 3);
  state = clipboardAction(state, "paste", { mode: "native-event", text: " Lovelace" });
  assertEqual(controlById(state, "name").value, "Ada Lovelace", "native clipboard event paste should insert text");

  state = setSelection(state, "name", controlById(state, "name").value.length, controlById(state, "name").value.length);
  state = compositionStart(state, "name");
  state = compositionUpdate(state, "界");
  const beforeKeyDuringComposition = controlById(state, "name").value;
  state = keyDown(state, { key: "x", isComposing: true });
  assertEqual(controlById(state, "name").value, beforeKeyDuringComposition, "keydown should not mutate while composing");
  state = compositionEnd(state, "世界");
  assert(controlById(state, "name").value.endsWith("世界"), "composition end should commit text once");

  state = setFocus(state, "readonly-token");
  const beforeReadOnlyPaste = controlById(state, "readonly-token").value;
  state = clipboardAction(state, "paste", { mode: "native-event", text: "mutate" });
  assertEqual(controlById(state, "readonly-token").value, beforeReadOnlyPaste, "read-only paste should not mutate");

  return {
    clipboardLast: state.clipboard.last,
    imeCommittedValue: controlById(state, "name").value,
  };
}

function validateSelectionGeometry() {
  const control = controlById(initialState, "bio");
  const layout = layoutTextPrimitive(control.value, control.maxColumns);
  const range = { start: 2, end: control.value.length - 2, startLine: undefined, endLine: undefined };
  const rects = selectionRects(layout, range, origin);

  assert(rects.length >= 2, "textarea selection should span multiple rectangles");
  for (const rect of rects) {
    assert(rect.width > 0, "selection rect width should be positive");
    assert(rect.height > 0, "selection rect height should be positive");
    assert(rect.width <= control.maxColumns, "selection rect should not exceed text max width");
    assert(rect.start < rect.end, "selection rect text range should be ordered");
  }

  const emoji = "a🙂b";
  assertEqual(previousTextIndex(emoji, emoji.length), 3, "previousTextIndex should preserve surrogate-pair boundary");
  assertEqual(nextTextIndex(emoji, 1), 3, "nextTextIndex should advance over surrogate pair");

  return {
    lineCount: layout.lines.length,
    rectCount: rects.length,
    rects,
  };
}

function validateAriaProjection() {
  const tree = projectAccessibilityTree(initialState);
  const byId = new Map(tree.nodes.map((node) => [node.id, node]));

  assertEqual(byId.get("name")?.role, "textbox", "input should project textbox role");
  assertEqual(byId.get("bio")?.attributes["aria-multiline"], "true", "textarea should project multiline");
  assertEqual(byId.get("subscribe")?.attributes["aria-checked"], "false", "checkbox should project checked state");
  assertEqual(byId.get("contact-email")?.attributes["aria-checked"], "true", "radio should project checked state");
  assertEqual(byId.get("country")?.role, "combobox", "select should project combobox role");
  assertEqual(byId.get("country")?.attributes["aria-controls"], "country-listbox", "select should point at popup listbox");
  assertEqual(byId.get("region")?.role, "listbox", "listbox should project listbox role");
  assertEqual(byId.get("volume")?.attributes["aria-valuenow"], "35", "slider should project current value");
  assertEqual(byId.get("disabled-secret")?.attributes["aria-disabled"], "true", "disabled input should project aria-disabled");
  assertEqual(byId.get("readonly-token")?.attributes["aria-readonly"], "true", "read-only input should project aria-readonly");

  const optionCount = tree.nodes.reduce((count, node) => count + (node.children?.length ?? 0), 0);
  assert(optionCount >= 6, "select/listbox options should be represented");

  return {
    nodeCount: tree.nodes.length,
    optionCount,
  };
}

function validateLargeForm() {
  const largeControls = makeLargeForm(300);
  let state = {
    ...cloneState(initialState),
    controls: largeControls,
    focusId: undefined,
  };
  const tabStops = focusableControls(state);
  assert(tabStops.length > 200, "large form should expose many focusable controls");
  assert(tabStops.every((control) => !control.disabled), "large form focus order should skip disabled controls");

  const visited = new Set();
  for (let index = 0; index < tabStops.length; index += 1) {
    state = focusNext(state, 1);
    assert(!visited.has(state.focusId), `focus cycle repeated before visiting all controls at ${state.focusId}`);
    visited.add(state.focusId);
  }

  const ariaTree = projectAccessibilityTree(state);
  assertEqual(ariaTree.nodes.length, largeControls.length, "large form ARIA projection should cover all controls");

  return {
    controlCount: largeControls.length,
    tabStopCount: tabStops.length,
    ariaNodeCount: ariaTree.nodes.length,
  };
}

function textControl({
  id,
  kind,
  label,
  order,
  value,
  maxColumns,
  bounds,
  disabled = false,
  readOnly = false,
  required = false,
}) {
  const caret = value.length;
  return {
    id,
    kind,
    label,
    order,
    value,
    maxColumns,
    bounds,
    disabled,
    readOnly,
    required,
    selection: { anchor: caret, anchorLine: undefined, focus: caret, focusLine: undefined },
  };
}

function rect(x, y, width, height) {
  return { x, y, width, height };
}

function options(prefix, labels) {
  return labels.map((label, index) => ({
    id: `${prefix}-${index}`,
    label,
    value: label.toLowerCase().replaceAll(" ", "-"),
  }));
}

function cloneState(state) {
  return structuredClone(state);
}

function controlById(state, id) {
  const control = state.controls.find((candidate) => candidate.id === id);
  assert(control !== undefined, `missing control ${id}`);
  return control;
}

function updateControl(state, id, update) {
  return {
    ...state,
    controls: state.controls.map((control) =>
      control.id === id ? { ...control, ...update(control) } : control
    ),
  };
}

function setFocus(state, id) {
  const control = controlById(state, id);
  if (control.disabled) return state;
  return { ...state, focusId: id };
}

function focusNext(state, direction) {
  const focusable = focusableControls(state);
  if (focusable.length === 0) return { ...state, focusId: undefined };
  const currentIndex = focusable.findIndex((control) => control.id === state.focusId);
  const nextIndex = currentIndex === -1
    ? direction > 0 ? 0 : focusable.length - 1
    : mod(currentIndex + direction, focusable.length);
  return { ...state, focusId: focusable[nextIndex].id };
}

function focusableControls(state) {
  return state.controls
    .filter((control) => isTabStop(control, state))
    .sort((left, right) => left.order - right.order);
}

function isTabStop(control, state) {
  if (control.disabled) return false;
  if (control.kind !== "radio") return true;

  const group = radioGroup(state, control.name);
  const checked = group.find((candidate) => candidate.checked);
  return (checked ?? group[0])?.id === control.id;
}

function radioGroup(state, name) {
  return state.controls
    .filter((control) => control.kind === "radio" && control.name === name && !control.disabled)
    .sort((left, right) => left.order - right.order);
}

function checkedRadioId(state, name) {
  return radioGroup(state, name).find((control) => control.checked)?.id;
}

function keyDown(state, event) {
  if (event.key === "Tab") return focusNext(state, event.shiftKey ? -1 : 1);
  if (event.isComposing || state.composition.active) return state;

  const control = state.focusId === undefined ? undefined : controlById(state, state.focusId);
  if (control === undefined || control.disabled) return state;

  if (control.kind === "input" || control.kind === "textarea") return keyDownText(state, control, event);
  if (control.kind === "checkbox") return keyDownCheckbox(state, control, event);
  if (control.kind === "radio") return keyDownRadio(state, control, event);
  if (control.kind === "select") return keyDownSelect(state, control, event);
  if (control.kind === "listbox") return keyDownListbox(state, control, event);
  if (control.kind === "slider") return keyDownSlider(state, control, event);
  if (control.kind === "button") return keyDownButton(state, control, event);

  return state;
}

function keyDownText(state, control, event) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
    return updateTextSelection(state, control.id, 0, control.value.length);
  }

  const range = sortedRange(control.selection);
  const hasSelection = range.start !== range.end;

  if (event.key === "ArrowLeft") {
    const nextIndex = !event.shiftKey && hasSelection ? range.start : previousTextIndex(control.value, control.selection.focus);
    return moveTextCaret(state, control, nextIndex, event.shiftKey);
  }

  if (event.key === "ArrowRight") {
    const nextIndex = !event.shiftKey && hasSelection ? range.end : nextTextIndex(control.value, control.selection.focus);
    return moveTextCaret(state, control, nextIndex, event.shiftKey);
  }

  if (event.key === "Home") return moveTextCaret(state, control, 0, event.shiftKey);
  if (event.key === "End") return moveTextCaret(state, control, control.value.length, event.shiftKey);

  if (control.readOnly) return state;

  if (event.key === "Backspace") {
    if (hasSelection) return replaceTextRange(state, control, range, "");
    const start = previousTextIndex(control.value, control.selection.focus);
    return replaceTextRange(state, control, { start, end: control.selection.focus }, "");
  }

  if (event.key === "Delete") {
    if (hasSelection) return replaceTextRange(state, control, range, "");
    const end = nextTextIndex(control.value, control.selection.focus);
    return replaceTextRange(state, control, { start: control.selection.focus, end }, "");
  }

  if (event.key === "Enter" && control.kind === "textarea") {
    return replaceTextRange(state, control, range, "\n");
  }

  if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return replaceTextRange(state, control, range, event.key);
  }

  return state;
}

function keyDownCheckbox(state, control, event) {
  if (event.key !== " ") return state;
  return updateControl(state, control.id, (current) => ({ checked: !current.checked }));
}

function keyDownRadio(state, control, event) {
  if (event.key === " " || event.key === "Enter") return checkRadio(state, control);
  if (!["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(event.key)) return state;

  const group = radioGroup(state, control.name);
  const index = group.findIndex((candidate) => candidate.id === control.id);
  const delta = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
  const next = group[mod(index + delta, group.length)];
  return checkRadio({ ...state, focusId: next.id }, next);
}

function checkRadio(state, control) {
  return {
    ...state,
    controls: state.controls.map((candidate) =>
      candidate.kind === "radio" && candidate.name === control.name
        ? { ...candidate, checked: candidate.id === control.id }
        : candidate
    ),
  };
}

function keyDownSelect(state, control, event) {
  if (event.key === "Enter" || event.key === " ") {
    return updateControl(state, control.id, (current) => ({ open: !current.open }));
  }

  const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (delta === 0) return state;
  return updateControl(state, control.id, (current) => ({
    selectedIndex: clamp(current.selectedIndex + delta, 0, current.options.length - 1),
  }));
}

function keyDownListbox(state, control, event) {
  const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  if (delta === 0) return state;
  return updateControl(state, control.id, (current) => {
    const selectedIndex = clamp(current.selectedIndex + delta, 0, current.options.length - 1);
    return { activeIndex: selectedIndex, selectedIndex };
  });
}

function keyDownSlider(state, control, event) {
  if (event.key === "Home") return updateControl(state, control.id, () => ({ value: control.min }));
  if (event.key === "End") return updateControl(state, control.id, () => ({ value: control.max }));

  const delta = event.key === "ArrowRight" || event.key === "ArrowUp"
    ? control.step
    : event.key === "ArrowLeft" || event.key === "ArrowDown"
      ? -control.step
      : 0;
  if (delta === 0) return state;
  return updateControl(state, control.id, () => ({ value: clampToStep(control.value + delta, control) }));
}

function keyDownButton(state, control, event) {
  if (event.key !== "Enter" && event.key !== " ") return state;
  return updateControl(state, control.id, (current) => ({ pressCount: current.pressCount + 1 }));
}

function moveTextCaret(state, control, index, extend) {
  const caret = clamp(index, 0, control.value.length);
  return updateControl(state, control.id, (current) => ({
    selection: {
      anchor: extend ? current.selection.anchor : caret,
      anchorLine: undefined,
      focus: caret,
      focusLine: undefined,
    },
  }));
}

function updateTextSelection(state, controlId, anchor, focus) {
  return updateControl(state, controlId, () => ({
    selection: { anchor, anchorLine: undefined, focus, focusLine: undefined },
  }));
}

function setSelection(state, controlId, anchor, focus) {
  return updateTextSelection(state, controlId, anchor, focus);
}

function replaceTextRange(state, control, range, insertText) {
  if (control.readOnly || control.disabled) return state;
  const nextValue = `${control.value.slice(0, range.start)}${insertText}${control.value.slice(range.end)}`;
  const caret = range.start + insertText.length;
  return updateControl(state, control.id, () => ({
    value: nextValue,
    selection: { anchor: caret, anchorLine: undefined, focus: caret, focusLine: undefined },
  }));
}

function pointerDown(state, controlId, pointer) {
  const control = controlById(state, controlId);
  if (control.disabled) return state;
  let next = setFocus(state, controlId);

  if (control.kind === "slider") {
    next = sliderValueFromPointer(next, control, pointer.x);
    return { ...next, pointerCapture: { controlId, pointerId: pointer.pointerId, mode: "slider-drag" } };
  }

  if (control.kind === "input" || control.kind === "textarea") {
    const caret = hitTextCaret(control, pointer.x, pointer.y);
    next = updateTextSelection(next, controlId, caret.index, caret.index);
    return {
      ...next,
      pointerCapture: {
        controlId,
        pointerId: pointer.pointerId,
        mode: "text-selection",
        anchor: { index: caret.index, line: caret.line },
      },
    };
  }

  return next;
}

function pointerMove(state, pointer) {
  const capture = state.pointerCapture;
  if (capture === undefined || capture.pointerId !== pointer.pointerId) return state;
  const control = controlById(state, capture.controlId);

  if (capture.mode === "slider-drag") return sliderValueFromPointer(state, control, pointer.x);

  if (capture.mode === "text-selection") {
    const caret = hitTextCaret(control, pointer.x, pointer.y);
    return updateControl(state, control.id, () => ({
      selection: {
        anchor: capture.anchor.index,
        anchorLine: capture.anchor.line,
        focus: caret.index,
        focusLine: caret.line,
      },
    }));
  }

  return state;
}

function pointerUp(state, pointer) {
  if (state.pointerCapture?.pointerId !== pointer.pointerId) return state;
  return { ...state, pointerCapture: undefined };
}

function sliderValueFromPointer(state, control, x) {
  const ratio = clamp((x - control.bounds.x) / control.bounds.width, 0, 1);
  const raw = control.min + ratio * (control.max - control.min);
  return updateControl(state, control.id, () => ({ value: clampToStep(raw, control) }));
}

function hitTextCaret(control, x, y) {
  const layout = layoutTextPrimitive(control.value, control.maxColumns);
  const line = clamp(Math.round((y - control.bounds.y) / lineHeight), 0, layout.lines.length - 1);
  const localX = clamp(Math.round((x - control.bounds.x) / 10), 0, control.maxColumns);
  const linePlacements = layout.caretPlacements.filter((placement) => placement.line === line);
  let closest = linePlacements[0] ?? layout.caretPlacements[0] ?? { index: 0, line: 0, x: 0 };
  let closestDistance = Number.POSITIVE_INFINITY;

  for (const placement of linePlacements) {
    const distance = Math.abs(placement.x - localX);
    if (distance < closestDistance) {
      closest = placement;
      closestDistance = distance;
    }
  }

  return closest;
}

function clipboardAction(state, action, browser) {
  const control = state.focusId === undefined ? undefined : controlById(state, state.focusId);
  const supportsNativeEvent = browser.mode === "native-event";
  const supportsAsync = browser.mode === "async-granted" || browser.mode === "async-denied";
  const denied = browser.mode === "async-denied";

  if (control === undefined || control.disabled) return clipboardResult(state, action, false, "unavailable", true, "");

  if (action === "copy" || action === "cut") {
    if (!isTextControl(control)) return clipboardResult(state, action, false, "unavailable", true, "");
    const text = selectedText(control);
    if (text === "") return clipboardResult(state, action, false, "empty-selection", false, "");
    if (denied) return clipboardResult(state, action, false, "denied", true, text);
    if (!supportsAsync && !supportsNativeEvent) return clipboardResult(state, action, false, "unavailable", true, text);

    let next = { ...state, clipboard: { ...state.clipboard, text } };
    if (action === "cut" && !control.readOnly) {
      next = replaceTextRange(next, control, sortedRange(control.selection), "");
    }
    return clipboardResult(next, action, true, "success", false, text);
  }

  if (action === "paste") {
    if (!isTextControl(control)) return clipboardResult(state, action, false, "unavailable", true, "");
    if (control.readOnly) return clipboardResult(state, action, false, "read-only", false, "");
    const text = supportsNativeEvent ? browser.text ?? "" : supportsAsync ? state.clipboard.text : "";
    if (denied) return clipboardResult(state, action, false, "denied", true, "");
    if (text === "") return clipboardResult(state, action, false, "empty-paste", false, "");

    const next = replaceTextRange(state, control, sortedRange(control.selection), text);
    return clipboardResult(next, action, true, "success", false, text);
  }

  return state;
}

function clipboardResult(state, action, ok, reason, fallback, text) {
  return {
    ...state,
    clipboard: {
      ...state.clipboard,
      last: { action, ok, reason, fallback, text },
    },
  };
}

function compositionStart(state, controlId) {
  const control = controlById(state, controlId);
  if (!isTextControl(control) || control.disabled || control.readOnly) return state;
  return { ...setFocus(state, controlId), composition: { active: true, controlId, text: "" } };
}

function compositionUpdate(state, text) {
  if (!state.composition.active) return state;
  return { ...state, composition: { ...state.composition, text } };
}

function compositionEnd(state, text) {
  if (!state.composition.active || state.composition.controlId === undefined) return state;
  const control = controlById(state, state.composition.controlId);
  const next = replaceTextRange(state, control, sortedRange(control.selection), text);
  return { ...next, composition: { active: false, controlId: undefined, text: "" } };
}

function isTextControl(control) {
  return control.kind === "input" || control.kind === "textarea";
}

function selectedText(control) {
  if (!isTextControl(control)) return "";
  const range = sortedRange(control.selection);
  return control.value.slice(range.start, range.end);
}

function sortedRange(selection) {
  if (selection.anchor <= selection.focus) {
    return {
      start: selection.anchor,
      end: selection.focus,
      startLine: selection.anchorLine,
      endLine: selection.focusLine,
    };
  }

  return {
    start: selection.focus,
    end: selection.anchor,
    startLine: selection.focusLine,
    endLine: selection.anchorLine,
  };
}

function layoutTextPrimitive(text, maxColumns) {
  const lines = textLines(text, maxColumns).map((line, index) => {
    const indexedLine = { ...line, index };
    const placements = textBoundaryIndexesBetween(text, line.start, line.end).map((placementIndex) => ({
      index: placementIndex,
      line: index,
      x: textWidth(text.slice(line.start, placementIndex)),
    }));

    return {
      ...indexedLine,
      placements,
      width: textWidth(line.text),
    };
  });

  return {
    caretPlacements: lines.flatMap((line) => line.placements),
    lineHeight,
    lines,
    maxWidth: maxColumns,
    selectionHeight,
    selectionYOffset,
    text,
  };
}

function textLines(text, maxColumns) {
  const lines = [];
  let paragraphStart = 0;

  for (let index = 0; index <= text.length; index += 1) {
    if (index < text.length && text[index] !== "\n") continue;
    const paragraphEnd = index;

    if (paragraphStart === paragraphEnd) {
      lines.push({ start: paragraphStart, end: paragraphEnd, text: "" });
    } else {
      let lineStart = paragraphStart;
      while (lineStart < paragraphEnd) {
        const lineEnd = findWrapLineEnd(text, lineStart, paragraphEnd, maxColumns);
        lines.push({ start: lineStart, end: lineEnd, text: text.slice(lineStart, lineEnd) });
        lineStart = lineEnd;
      }
    }

    paragraphStart = index + 1;
  }

  return lines;
}

function findWrapLineEnd(text, start, end, maxColumns) {
  const boundaries = textBoundaryIndexesBetween(text, start, end).slice(1);
  let previous = start;
  let lastBreak = start;

  for (const boundary of boundaries) {
    const width = textWidth(text.slice(start, boundary));
    if (width > maxColumns && previous > start) return lastBreak > start ? lastBreak : previous;

    const character = text.slice(previous, boundary);
    if (character === " " || character === "\t") lastBreak = boundary;
    previous = boundary;
  }

  return end;
}

function caretPlacement(layout, index, lineHint) {
  const placements = layout.caretPlacements.filter((candidate) => candidate.index === index);
  if (placements.length === 0) return undefined;
  if (lineHint !== undefined) {
    const hinted = placements.find((candidate) => candidate.line === lineHint);
    if (hinted !== undefined) return hinted;
  }
  return placements.at(-1);
}

function selectionRects(layout, range, rectOrigin) {
  if (range.start === range.end) return [];

  const startPlacement = caretPlacement(layout, range.start, range.startLine);
  const endPlacement = caretPlacement(layout, range.end, range.endLine);
  if (startPlacement === undefined || endPlacement === undefined) return [];

  const rects = [];
  for (let line = startPlacement.line; line <= endPlacement.line; line += 1) {
    const lineLayout = layout.lines[line];
    if (lineLayout === undefined) continue;

    const xStart = line === startPlacement.line ? startPlacement.x : 0;
    const xEnd = line === endPlacement.line ? endPlacement.x : lineLayout.width;
    const width = Math.max(0, xEnd - xStart);
    if (width <= 0) continue;

    rects.push({
      start: line === startPlacement.line ? range.start : lineLayout.start,
      end: line === endPlacement.line ? range.end : lineLayout.end,
      line,
      x: rectOrigin.x + xStart,
      y: rectOrigin.y + line * layout.lineHeight + layout.selectionYOffset,
      width,
      height: layout.selectionHeight,
    });
  }

  return rects;
}

function textBoundaryIndexes(text) {
  const indexes = [0];
  let index = 0;
  for (const character of Array.from(text)) {
    index += character.length;
    indexes.push(index);
  }
  return indexes;
}

function textBoundaryIndexesBetween(text, start, end) {
  return textBoundaryIndexes(text.slice(start, end)).map((index) => start + index);
}

function previousTextIndex(text, index) {
  if (index <= 0) return 0;
  const prefix = Array.from(text.slice(0, index));
  return prefix.slice(0, -1).join("").length;
}

function nextTextIndex(text, index) {
  if (index >= text.length) return text.length;
  const character = Array.from(text.slice(index))[0] ?? "";
  return index + character.length;
}

function textWidth(text) {
  return Array.from(text).length;
}

function projectAccessibilityTree(state) {
  return {
    role: "form",
    nodes: state.controls.map((control) => ariaForControl(control, state)),
  };
}

function projectRenderTree(state) {
  return {
    coordinateSpace: "canvas-css-px",
    packets: state.controls.flatMap((control) => renderPacketsForControl(control, state)),
  };
}

function renderPacketsForControl(control, state) {
  const packets = [
    {
      kind: "control-box",
      controlId: control.id,
      primitive: control.kind,
      bounds: control.bounds,
      state: {
        disabled: control.disabled === true,
        focused: state.focusId === control.id,
        readOnly: control.readOnly === true,
      },
    },
  ];

  if (control.kind === "input" || control.kind === "textarea") {
    const layout = layoutTextPrimitive(control.value, control.maxColumns);
    for (const line of layout.lines) {
      packets.push({
        kind: "text-run",
        controlId: control.id,
        line: line.index,
        text: line.text,
        x: control.bounds.x,
        y: control.bounds.y + line.index * lineHeight,
      });
    }

    for (const rect of selectionRects(layout, sortedRange(control.selection), { x: control.bounds.x, y: control.bounds.y })) {
      packets.push({
        kind: "selection-rect",
        controlId: control.id,
        rect,
      });
    }

    if (state.focusId === control.id) {
      const placement = caretPlacement(layout, control.selection.focus, control.selection.focusLine);
      if (placement !== undefined) {
        packets.push({
          kind: "caret",
          controlId: control.id,
          height: layout.selectionHeight,
          x: control.bounds.x + placement.x,
          y: control.bounds.y + placement.line * lineHeight + layout.selectionYOffset,
        });
      }
    }
  }

  if (control.kind === "checkbox" || control.kind === "radio") {
    packets.push({
      kind: "check-indicator",
      controlId: control.id,
      checked: control.checked,
      shape: control.kind === "radio" ? "circle" : "square",
    });
  }

  if (control.kind === "select" || control.kind === "listbox") {
    packets.push({
      kind: "text-run",
      controlId: control.id,
      line: 0,
      text: selectedOption(control).label,
      x: control.bounds.x,
      y: control.bounds.y,
    });

    const optionsVisible = control.kind === "listbox" || control.open;
    if (optionsVisible) {
      for (const [index, option] of control.options.entries()) {
        packets.push({
          kind: "option-row",
          controlId: control.id,
          optionId: option.id,
          label: option.label,
          selected: index === control.selectedIndex,
          bounds: rect(control.bounds.x, control.bounds.y + (index + 1) * 24, control.bounds.width, 24),
        });
      }
    }
  }

  if (control.kind === "slider") {
    const ratio = (control.value - control.min) / (control.max - control.min);
    packets.push({
      kind: "slider-track",
      controlId: control.id,
      bounds: rect(control.bounds.x, control.bounds.y + control.bounds.height / 2 - 2, control.bounds.width, 4),
    });
    packets.push({
      kind: "slider-thumb",
      controlId: control.id,
      x: control.bounds.x + ratio * control.bounds.width,
      y: control.bounds.y + control.bounds.height / 2,
      value: control.value,
    });
  }

  if (control.kind === "button") {
    packets.push({
      kind: "text-run",
      controlId: control.id,
      line: 0,
      text: control.label,
      x: control.bounds.x,
      y: control.bounds.y,
    });
  }

  return packets;
}

function ariaForControl(control, state) {
  const base = {
    id: control.id,
    label: control.label,
    role: "generic",
    attributes: {},
  };

  if (control.disabled) base.attributes["aria-disabled"] = "true";

  if (control.kind === "input" || control.kind === "textarea") {
    base.role = "textbox";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-valuetext"] = control.value;
    base.attributes["aria-multiline"] = control.kind === "textarea" ? "true" : "false";
    if (control.readOnly) base.attributes["aria-readonly"] = "true";
    if (control.required) base.attributes["aria-required"] = "true";
    return base;
  }

  if (control.kind === "checkbox") {
    base.role = "checkbox";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-checked"] = String(control.checked);
    return base;
  }

  if (control.kind === "radio") {
    const group = radioGroup(state, control.name);
    base.role = "radio";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-checked"] = String(control.checked);
    base.attributes["aria-posinset"] = String(group.findIndex((candidate) => candidate.id === control.id) + 1);
    base.attributes["aria-setsize"] = String(group.length);
    return base;
  }

  if (control.kind === "select") {
    const selected = selectedOption(control);
    base.role = "combobox";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-expanded"] = String(control.open);
    base.attributes["aria-controls"] = `${control.id}-listbox`;
    base.attributes["aria-activedescendant"] = selected.id;
    base.attributes["aria-valuetext"] = selected.label;
    base.children = optionNodes(control);
    return base;
  }

  if (control.kind === "listbox") {
    const selected = selectedOption(control);
    base.role = "listbox";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-activedescendant"] = selected.id;
    base.children = optionNodes(control);
    return base;
  }

  if (control.kind === "slider") {
    base.role = "slider";
    base.attributes["aria-label"] = control.label;
    base.attributes["aria-valuemin"] = String(control.min);
    base.attributes["aria-valuemax"] = String(control.max);
    base.attributes["aria-valuenow"] = String(control.value);
    base.attributes["aria-valuetext"] = `${control.value}`;
    return base;
  }

  if (control.kind === "button") {
    base.role = "button";
    base.attributes["aria-label"] = control.label;
    return base;
  }

  return base;
}

function optionNodes(control) {
  return control.options.map((option, index) => ({
    id: option.id,
    label: option.label,
    role: "option",
    attributes: {
      "aria-selected": String(index === control.selectedIndex),
      "aria-posinset": String(index + 1),
      "aria-setsize": String(control.options.length),
    },
  }));
}

function selectedOption(control) {
  return control.options[control.selectedIndex] ?? control.options[0];
}

function projectControlSummary(control, state) {
  const aria = ariaForControl(control, state);
  return {
    id: control.id,
    kind: control.kind,
    focusable: isTabStop(control, state),
    role: aria.role,
  };
}

function makeLargeForm(count) {
  const generated = [];
  for (let index = 0; index < count; index += 1) {
    const disabled = index % 17 === 0;
    const order = index + 1;
    const y = 16 + index * 36;

    if (index % 20 === 0) {
      generated.push({
        id: `large-slider-${index}`,
        kind: "slider",
        label: `Large slider ${index}`,
        order,
        min: 0,
        max: 10,
        step: 1,
        value: 5,
        disabled,
        bounds: rect(16, y, 200, 28),
      });
      continue;
    }

    if (index % 15 === 0) {
      generated.push({
        id: `large-checkbox-${index}`,
        kind: "checkbox",
        label: `Large checkbox ${index}`,
        order,
        checked: false,
        disabled,
        bounds: rect(16, y, 24, 24),
      });
      continue;
    }

    generated.push(textControl({
      id: `large-input-${index}`,
      kind: "input",
      label: `Large input ${index}`,
      order,
      value: `value ${index}`,
      maxColumns: 20,
      disabled,
      bounds: rect(16, y, 260, 32),
    }));
  }
  return generated;
}

function clampToStep(value, control) {
  const steps = Math.round((value - control.min) / control.step);
  return clamp(control.min + steps * control.step, control.min, control.max);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function mod(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

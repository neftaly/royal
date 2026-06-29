# Renderer-backed form controls prototype

This research artifact moves the "whole HTML form worth of components" idea toward an implementable renderer worker without changing the current text editor worker, examples, packages, CI, dependencies, or git state.

The executable prototype is:

```sh
node research/form-controls/form-controls-prototype.mjs
node research/form-controls/form-controls-prototype.mjs --json
```

It defines browser-independent primitives for:

- `input`
- `textarea`
- `checkbox`
- `radio`
- `select`
- `listbox`
- `button`
- `slider`
- focus order
- caret and selection geometry
- clipboard paths
- IME composition
- accessibility metadata projected from canvas state

## Existing renderer/text grounding

Current renderer text APIs already provide most of the text geometry needed by form controls:

- `packages/renderer-core/src/text.ts` exposes `layoutText(...)`, `TextLayout`, and `textMesh(...)`. `layoutText` returns line origins, glyph placements, run metrics, bounds, diagnostics, and the original source text.
- `packages/renderer-core/src/editable-text.ts` has the browser-independent helpers a form control worker should reuse or mirror: `layoutEditableText`, `editableTextCaretPlacement`, `editableTextSelectionRects`, `nearestEditableTextCaret`, `previousTextIndex`, and `nextTextIndex`.
- `apps/examples-react/src/examples/cases/RendererText.tsx` demonstrates the browser adapter shape: a focusable canvas with `role="textbox"`, `aria-multiline`, `aria-valuetext`, key handling, paste handling, IME commit handling, pointer capture, hit testing, caret rendering, and drag selection.

One important integration detail: `editable-text.ts` is not exported from `packages/renderer-core/src/index.ts` today. This artifact deliberately does not change that. A future implementation can either export the helpers deliberately or keep an internal worker-side adapter with the same contract.

## Prototype model

The prototype keeps three layers separate:

1. **Control descriptors**: stable ids, kind, bounds, tab order, disabled/read-only flags, text value, checked state, selected option, slider limits, and labels.
2. **Event reducer**: keyboard, pointer, clipboard, and composition events update the descriptor state. This is the part a future worker can lift first.
3. **Renderer and browser projections**: one projection returns canvas/render-state-friendly metadata, and another returns ARIA metadata that the host can mirror to the DOM or expose through a focused canvas.

The script uses a small monospace text layout fixture instead of importing package internals. That makes it runnable as a research artifact while preserving the same data shape as the core editable text helpers: lines, caret placements, selection rects, UTF-16 text indexes, and origin-relative geometry.

It also projects simple renderer packets: control boxes, text runs, selection rects, carets, check indicators, option rows, slider tracks, and slider thumbs. These are intentionally not renderer-core nodes yet; they are the worker-facing shape that can later become `text`, `textMesh`, `mesh`, and material submissions.

## Component implementation notes

### Input

Start here. It needs the smallest useful slice: text value, caret, selection range, focus, keyboard insertion/deletion, paste, copy/cut, IME commit, disabled/read-only handling, hit testing, and `role="textbox"` metadata.

Implementation steps:

1. Feed value and font settings through the editable text layout bridge.
2. Store selection as `{ anchor, focus, anchorLine, focusLine }`.
3. Render text mesh, selection rect quads, and caret quad from the layout.
4. Use `nearestEditableTextCaret` for pointer hit testing.
5. Mirror `role="textbox"`, `aria-valuetext`, `aria-readonly`, `aria-disabled`, and `aria-required`.

### Textarea

Textarea is input plus multiline wrapping, `Enter`, vertical caret movement, scroll window, and `aria-multiline="true"`. Selection rects must be line-aware and clipped to the viewport before rendering.

### Checkbox

Checkbox is a boolean state primitive. Space toggles when focused. Pointer press toggles on release inside the hit region. ARIA projection is `role="checkbox"` and `aria-checked`.

### Radio

Radio needs group ownership. Tab order should expose one radio per group: the checked enabled radio, or the first enabled radio if none is checked. Arrow keys move focus and checked state within the enabled group.

### Select/listbox

Select can start as a collapsed combobox backed by the same option model as listbox. Arrow keys change active/selected option. The open popup/listbox should be a renderer-owned overlay with stable option ids, `aria-controls`, `aria-expanded`, and `aria-activedescendant`.

### Button

Button has press state, click activation, and keyboard activation on Enter/Space. A renderer worker should distinguish visual pressed state from committed activation.

### Slider

Slider needs pointer capture and keyboard increments. Pointer movement must continue to update the value after leaving the visual bounds while capture is held. ARIA projection is `role="slider"` plus min/max/now/text.

## Edge cases covered by the validation script

- Keyboard navigation: Tab and Shift+Tab focus traversal, Ctrl+A, arrows, Home/End, Space, Enter, and slider/listbox/select movement.
- Pointer capture: slider drag and text drag continue outside the original bounds until pointer release.
- Clipboard differences: async clipboard success, async clipboard denied fallback, and native clipboard event paste.
- IME composition: keydown is ignored while composing, intermediate composition text does not mutate state, and committed composition text inserts once.
- Selection geometry: multiline ranges produce positive, bounded rectangles with stable UTF-16 indexes.
- Disabled/read-only state: disabled controls leave tab order and ignore input; read-only text controls remain focusable but do not mutate.
- Large forms: focus order and ARIA projection are validated across hundreds of controls without relying on DOM nodes.
- Canvas state to ARIA: every primitive maps to role and state metadata that a host can mirror outside the renderer.

## Worker-ready contract sketch

The future worker does not need to know React or DOM details. It can work against records like these:

```js
{
  id: "name",
  kind: "input",
  bounds: { x: 16, y: 16, width: 260, height: 32 },
  value: "Ada",
  selection: { anchor: 3, focus: 3 },
  disabled: false,
  readOnly: false,
  aria: {
    role: "textbox",
    label: "Name",
    valueText: "Ada"
  }
}
```

The host/browser adapter owns native events and permission-sensitive APIs. The worker owns deterministic state transitions, geometry, hit packets, render packets, and ARIA metadata.

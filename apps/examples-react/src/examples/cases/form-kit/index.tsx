/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  type RenderNode,
  type Rgba,
  type Vec3,
  unlitMaterial,
} from '@royal/renderer-core';
import {
  applyEditableTextEditorCommand,
  applyEditableTextEditorKeyInput,
  createEditableTextEditorState,
  createEditableTextFragment,
  editableTextEditorPointerSelection,
  editableTextEditorSelectedText,
  layoutEditableText,
  setEditableTextEditorSelection,
  type EditableTextCommand,
  type EditableTextEditorState,
  type EditableTextKeyInput,
  type EditableTextSelection,
} from '@royal/renderer-core/text/editable';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import {
  canvasPointToWorld,
  captureCanvasPointer,
  markRendererComponent,
  releaseCanvasPointer,
  type CanvasWorldBounds,
} from '@royal/react';
import {
  createElement as createReactElement,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

export type RoyalFormBounds = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

export type RoyalFormTextFieldBounds = RoyalFormBounds & {
  readonly textMaxWidth: number;
  readonly textOrigin: Vec3;
};

export type RoyalFormTextControlMode = 'multiline' | 'single-line';

export type RoyalFormTextControlDefinition = {
  readonly maxLength: number;
  readonly mode: RoyalFormTextControlMode;
};

export type RoyalFormTextControls = Readonly<Record<string, RoyalFormTextControlDefinition>>;

export type RoyalFormLayout = {
  readonly buttons: Readonly<Record<string, RoyalFormBounds>>;
  readonly checkboxes: Readonly<Record<string, RoyalFormBounds>>;
  readonly fields: Readonly<Record<string, RoyalFormTextFieldBounds>>;
  readonly form: RoyalFormBounds;
  readonly heading: { readonly origin: Vec3 };
  readonly labels: Readonly<Record<string, Vec3>>;
  readonly status: { readonly origin: Vec3 };
};

export type RoyalFormTheme = {
  readonly accent: Rgba;
  readonly accentStrong: Rgba;
  readonly background: Rgba;
  readonly border: Rgba;
  readonly button: Rgba;
  readonly field: Rgba;
  readonly fieldFocused: Rgba;
  readonly ink: Rgba;
  readonly muted: Rgba;
  readonly panel: Rgba;
  readonly selection: Rgba;
  readonly shadow: Rgba;
};

export type RoyalFormTextMetrics = {
  readonly fontSize: number;
  readonly lineHeight: number;
};

type RoyalFormState = {
  readonly activations: Readonly<Record<string, number>>;
  readonly checked: Readonly<Record<string, boolean>>;
  readonly focused: string | undefined;
  readonly pressed: string | undefined;
  readonly text: Readonly<Record<string, EditableTextEditorState>>;
};

type InitialFormStateOptions = {
  readonly initialChecked: Readonly<Record<string, boolean>> | undefined;
  readonly initialText: Readonly<Record<string, string>> | undefined;
  readonly layout: RoyalFormLayout;
  readonly textControls: RoyalFormTextControls;
};

export type UseRoyalFormOptions = {
  readonly cameraBounds: CanvasWorldBounds;
  readonly focusOrder: readonly string[];
  readonly font: TextFontFace;
  readonly initialChecked?: Readonly<Record<string, boolean>>;
  readonly initialText?: Readonly<Record<string, string>>;
  readonly layout: RoyalFormLayout;
  readonly submitButton?: string;
  readonly textControls: RoyalFormTextControls;
  readonly textMetrics?: RoyalFormTextMetrics;
  readonly theme?: RoyalFormTheme;
};

export type RoyalFormCanvasProps = {
  readonly 'aria-keyshortcuts': string;
  readonly onBlur: () => void;
  readonly onCopy: (event: ReactClipboardEvent<HTMLCanvasElement>) => void;
  readonly onCut: (event: ReactClipboardEvent<HTMLCanvasElement>) => void;
  readonly onFocus: () => void;
  readonly onKeyDown: (event: ReactKeyboardEvent<HTMLCanvasElement>) => void;
  readonly onPaste: (event: ReactClipboardEvent<HTMLCanvasElement>) => void;
  readonly onPointerCancel: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerDown: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  readonly onPointerUp: (event: ReactPointerEvent<HTMLCanvasElement>) => void;
  readonly role: 'group';
  readonly tabIndex: 0;
};

export type RoyalFormKit = {
  readonly activationCount: (name: string) => number;
  readonly canvasProps: RoyalFormCanvasProps;
  readonly checked: (name: string) => boolean;
  readonly focused: (name: string) => boolean;
  readonly font: TextFontFace;
  readonly layout: RoyalFormLayout;
  readonly pressed: (name: string) => boolean;
  readonly text: (name: string) => EditableTextEditorState;
  readonly textControls: RoyalFormTextControls;
  readonly textMetrics: RoyalFormTextMetrics;
  readonly theme: RoyalFormTheme;
};

type RoyalNodeChild = ReactNode | RenderNode | readonly RoyalNodeChild[];

const RenderNodeDescriptor = markRendererComponent(({
  node,
}: {
  readonly node: RenderNode;
}): RenderNode => node);
const RenderNodeElement = RenderNodeDescriptor as (props: {
  readonly node: RenderNode;
}) => ReactNode;

export const compactRoyalFormCameraBounds = {
  bottom: -3.4,
  left: -5.3,
  right: 5.3,
  top: 3.4,
} as const satisfies CanvasWorldBounds;

export const defaultRoyalFormTheme = {
  accent: [0.22, 0.7, 0.62, 1],
  accentStrong: [0.96, 0.72, 0.24, 1],
  background: [0.045, 0.05, 0.052, 1],
  border: [0.28, 0.32, 0.32, 1],
  button: [0.2, 0.42, 0.76, 1],
  field: [0.11, 0.125, 0.125, 1],
  fieldFocused: [0.13, 0.16, 0.155, 1],
  ink: [0.92, 0.94, 0.9, 1],
  muted: [0.58, 0.64, 0.62, 1],
  panel: [0.073, 0.082, 0.083, 1],
  selection: [0.08, 0.27, 0.39, 1],
  shadow: [0.02, 0.024, 0.025, 1],
} as const satisfies RoyalFormTheme;

export const defaultRoyalFormTextMetrics = {
  fontSize: 0.22,
  lineHeight: 0.32,
} as const satisfies RoyalFormTextMetrics;

export const compactRoyalFormLayout = {
  buttons: {
    submit: {
      height: 0.62,
      width: 1.48,
      x: 2.12,
      y: -1.92,
    },
  },
  checkboxes: {
    updates: {
      height: 0.46,
      width: 4.4,
      x: -3.66,
      y: -1.2,
    },
  },
  fields: {
    message: {
      height: 1.68,
      textMaxWidth: 6.82,
      textOrigin: [-3.38, 0.66, 0.12],
      width: 7.32,
      x: -3.66,
      y: 0.98,
    },
    name: {
      height: 0.76,
      textMaxWidth: 6.82,
      textOrigin: [-3.38, 1.98, 0.12],
      width: 7.32,
      x: -3.66,
      y: 2.28,
    },
  },
  form: {
    height: 5.72,
    width: 8.28,
    x: -4.14,
    y: 3.14,
  },
  heading: {
    origin: [-3.66, 2.72, 0.12],
  },
  labels: {
    message: [-3.66, 1.24, 0.12],
    name: [-3.66, 2.54, 0.12],
  },
  status: {
    origin: [-3.66, -2.22, 0.12],
  },
} as const satisfies RoyalFormLayout;

const textFromChildren = (children: unknown): string => {
  if (Array.isArray(children)) return children.map(textFromChildren).join('');
  if (children === null || children === undefined || typeof children === 'boolean') return '';
  if (
    typeof children === 'bigint' ||
    typeof children === 'number' ||
    typeof children === 'string'
  ) {
    return String(children);
  }
  throw new Error('Form text components only accept text children.');
};

const rect = (
  bounds: RoyalFormBounds,
  fill: Rgba,
  z: number,
): ReactNode => (
  <mesh
    geometry={boxGeometry([bounds.width, bounds.height, 0.02])}
    material={unlitMaterial({ color: fill })}
    transform={{
      position: [bounds.x + bounds.width / 2, bounds.y - bounds.height / 2, z],
      rotation: [0, 0, 0],
    }}
  />
);

const textNode = (
  children: unknown,
  options: {
    readonly color: Rgba;
    readonly font: TextFontFace;
    readonly fontSize: number;
    readonly lineHeight: number;
    readonly origin: Vec3;
  },
): ReactNode => (
  <text
    color={options.color}
    font={options.font}
    fontSize={options.fontSize}
    lineHeight={options.lineHeight}
    origin={options.origin}
  >
    {textFromChildren(children)}
  </text>
);

const hasOwn = (
  record: Readonly<Record<string, unknown>>,
  name: string,
): boolean => Object.prototype.hasOwnProperty.call(record, name);

const textForMode = (value: string, mode: RoyalFormTextControlMode): string =>
  mode === 'single-line' ? value.replace(/[\r\n]/g, ' ') : value.replace(/\r\n?/g, '\n');

const maxWidthForMode = (maxWidth: number, mode: RoyalFormTextControlMode): number =>
  mode === 'single-line' ? Number.POSITIVE_INFINITY : maxWidth;

const limitText = (value: string, maxLength: number): string =>
  Array.from(value).slice(0, maxLength).join('');

const normalizeEditor = (
  editor: EditableTextEditorState,
  definition: RoyalFormTextControlDefinition,
): EditableTextEditorState =>
  createEditableTextEditorState({
    selection: editor.selection,
    text: limitText(textForMode(editor.text, definition.mode), definition.maxLength),
  });

const createTextState = (
  textControls: RoyalFormTextControls,
  initialText: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, EditableTextEditorState>> => {
  const state: Record<string, EditableTextEditorState> = {};

  for (const [name, definition] of Object.entries(textControls)) {
    state[name] = createEditableTextEditorState({
      text: limitText(textForMode(initialText?.[name] ?? '', definition.mode), definition.maxLength),
    });
  }

  return state;
};

const createBooleanState = (
  names: readonly string[],
  initial: Readonly<Record<string, boolean>> | undefined,
): Readonly<Record<string, boolean>> => {
  const state: Record<string, boolean> = {};

  for (const name of names) {
    state[name] = initial?.[name] === true;
  }

  return state;
};

const createActivationState = (names: readonly string[]): Readonly<Record<string, number>> => {
  const state: Record<string, number> = {};

  for (const name of names) {
    state[name] = 0;
  }

  return state;
};

const createInitialFormState = ({
  initialChecked,
  initialText,
  layout,
  textControls,
}: InitialFormStateOptions): RoyalFormState => ({
  activations: createActivationState(Object.keys(layout.buttons)),
  checked: createBooleanState(Object.keys(layout.checkboxes), initialChecked),
  focused: undefined,
  pressed: undefined,
  text: createTextState(textControls, initialText),
});

const isInside = (
  point: { readonly x: number; readonly y: number },
  bounds: RoyalFormBounds,
): boolean =>
  point.x >= bounds.x &&
  point.x <= bounds.x + bounds.width &&
  point.y <= bounds.y &&
  point.y >= bounds.y - bounds.height;

const controlBounds = (
  layout: RoyalFormLayout,
  name: string,
): RoyalFormBounds | undefined =>
  layout.fields[name] ?? layout.checkboxes[name] ?? layout.buttons[name];

const hitTestForm = (
  layout: RoyalFormLayout,
  focusOrder: readonly string[],
  point: { readonly x: number; readonly y: number },
): string | undefined =>
  focusOrder.find((name) => {
    const bounds = controlBounds(layout, name);
    return bounds !== undefined && isInside(point, bounds);
  });

const isTextControl = (
  textControls: RoyalFormTextControls,
  name: string | undefined,
): name is string => name !== undefined && hasOwn(textControls, name);

const isCheckboxControl = (
  layout: RoyalFormLayout,
  name: string | undefined,
): name is string => name !== undefined && hasOwn(layout.checkboxes, name);

const isButtonControl = (
  layout: RoyalFormLayout,
  name: string | undefined,
): name is string => name !== undefined && hasOwn(layout.buttons, name);

const focusAdjacentControl = (
  focusOrder: readonly string[],
  current: string | undefined,
  direction: 'backward' | 'forward',
): string | undefined => {
  if (current === undefined) return direction === 'forward' ? focusOrder[0] : undefined;

  const currentIndex = focusOrder.indexOf(current);
  const offset = direction === 'forward' ? 1 : -1;
  const nextIndex = currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= focusOrder.length) return undefined;
  return focusOrder[nextIndex];
};

const keyboardInput = (event: ReactKeyboardEvent<HTMLCanvasElement>): EditableTextKeyInput => ({
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  isComposing: event.nativeEvent.isComposing,
  key: event.key,
  keyCode: event.keyCode,
  metaKey: event.metaKey,
  shiftKey: event.shiftKey,
});

const editorAtPointer = ({
  definition,
  editor,
  field,
  font,
  metrics,
  point,
}: {
  readonly definition: RoyalFormTextControlDefinition;
  readonly editor: EditableTextEditorState;
  readonly field: RoyalFormTextFieldBounds;
  readonly font: TextFontFace;
  readonly metrics: RoyalFormTextMetrics;
  readonly point: { readonly x: number; readonly y: number };
}): EditableTextSelection => {
  const displayText = textForMode(editor.text, definition.mode);
  const textLayout = layoutEditableText({
    font,
    fontSize: metrics.fontSize,
    lineHeight: metrics.lineHeight,
    maxWidth: maxWidthForMode(field.textMaxWidth, definition.mode),
    text: displayText,
  });

  return editableTextEditorPointerSelection({
    layout: textLayout,
    origin: field.textOrigin,
    point,
    state: editor,
  });
};

const applyTextCommand = (
  state: RoyalFormState,
  name: string,
  definition: RoyalFormTextControlDefinition,
  command: EditableTextCommand,
): RoyalFormState => {
  const editor = state.text[name];
  if (editor === undefined) return state;

  return {
    ...state,
    text: {
      ...state.text,
      [name]: normalizeEditor(
        applyEditableTextEditorCommand(editor, command),
        definition,
      ),
    },
  };
};

const clearPressedControl = (state: RoyalFormState): RoyalFormState =>
  state.pressed === undefined ? state : { ...state, pressed: undefined };

export const useRoyalForm = ({
  cameraBounds,
  focusOrder,
  font,
  initialChecked,
  initialText,
  layout,
  submitButton,
  textControls,
  textMetrics = defaultRoyalFormTextMetrics,
  theme = defaultRoyalFormTheme,
}: UseRoyalFormOptions): RoyalFormKit => {
  const [state, setState] = useState<RoyalFormState>(() =>
    createInitialFormState({ initialChecked, initialText, layout, textControls })
  );

  const focus = (name: string | undefined): void =>
    setState((current) => ({
      ...current,
      focused: name,
      pressed: undefined,
    }));

  const toggleCheckbox = (name: string): void =>
    setState((current) => ({
      ...current,
      checked: {
        ...current.checked,
        [name]: current.checked[name] !== true,
      },
      focused: name,
      pressed: undefined,
    }));

  const activateButton = (name: string): void =>
    setState((current) => ({
      ...current,
      activations: {
        ...current.activations,
        [name]: (current.activations[name] ?? 0) + 1,
      },
      focused: name,
      pressed: undefined,
    }));

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;

    const [x, y] = canvasPointToWorld(
      event.currentTarget,
      cameraBounds,
      event.clientX,
      event.clientY,
    );
    const hit = hitTestForm(layout, focusOrder, { x, y });

    if (hit === undefined) {
      event.preventDefault();
      focus(undefined);
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });

    if (isTextControl(textControls, hit)) {
      const definition = textControls[hit];
      const editor = state.text[hit];
      const field = layout.fields[hit];
      if (definition === undefined || editor === undefined || field === undefined) return;

      setState((current) => {
        const currentEditor = current.text[hit];
        if (currentEditor === undefined) return current;

        return {
          ...current,
          focused: hit,
          pressed: undefined,
          text: {
            ...current.text,
            [hit]: setEditableTextEditorSelection(
              currentEditor,
              editorAtPointer({
                definition,
                editor: currentEditor,
                field,
                font,
                metrics: textMetrics,
                point: { x, y },
              }),
            ),
          },
        };
      });
      return;
    }

    captureCanvasPointer(event.currentTarget, event.pointerId);
    setState((current) => ({
      ...current,
      focused: hit,
      pressed: hit,
    }));
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    releaseCanvasPointer(event.currentTarget, event.pointerId);

    const [x, y] = canvasPointToWorld(
      event.currentTarget,
      cameraBounds,
      event.clientX,
      event.clientY,
    );
    const hit = hitTestForm(layout, focusOrder, { x, y });

    setState((current) => {
      const pressed = current.pressed;
      if (pressed === undefined) return current;

      const base = { ...current, pressed: undefined };
      if (hit !== pressed) return base;
      if (isCheckboxControl(layout, pressed)) {
        return {
          ...base,
          checked: {
            ...base.checked,
            [pressed]: current.checked[pressed] !== true,
          },
        };
      }
      if (isButtonControl(layout, pressed)) {
        return {
          ...base,
          activations: {
            ...base.activations,
            [pressed]: (current.activations[pressed] ?? 0) + 1,
          },
        };
      }
      return base;
    });
  };

  const handlePointerCancel = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    releaseCanvasPointer(event.currentTarget, event.pointerId);
    setState(clearPressedControl);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    if (event.key === 'Tab') {
      const nextFocus = focusAdjacentControl(
        focusOrder,
        state.focused,
        event.shiftKey ? 'backward' : 'forward',
      );
      if (nextFocus === undefined) {
        setState(clearPressedControl);
        return;
      }

      event.preventDefault();
      setState((current) => ({
        ...current,
        focused: nextFocus,
        pressed: undefined,
      }));
      return;
    }

    if (isTextControl(textControls, state.focused)) {
      const controlName = state.focused;
      const definition = textControls[controlName];
      const editor = state.text[controlName];
      if (definition === undefined || editor === undefined) return;

      const result = applyEditableTextEditorKeyInput(
        editor,
        keyboardInput(event),
        { mode: definition.mode },
      );

      if (result.intent === undefined || result.intent.type === 'clipboard-shortcut') return;

      event.preventDefault();
      if (result.intent.type === 'enter-key') {
        if (submitButton !== undefined) activateButton(submitButton);
        return;
      }

      setState((current) => ({
        ...current,
        text: {
          ...current.text,
          [controlName]: normalizeEditor(result.state, definition),
        },
      }));
      return;
    }

    if (isCheckboxControl(layout, state.focused) && (event.key === ' ' || event.key === 'Spacebar')) {
      event.preventDefault();
      toggleCheckbox(state.focused);
      return;
    }

    if (
      isButtonControl(layout, state.focused) &&
      (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')
    ) {
      event.preventDefault();
      activateButton(state.focused);
    }
  };

  const handleCopy = (event: ReactClipboardEvent<HTMLCanvasElement>): void => {
    if (!isTextControl(textControls, state.focused)) return;

    const editor = state.text[state.focused];
    if (editor === undefined) return;

    const selectedText = editableTextEditorSelectedText(editor);
    if (selectedText === '') return;

    event.clipboardData.setData('text/plain', selectedText);
    event.preventDefault();
  };

  const handleCut = (event: ReactClipboardEvent<HTMLCanvasElement>): void => {
    if (!isTextControl(textControls, state.focused)) return;

    const controlName = state.focused;
    const definition = textControls[controlName];
    const editor = state.text[controlName];
    if (definition === undefined || editor === undefined) return;

    const selectedText = editableTextEditorSelectedText(editor);
    if (selectedText === '') return;

    event.clipboardData.setData('text/plain', selectedText);
    event.preventDefault();
    setState((current) =>
      current.focused === controlName
        ? applyTextCommand(current, controlName, definition, { text: '', type: 'replace-selection' })
        : current
    );
  };

  const handlePaste = (event: ReactClipboardEvent<HTMLCanvasElement>): void => {
    if (!isTextControl(textControls, state.focused)) return;

    const controlName = state.focused;
    const definition = textControls[controlName];
    if (definition === undefined) return;

    const pastedText = event.clipboardData.getData('text/plain');
    if (pastedText === '') return;

    event.preventDefault();
    setState((current) =>
      current.focused === controlName
        ? applyTextCommand(current, controlName, definition, { text: pastedText, type: 'replace-selection' })
        : current
    );
  };

  const firstControl = focusOrder[0];

  return {
    activationCount: (name) => state.activations[name] ?? 0,
    canvasProps: {
      'aria-keyshortcuts': 'Tab Shift+Tab Space Enter',
      onBlur: () => focus(undefined),
      onCopy: handleCopy,
      onCut: handleCut,
      onFocus: () => {
        if (firstControl === undefined) return;
        setState((current) =>
          current.focused === undefined
            ? { ...current, focused: firstControl }
            : current
        );
      },
      onKeyDown: handleKeyDown,
      onPaste: handlePaste,
      onPointerCancel: handlePointerCancel,
      onPointerDown: handlePointerDown,
      onPointerUp: handlePointerUp,
      role: 'group',
      tabIndex: 0,
    },
    checked: (name) => state.checked[name] === true,
    focused: (name) => state.focused === name,
    font,
    layout,
    pressed: (name) => state.pressed === name,
    text: (name) => state.text[name] ?? createEditableTextEditorState(),
    textControls,
    textMetrics,
    theme,
  };
};

const fieldChrome = (
  bounds: RoyalFormBounds,
  focused: boolean,
  theme: RoyalFormTheme,
): ReactNode => (
  <>
    {rect({
      height: bounds.height + 0.08,
      width: bounds.width + 0.08,
      x: bounds.x - 0.04,
      y: bounds.y + 0.03,
    }, theme.shadow, -0.01)}
    {rect({
      height: bounds.height + 0.04,
      width: bounds.width + 0.04,
      x: bounds.x - 0.02,
      y: bounds.y + 0.02,
    }, focused ? theme.accentStrong : theme.border, 0.02)}
    {rect(bounds, focused ? theme.fieldFocused : theme.field, 0.04)}
  </>
);

export const Form = markRendererComponent(({
  children,
  id: _id,
  kit,
  title,
}: {
  readonly children?: unknown;
  readonly id: string;
  readonly kit: RoyalFormKit;
  readonly title?: string;
}): ReactNode => (
  <>
    {rect(kit.layout.form, kit.theme.panel, -0.04)}
    {title === undefined
      ? null
      : textNode(title, {
        color: kit.theme.ink,
        font: kit.font,
        fontSize: 0.38,
        lineHeight: 0.48,
        origin: kit.layout.heading.origin,
      })}
    {children as RoyalNodeChild}
  </>
));

export const Field = markRendererComponent(({
  children,
  kit,
  name,
}: {
  readonly children?: unknown;
  readonly kit: RoyalFormKit;
  readonly name: string;
}): ReactNode => {
  const bounds = kit.layout.fields[name];
  if (bounds === undefined) throw new Error(`Unknown form field: ${name}`);

  return (
    <>
      {fieldChrome(bounds, kit.focused(name), kit.theme)}
      {children as RoyalNodeChild}
    </>
  );
});

export const Label = markRendererComponent(({
  children,
  control,
  kit,
}: {
  readonly children?: unknown;
  readonly control: string;
  readonly kit: RoyalFormKit;
}): ReactNode => {
  const origin = kit.layout.labels[control];
  if (origin === undefined) throw new Error(`Unknown form label target: ${control}`);

  return textNode(children, {
    color: kit.theme.muted,
    font: kit.font,
    fontSize: 0.17,
    lineHeight: 0.24,
    origin,
  });
});

const renderTextControlNodes = (
  kit: RoyalFormKit,
  name: string,
): readonly ReactNode[] => {
  const definition = kit.textControls[name];
  const field = kit.layout.fields[name];
  if (definition === undefined || field === undefined) {
    throw new Error(`Unknown text form control: ${name}`);
  }

  const editor = kit.text(name);
  const fragment = createEditableTextFragment({
    color: kit.theme.ink,
    font: kit.font,
    fontSize: kit.textMetrics.fontSize,
    lineHeight: kit.textMetrics.lineHeight,
    maxWidth: field.textMaxWidth,
    mode: definition.mode,
    origin: field.textOrigin,
    selection: editor.selection,
    selectionColor: kit.theme.selection,
    showCaret: kit.focused(name),
    text: editor.text,
  });

  return fragment.nodes.map((node, index) =>
    createReactElement(RenderNodeElement, {
      key: `${name}:${index}`,
      node,
    })
  );
};

export const Input = markRendererComponent(({
  kit,
  name,
  type,
}: {
  readonly kit: RoyalFormKit;
  readonly name: string;
  readonly type: 'text';
}): ReactNode => {
  void type;
  return (
    <>
      {renderTextControlNodes(kit, name)}
    </>
  );
});

export const Textarea = markRendererComponent(({
  kit,
  name,
}: {
  readonly kit: RoyalFormKit;
  readonly name: string;
}): ReactNode => (
  <>
    {renderTextControlNodes(kit, name)}
  </>
));

export const Checkbox = markRendererComponent(({
  children,
  kit,
  name,
}: {
  readonly children?: unknown;
  readonly kit: RoyalFormKit;
  readonly name: string;
}): ReactNode => {
  const bounds = kit.layout.checkboxes[name];
  if (bounds === undefined) throw new Error(`Unknown checkbox form control: ${name}`);

  const box = {
    height: 0.42,
    width: 0.42,
    x: bounds.x,
    y: bounds.y,
  };
  const inner = {
    height: 0.28,
    width: 0.28,
    x: bounds.x + 0.07,
    y: bounds.y - 0.07,
  };
  const checked = kit.checked(name);

  return (
    <>
      {rect(box, kit.focused(name) || kit.pressed(name) ? kit.theme.accentStrong : kit.theme.border, 0.03)}
      {rect(inner, checked ? kit.theme.accent : kit.theme.field, 0.06)}
      {checked
        ? textNode('x', {
          color: kit.theme.background,
          font: kit.font,
          fontSize: 0.26,
          lineHeight: 0.28,
          origin: [bounds.x + 0.15, bounds.y - 0.3, 0.12],
        })
        : null}
      {textNode(children, {
        color: kit.theme.ink,
        font: kit.font,
        fontSize: 0.2,
        lineHeight: 0.28,
        origin: [bounds.x + 0.58, bounds.y - 0.29, 0.12],
      })}
    </>
  );
});

export const Button = markRendererComponent(({
  children,
  kit,
  name,
  type,
}: {
  readonly children?: unknown;
  readonly kit: RoyalFormKit;
  readonly name: string;
  readonly type: 'submit';
}): ReactNode => {
  const bounds = kit.layout.buttons[name];
  if (bounds === undefined) throw new Error(`Unknown button form control: ${name}`);

  const fill = type === 'submit' && (kit.focused(name) || kit.pressed(name))
    ? kit.theme.accentStrong
    : kit.theme.button;

  return (
    <>
      {rect(bounds, fill, 0.05)}
      {textNode(children, {
        color: [1, 1, 1, 1],
        font: kit.font,
        fontSize: 0.2,
        lineHeight: 0.28,
        origin: [bounds.x + 0.28, bounds.y - 0.39, 0.12],
      })}
    </>
  );
});

export const FormStatus = markRendererComponent(({
  children,
  kit,
}: {
  readonly children?: unknown;
  readonly kit: RoyalFormKit;
}): ReactNode =>
  textNode(children, {
    color: kit.theme.muted,
    font: kit.font,
    fontSize: 0.16,
    lineHeight: 0.24,
    origin: kit.layout.status.origin,
  }));

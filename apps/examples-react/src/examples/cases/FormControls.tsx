import { Canvas, canvasPointToWorld, editableTextKeyboardIntent } from '@royal/react';
import {
  useReducer,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  activeEditableTextControl,
  caretSelectionAtFormPoint,
  editableTextControlForId,
  formControlsCameraBounds,
  formControlsKeyboardAction,
  formControlsModel,
  formControlsReducer,
  hitTestFormControls,
} from './FormControls.model';
import { formControlsScene } from './FormControls.scene';
import { useAtkinsonFont } from './text-font';

const rootOptions = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

export const FormControls = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const font = fontState.status === 'ready' ? fontState.font : undefined;
  const [model, dispatch] = useReducer(formControlsReducer, formControlsModel);
  const activeText = activeEditableTextControl(model);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (event.button !== 0) return;

    const [x, y] = canvasPointToWorld(
      event.currentTarget,
      formControlsCameraBounds,
      event.clientX,
      event.clientY,
    );
    const point = { x, y };
    const hit = hitTestFormControls(point);

    if (hit === undefined) {
      dispatch({ type: 'blur' });
      return;
    }

    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });

    if (hit.type === 'editable-text') {
      const control = editableTextControlForId(model, hit.id);
      dispatch({
        id: hit.id,
        selection: caretSelectionAtFormPoint(control, font, point),
        type: 'focus-text',
      });
      return;
    }

    dispatch({ type: hit.type === 'checkbox' ? 'toggle-checkbox' : 'press-button' });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>): void => {
    const modelAction = formControlsKeyboardAction(model, {
      key: event.key,
      shiftKey: event.shiftKey,
    });
    if (modelAction !== undefined) {
      event.preventDefault();
      dispatch(modelAction);
      return;
    }

    if (activeText === undefined) return;

    const intent = editableTextKeyboardIntent({
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      isComposing: event.nativeEvent.isComposing,
      key: event.key,
      keyCode: event.keyCode,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
    }, { mode: activeText.mode });

    if (intent === undefined || intent.type === 'clipboard-shortcut') return;

    event.preventDefault();

    if (intent.type === 'enter-key') {
      dispatch({ type: 'press-button' });
      return;
    }

    dispatch({ command: intent, type: 'edit-active-text' });
  };

  return (
    <Canvas
      aria-label="Form controls"
      aria-keyshortcuts="Tab Shift+Tab Space Enter"
      onBlur={() => dispatch({ type: 'blur' })}
      onFocus={() => dispatch({ type: 'focus-initial-control' })}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      role="group"
      rootOptions={rootOptions}
      tabIndex={0}
    >
      {formControlsScene(model, font)}
    </Canvas>
  );
};

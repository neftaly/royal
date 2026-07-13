import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { createFrameLoop, type FrameLoop } from "./frame";
import {
  acquireExternalRenderClockForRoyalRoot,
  createRendererRoot,
  rendererRootContextOptionsSemanticKey,
  type RoyalRendererFrameClock,
  type RoyalRendererRoot,
  type RoyalRendererRootContextOptions,
  type RoyalRendererRootLifecycleSnapshot,
  type RoyalRendererRootOptions,
} from "./root";

type CanvasElementRef = {
  readonly current: HTMLCanvasElement | null;
};

export interface CanvasRendererRuntime {
  readonly error: unknown;
  readonly frameLoop: FrameLoop;
  readonly root: RoyalRendererRoot | null;
}

type CanvasRendererRootState = {
  readonly key: string;
  readonly root: RoyalRendererRoot | null;
};

type CanvasRendererErrorState = {
  readonly error: unknown;
  readonly key: string;
};

const retainFirstCanvasRendererError = (
  current: CanvasRendererErrorState | undefined,
  error: unknown,
  key: string,
): CanvasRendererErrorState => current?.key === key ? current : { error, key };

/** @internal Applies renderer availability to the retained Canvas frame loop. */
export const applyCanvasRendererLifecycle = (
  frameLoop: FrameLoop,
  reportError: (error: Error) => void,
  snapshot: RoyalRendererRootLifecycleSnapshot,
): void => {
  const available = snapshot.lifecycle === "available";
  frameLoop.setPaused(!available);
  if (snapshot.lifecycle === "failed") {
    reportError(new Error(snapshot.error ?? "Royal renderer context restoration failed"));
  }
};

/** @internal Normalizes opaque scheduled-render failures for React ErrorBoundary handling. */
export const applyCanvasRendererFailure = (
  reportError: (error: Error) => void,
  failure: unknown,
): void => {
  const detail = failure === null
    ? "null"
    : typeof failure === "string"
      || typeof failure === "number"
      || typeof failure === "boolean"
      || typeof failure === "bigint"
      || typeof failure === "symbol"
      ? String(failure)
      : "an opaque non-Error value";
  reportError(failure instanceof Error
    ? failure
    : new Error(failure === undefined
      ? "Royal scheduled render failed without an error value"
      : `Royal scheduled render failed: ${detail}`));
};

/** @internal Releases Canvas ownership before entering fallible renderer cleanup. */
export const disposeCanvasRendererRoot = (
  rootRef: MutableRefObject<RoyalRendererRoot | null>,
  root: RoyalRendererRoot,
): void => {
  if (rootRef.current === root) rootRef.current = null;
  root.dispose();
};

/** @internal Normalizes semantically empty Canvas context options. */
export const normalizeCanvasRendererOptions = (
  context: RoyalRendererRootContextOptions | undefined,
): RoyalRendererRootOptions | undefined => {
  if (context === undefined || Object.values(context).every((value) => value === undefined)) {
    return undefined;
  }
  return { context };
};

/** Owns the renderer root and retained frame-loop lifetime for one React Canvas. */
export const useRendererRootRuntime = (
  canvasRef: CanvasElementRef,
  context: RoyalRendererRootContextOptions | undefined,
): CanvasRendererRuntime => {
  const rootRef = useRef<RoyalRendererRoot | null>(null);
  const rendererFrameClockRef = useRef<RoyalRendererFrameClock | undefined>(undefined);
  const [errorState, setErrorState] = useState<CanvasRendererErrorState | undefined>(undefined);
  const [rootState, setRootState] = useState<CanvasRendererRootState | undefined>(undefined);
  const optionsKeyRef = useRef("");
  const frameLoop = useMemo(() => createFrameLoop((failure) => {
    const normalizedFailure = failure
      ?? new Error("Royal frame callback failed without an error value");
    const failureKey = optionsKeyRef.current;
    setErrorState((current) =>
      retainFirstCanvasRendererError(current, normalizedFailure, failureKey));
  }), []);
  const optionsKey = rendererRootContextOptionsSemanticKey(context);
  optionsKeyRef.current = optionsKey;
  const optionsRef = useRef<{
    readonly key: string;
    readonly options: RoyalRendererRootOptions | undefined;
  } | undefined>(undefined);
  if (optionsRef.current?.key !== optionsKey) {
    optionsRef.current = {
      key: optionsKey,
      options: normalizeCanvasRendererOptions(context),
    };
  }
  const options = optionsRef.current.options;
  const root = rootState?.key === optionsKey ? rootState.root : null;
  const error = errorState?.key === optionsKey ? errorState.error : null;

  useLayoutEffect(() => () => {
    frameLoop.dispose();
  }, [frameLoop]);

  useLayoutEffect(() => frameLoop.afterFrame(() => {
    const rendererFrameClock = rendererFrameClockRef.current;
    if (rendererFrameClock === undefined) rootRef.current?.flushInvalidated();
    else rendererFrameClock.flushInvalidated();
  }), [frameLoop]);

  useLayoutEffect(() => {
    if (root === null) return undefined;
    const rootKey = optionsKey;
    return root.observeLifecycle((snapshot) => {
      applyCanvasRendererLifecycle(frameLoop, (failure) => {
        setErrorState((current) =>
          retainFirstCanvasRendererError(current, failure, rootKey));
      }, snapshot);
    });
  }, [frameLoop, optionsKey, root]);

  useLayoutEffect(() => {
    if (root === null) return undefined;
    const rootKey = optionsKey;
    return root.observeRenderFailures((failure) => {
      applyCanvasRendererFailure((normalizedFailure) => {
        setErrorState((current) =>
          retainFirstCanvasRendererError(current, normalizedFailure, rootKey));
      }, failure);
    });
  }, [optionsKey, root]);

  // The first useFrame subscriber takes renderer clock ownership until the
  // active run ends; static canvases leave demand scheduling with the root.
  useLayoutEffect(() => {
    if (root === null) return undefined;

    const stopObserving = frameLoop.observeActivity((active) => {
      if (active) {
        rendererFrameClockRef.current ??= acquireExternalRenderClockForRoyalRoot(root);
      } else {
        rendererFrameClockRef.current?.release();
        rendererFrameClockRef.current = undefined;
      }
    });

    return () => {
      stopObserving();
      rendererFrameClockRef.current?.release();
      rendererFrameClockRef.current = undefined;
    };
  }, [frameLoop, root]);

  // React owns the canvas element; Royal owns its WebGL root.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) throw new Error("Canvas ref was not attached");

    let nextRoot: RoyalRendererRoot;
    try {
      nextRoot = createRendererRoot(canvas, options);
      rootRef.current = nextRoot;
      setErrorState(undefined);
    } catch (creationError) {
      rootRef.current = null;
      setRootState({ key: optionsKey, root: null });
      setErrorState({ error: creationError, key: optionsKey });
      return undefined;
    }
    setRootState({ key: optionsKey, root: nextRoot });

    return () => {
      disposeCanvasRendererRoot(rootRef, nextRoot);
    };
  }, [canvasRef, options, optionsKey]);

  return { error, frameLoop, root };
};

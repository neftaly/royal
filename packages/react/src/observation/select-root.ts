import type { RoyalRendererRoot } from "@royal/renderer-webgl";

export interface RendererObservationOptions {
  /** Root received from `Canvas.rendererRef`; `null` represents pre-mount. */
  readonly root: RoyalRendererRoot | null;
}

/** @internal Resolves the one consistent context-or-explicit-root placement model. */
export const selectObservedRoot = (
  contextRoot: RoyalRendererRoot | null | undefined,
  options: RendererObservationOptions | undefined,
  hookName: string,
): RoyalRendererRoot | null => {
  if (options !== undefined) return options.root;
  if (contextRoot === undefined) {
    throw new Error(`${hookName} must be used inside <Canvas> or receive { root }`);
  }
  return contextRoot;
};

import type { RendererRoot } from "@royal/renderer-webgl";
import { recordWithAllowedFields } from "../validation";

const OBSERVATION_OPTION_FIELDS = ["root"] as const;

export interface RendererObservationOptions {
  /** Root received from `Canvas.rendererRef`; `null` represents pre-mount. */
  readonly root: RendererRoot | null;
}

/** @internal Resolves the one consistent context-or-explicit-root placement model. */
export const selectObservedRoot = (
  contextRoot: RendererRoot | null | undefined,
  options: RendererObservationOptions | undefined,
  hookName: string,
): RendererRoot | null => {
  if (options !== undefined) {
    const record = recordWithAllowedFields(
      options,
      OBSERVATION_OPTION_FIELDS,
      `${hookName} options`,
      "option",
    );
    if (!Object.hasOwn(record, "root")) {
      throw new TypeError(`${hookName} options require root`);
    }
    const root = record.root;
    if (root !== null && (typeof root !== "object" || Array.isArray(root))) {
      throw new TypeError(`${hookName} root must be a renderer root or null`);
    }
    return root as RendererRoot | null;
  }
  if (contextRoot === undefined) {
    throw new Error(`${hookName} must be used inside <Canvas> or receive { root }`);
  }
  return contextRoot;
};

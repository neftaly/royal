import type { RoyalRendererRoot } from "./root";
import { useOptionalCanvasRoot } from "./canvas";

/** Selects an explicitly owned renderer root for an asset-status hook. */
export interface AssetStatusOptions {
  /** Root received from `Canvas.rendererRef`; `null` represents the pre-mount lifecycle. */
  readonly root: RoyalRendererRoot | null;
}

/** One root-selection path shared by glTF and texture observation. */
export const useAssetStatusRoot = (
  options: AssetStatusOptions | undefined,
  hookName: string,
): RoyalRendererRoot | null => {
  const contextRoot = useOptionalCanvasRoot();
  if (options !== undefined) return options.root;
  if (contextRoot === undefined) {
    throw new Error(`${hookName} must be used inside <Canvas> or receive { root }`);
  }
  return contextRoot;
};

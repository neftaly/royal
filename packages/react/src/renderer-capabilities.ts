import type {
  XrSession,
  XrSessionRenderer,
  XrSessionRendererOptions,
} from "./xr/renderer-model";

/** Ownership token for an external renderer frame clock. */
export interface RoyalRendererFrameClock {
  /** Flushes demand while this is the root's sole external clock owner. */
  flushInvalidated(): void;
  /** Returns scheduling to the root after the last external owner releases. */
  release(): void;
}

/** @internal Backend operations used by optional React renderer integrations. */
export interface RoyalRendererCapabilities {
  acquireExternalRenderClock(): RoyalRendererFrameClock;
  createXrSessionRenderer(
    session: XrSession,
    options?: XrSessionRendererOptions,
  ): Promise<XrSessionRenderer>;
}

const rendererCapabilities = new WeakMap<object, RoyalRendererCapabilities>();

/** @internal Registers the capability adapter owned by a renderer root factory. */
export const registerRoyalRendererCapabilities = (
  root: object,
  capabilities: RoyalRendererCapabilities,
): void => {
  if (rendererCapabilities.has(root)) {
    throw new Error("Royal renderer capabilities are already registered for this root");
  }
  rendererCapabilities.set(root, capabilities);
};

/** @internal Resolves optional integration operations without exposing a concrete backend root. */
export const royalRendererCapabilitiesFor = (
  root: object,
): RoyalRendererCapabilities => {
  const capabilities = rendererCapabilities.get(root);
  if (capabilities === undefined) {
    throw new Error("Royal renderer root does not provide the required integration capabilities");
  }
  return capabilities;
};

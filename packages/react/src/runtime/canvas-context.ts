import type { RendererRoot } from "@royal/renderer-webgl";
import { createContext, useContext, type Context } from "react";

/** Stable context identities shared by the Canvas shell and observation hooks. */
export const CanvasElementContext: Context<HTMLCanvasElement | null | undefined> =
  createContext<HTMLCanvasElement | null | undefined>(undefined);
export const CanvasRootContext: Context<RendererRoot | null | undefined> =
  createContext<RendererRoot | null | undefined>(undefined);

/** Returns the surrounding canvas, or `null` before its ref is attached. */
export const useCanvasElement = (): HTMLCanvasElement | null => {
  const canvas = useContext(CanvasElementContext);
  if (canvas === undefined) throw new Error("useCanvasElement must be used inside <Canvas>");
  return canvas;
};

/** @internal Context probe for focused hooks that also accept an explicit root. */
export const useOptionalCanvasRoot = (): RendererRoot | null | undefined =>
  useContext(CanvasRootContext);

/** Returns the surrounding renderer root, or `null` during its mount lifecycle. */
export const useCanvasRoot = (): RendererRoot | null => {
  const root = useOptionalCanvasRoot();
  if (root === undefined) throw new Error("useCanvasRoot must be used inside <Canvas>");
  return root;
};

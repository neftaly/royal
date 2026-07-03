import {
  createRendererElement,
  RendererFragment,
  type RoyalRendererJsxElement,
  type JSX as RoyalReactJSX,
} from './jsx-runtime-internal';
export const Fragment = RendererFragment;

type RendererJsxComponent = (props: never) => unknown;
type RendererJsxElementType = keyof JSX.IntrinsicElements | RendererJsxComponent;
type RendererJsxFactory = (
  type: RendererJsxElementType,
  props: Record<string, unknown> | null,
  key?: string
) => RoyalRendererJsxElement;

export const jsx = createRendererElement as RendererJsxFactory;
export const jsxs = createRendererElement as RendererJsxFactory;

export namespace JSX {
  export type Element = RoyalRendererJsxElement;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicElements extends RoyalReactJSX.IntrinsicElements {}
}

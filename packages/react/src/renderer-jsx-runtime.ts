import {
  createRendererElement,
  Fragment,
  type RoyalRendererJsxElement,
  type JSX as RoyalReactJSX,
} from './jsx-runtime';

export { Fragment };

type RendererJsxComponent = (props: Record<string, unknown>) => RoyalRendererJsxElement;
type RendererJsxElementType = keyof JSX.IntrinsicElements | RendererJsxComponent;
type RendererJsxFactory = (
  type: RendererJsxElementType,
  props: Record<string, unknown> | null,
  key?: string
) => RoyalRendererJsxElement;

export const jsx: RendererJsxFactory = createRendererElement;
export const jsxs: RendererJsxFactory = createRendererElement;

export namespace JSX {
  export type Element = RoyalRendererJsxElement;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicElements extends RoyalReactJSX.IntrinsicElements {}
}

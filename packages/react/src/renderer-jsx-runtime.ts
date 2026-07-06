import {
  createRendererElement,
  RendererFragment,
  type RoyalRendererIntrinsicElements,
  type RoyalIntrinsicElementType,
  type RoyalRendererJsxElement,
  type JSX as RoyalReactJSX,
} from './jsx-runtime-internal';
import type { Key } from 'react';
export const Fragment = RendererFragment;

type RendererJsxComponent = (props: never) => unknown;
type RendererJsxElementType = RoyalIntrinsicElementType | RendererJsxComponent;
type RendererJsxFactory = (
  type: RendererJsxElementType,
  props: Record<string, unknown> | null,
  key?: Key
) => RoyalRendererJsxElement;

export const jsx = createRendererElement as RendererJsxFactory;
export const jsxs = createRendererElement as RendererJsxFactory;

export namespace JSX {
  export type Element = RoyalRendererJsxElement;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes extends RoyalReactJSX.IntrinsicAttributes {}

  export interface IntrinsicElements extends RoyalRendererIntrinsicElements {}
}

import type { JSX as ReactJSX, Key, ReactNode } from 'react';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs
} from 'react/jsx-runtime';
import type {
  GltfProps,
  MeshProps,
  PassProps,
  RendererTextProps,
  RoyalRendererIntrinsicElementProps,
  RoyalRendererJsxChild,
  RoyalRendererJsxElement,
  SceneProps,
} from './renderer-descriptor';
import {
  Text as TextControl,
  type TextareaProps as SurfaceTextareaProps,
  type InputProps as SurfaceInputProps,
  type ButtonProps as SurfaceButtonProps,
  type TextProps as SurfaceTextProps,
  type TextSurfaceBox,
  type TextSurfaceControlStyle
} from './text/surface';

export {
  createRendererElement,
  isRenderRootDescriptor,
  isRoyalRendererJsxElement,
} from './renderer-descriptor';
export type {
  GltfProps,
  MeshProps,
  PassProps,
  RendererTextProps,
  RoyalIntrinsicElementType,
  RoyalRendererJsxChild,
  RoyalRendererJsxElement,
  SceneProps,
} from './renderer-descriptor';

type Component = (props: never) => ReactNode;
type ReactJsxFactory = typeof reactJsx;
type SurfaceTextActivationProps =
  | { readonly box: TextSurfaceBox }
  | { readonly copyable: true }
  | { readonly selectable: true }
  | { readonly style: TextSurfaceControlStyle };
export type SurfaceTextElementProps = SurfaceTextProps & SurfaceTextActivationProps;
export type TextProps = RendererTextProps | SurfaceTextElementProps;
export type RoyalIntrinsicAttributes = ReactJSX.IntrinsicAttributes;
type WithRoyalIntrinsicAttributes<Props> = Props & RoyalIntrinsicAttributes;
type RoyalIntrinsicElementMap<Elements> = {
  readonly [Name in keyof Elements]: WithRoyalIntrinsicAttributes<Elements[Name]>;
};
type RoyalIntrinsicElementProps = Omit<RoyalRendererIntrinsicElementProps, 'text'> & {
  text: TextProps;
};
export type RoyalRendererIntrinsicElements = RoyalIntrinsicElementMap<RoyalRendererIntrinsicElementProps>;
export type RoyalIntrinsicElements = RoyalIntrinsicElementMap<RoyalIntrinsicElementProps>;
type ReactIntrinsicElements = Omit<ReactJSX.IntrinsicElements, keyof RoyalIntrinsicElements>;
type ElementType = keyof JSX.IntrinsicElements | Component;
export type ButtonProps = SurfaceButtonProps;
export type InputProps = SurfaceInputProps;
export type TextareaProps = SurfaceTextareaProps;
type JsxProps = Partial<
  SceneProps &
  PassProps &
  MeshProps &
  TextProps &
  GltfProps
> & Record<string, unknown>;

const reactFactoryFor = (props: JsxProps | null): ReactJsxFactory =>
  Array.isArray(props?.children) ? reactJsxs : reactJsx;

const toInteractiveText = (
  props: SurfaceTextElementProps,
  key: Key | undefined,
): ReactNode => reactJsx(TextControl as Parameters<ReactJsxFactory>[0], props as SurfaceTextProps, key);

const hasInteractiveTextProps = (props: TextProps | null): props is SurfaceTextElementProps => {
  if (props === null) return false;

  return (
    ('selectable' in props && props.selectable === true) ||
    ('copyable' in props && props.copyable === true) ||
    ('box' in props && props.box !== undefined) ||
    ('style' in props && props.style !== undefined)
  );
};

const createElement = (
  type: ElementType,
  props: JsxProps | null,
  key?: Key
): ReactNode => {
  if (typeof type === 'function') {
    const factory = reactFactoryFor(props);
    return factory(type as Parameters<ReactJsxFactory>[0], props, key);
  }

  if (type === 'text' && hasInteractiveTextProps(props as TextProps | null)) {
    return toInteractiveText(props as SurfaceTextElementProps, key);
  }

  const factory = reactFactoryFor(props);
  return factory(type as Parameters<ReactJsxFactory>[0], props, key);
};

export const RendererFragment = (_props: {
  readonly children?: RoyalRendererJsxChild;
}): RoyalRendererJsxElement => _props.children as RoyalRendererJsxElement;

export const Fragment = ReactFragment;
export const jsx = createElement;
export const jsxs = createElement;

export namespace JSX {
  export type Element = ReactNode;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}

  export interface IntrinsicElements extends ReactIntrinsicElements, RoyalIntrinsicElements {}
}

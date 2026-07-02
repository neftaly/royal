import type {
  Camera,
  Geometry,
  GeometryKindValue,
  Material,
  RenderElement,
} from '@royal/renderer-core';
import { isValidElement, type ReactNode } from 'react';
import { jsx as reactJsx } from 'react/jsx-runtime';

export const rendererDescriptorHostType = 'royalDescriptor';

export type RoyalRendererDescriptor =
  | RenderElement
  | Camera
  | Geometry<GeometryKindValue>
  | Material;

export type RendererComponentOutput =
  | ReactNode
  | RoyalRendererDescriptor
  | readonly RendererComponentOutput[];

export type RendererDescriptorHostProps = {
  readonly descriptor: RoyalRendererDescriptor;
};

export const isRoyalRendererDescriptor = (
  value: unknown,
): value is RoyalRendererDescriptor =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value;

const isRendererComponentOutputArray = (
  value: RendererComponentOutput,
): value is readonly RendererComponentOutput[] => Array.isArray(value);

export const rendererOutputToReact = (
  output: RendererComponentOutput,
  key?: string,
): ReactNode => {
  if (isRoyalRendererDescriptor(output)) {
    return reactJsx(
      rendererDescriptorHostType as Parameters<typeof reactJsx>[0],
      { descriptor: output } satisfies RendererDescriptorHostProps,
      key,
    );
  }

  if (isRendererComponentOutputArray(output)) {
    return output.map((child, index) =>
      rendererOutputToReact(child, `${key ?? 'node'}:${index}`)
    );
  }

  if (isValidElement(output)) return output;

  return output as ReactNode;
};

export const rendererOutputToSingleDescriptor = (
  output: RendererComponentOutput,
): RoyalRendererDescriptor => {
  if (isRoyalRendererDescriptor(output)) return output;

  if (Array.isArray(output) && output.length === 1) {
    return rendererOutputToSingleDescriptor(output[0]);
  }

  throw new Error('Royal renderer JSX components must return one renderer descriptor');
};

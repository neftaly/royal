import {
  directionalLight,
  gltf,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
  type Camera,
  type DirectionalLightOptions,
  type GltfOptions,
  type Material,
  type MeshOptions,
  type OrthographicCameraOptions,
  type PerspectiveCameraOptions,
  type RenderElement,
  type RenderNode,
  type RenderPass,
  type RenderPassOptions,
  type Rgba,
  type TextOptions
} from '@royal/renderer-core';
import type { ReactNode } from 'react';

type RendererJsxElement = RenderElement | Camera;
type ComponentOutput = ReactNode | RendererJsxElement;
type EmptyJsxChild = null | undefined | false;
type RendererJsxChild = ComponentOutput | EmptyJsxChild | readonly RendererJsxChild[];
type Component = (props: Record<string, unknown>) => ComponentOutput;
type ElementType = keyof JSX.IntrinsicElements | Component;

type SceneProps = {
  readonly children?: RendererJsxChild;
};

type PassProps = Omit<RenderPassOptions, 'camera' | 'children'> & {
  readonly camera?: Camera;
  readonly children?: RendererJsxChild;
};
type MeshBaseColor = MeshOptions['material']['baseColor'] | Rgba;
type MeshProps = Omit<MeshOptions, 'material'> & (
  | {
    readonly baseColor?: never;
    readonly material: Material;
  }
  | {
    readonly baseColor: MeshBaseColor;
    readonly material?: never;
  }
);

const isRendererJsxChildArray = (
  value: RendererJsxChild
): value is readonly RendererJsxChild[] => Array.isArray(value);

const toArray = (value: RendererJsxChild): readonly ComponentOutput[] => {
  if (isRendererJsxChildArray(value)) {
    return value.flatMap((child) => toArray(child));
  }

  if (value === null || value === undefined || value === false) {
    return [];
  }

  return [value];
};

const isCamera = (element: ComponentOutput): element is Camera =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  (element.kind === 'perspective-camera' || element.kind === 'orthographic-camera');

const isRenderNode = (element: ComponentOutput): element is RenderNode =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  (
    element.kind === 'mesh' ||
    element.kind === 'gltf' ||
    element.kind === 'directional-light' ||
    element.kind === 'text'
  );

const toRenderPasses = (children: RendererJsxChild): readonly RenderPass[] =>
  toArray(children).map((child) => {
    if (typeof child !== 'object' || child === null || !('kind' in child) || child.kind !== 'pass') {
      throw new Error('Expected pass child under scene');
    }

    return child;
  });

const toPass = (props: PassProps): RenderPass => {
  let camera = props.camera;
  const children: RenderNode[] = [];

  for (const child of toArray(props.children)) {
    if (isCamera(child)) {
      if (camera !== undefined) {
        throw new Error('pass expects exactly one camera');
      }

      camera = child;
      continue;
    }

    if (isRenderNode(child)) {
      children.push(child);
      continue;
    }

    throw new Error('Expected camera or render node child under pass');
  }

  if (camera === undefined) {
    throw new Error('pass expects exactly one camera');
  }

  const renderPass = {
    camera,
    children
  } satisfies Omit<RenderPassOptions, 'clearColor'>;

  return pass(
    props.clearColor === undefined
      ? renderPass
      : { ...renderPass, clearColor: props.clearColor }
  );
};

const toGltf = (options: GltfOptions): RenderNode => {
  // Narrow the union before calling the overloaded factory.
  if (options.asset === undefined) {
    return gltf(options);
  }

  return gltf(options);
};

const toMesh = (props: MeshProps): RenderNode => {
  if (props.material !== undefined && props.baseColor !== undefined) {
    throw new Error('mesh expects material or baseColor, not both');
  }

  if (props.material !== undefined) {
    return mesh(props);
  }

  if (props.baseColor === undefined) {
    throw new Error('mesh expects material or baseColor');
  }

  const { baseColor, ...options } = props;

  return mesh({
    ...options,
    material: standardMaterial({ baseColor })
  });
};

const assertNever = (type: never): never => {
  throw new Error(`Unsupported JSX element: ${String(type)}`);
};

const createElement = (type: ElementType, props: Record<string, unknown>): ComponentOutput => {
  if (typeof type === 'function') {
    return type(props);
  }

  switch (type) {
    case 'scene':
      return scene({
        children: toRenderPasses((props as SceneProps).children)
      });
    case 'pass':
      return toPass(props as PassProps);
    case 'perspectiveCamera':
      return perspectiveCamera(props as unknown as PerspectiveCameraOptions);
    case 'orthographicCamera':
      return orthographicCamera(props as unknown as OrthographicCameraOptions);
    case 'directionalLight':
      return directionalLight(props as unknown as DirectionalLightOptions);
    case 'mesh':
      return toMesh(props as unknown as MeshProps);
    case 'gltf':
      return toGltf(props as unknown as GltfOptions);
    case 'text':
      return text(props as unknown as TextOptions);
    default:
      return assertNever(type);
  }
};

export const Fragment = (_props: {
  readonly children?: RendererJsxChild;
}): RendererJsxChild => _props.children;

export const jsx = createElement;
export const jsxs = createElement;

export namespace JSX {
  export type Element = ComponentOutput;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicElements {
    scene: SceneProps;
    pass: PassProps;
    perspectiveCamera: PerspectiveCameraOptions;
    orthographicCamera: OrthographicCameraOptions;
    directionalLight: DirectionalLightOptions;
    mesh: MeshProps;
    gltf: GltfOptions;
    text: TextOptions;
  }
}

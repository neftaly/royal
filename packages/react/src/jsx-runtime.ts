import {
  boxGeometry,
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  planeGeometry,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
  unlitMaterial,
  wireframeMaterial,
  type BoxGeometryOptions,
  type Camera,
  type DirectionalLightOptions,
  type Geometry,
  type GeometryKindValue,
  type GltfOptions,
  type Material,
  type MeshOptions,
  type OrthographicCameraOptions,
  type PlaneGeometryOptions,
  type PerspectiveCameraOptions,
  type RenderElement,
  type RenderNode,
  type RenderPass,
  type RenderPassOptions,
  type Rgba,
  type StandardMaterialOptions,
  type TextOptions,
  type TextureRef,
  type UnlitMaterialOptions,
  type WireframeMaterialOptions
} from '@royal/renderer-core';
import { isValidElement, type ReactNode } from 'react';
import {
  Fragment as ReactFragment,
  jsx as reactJsx,
  jsxs as reactJsxs
} from 'react/jsx-runtime';
import {
  rendererOutputToReact,
  rendererOutputToSingleDescriptor,
  type RendererComponentOutput
} from './renderer-output';
import type { RoyalPointerEventProps } from './picking-events';
import {
  ButtonPrimitive,
  InputPrimitive,
  TextareaPrimitive,
  TextPrimitive,
  type ButtonPrimitiveProps,
  type TextAreaPrimitiveProps,
  type InputPrimitiveProps,
  type TextPrimitiveProps,
  type TextSurfaceBox
} from './text-surface';

export type RoyalRendererJsxElement = RenderElement | Camera | Geometry<GeometryKindValue> | Material;
export type RoyalRendererJsxChild = ReactNode | RoyalRendererJsxElement | readonly RoyalRendererJsxChild[];
type ComponentOutput = ReactNode | RoyalRendererJsxElement;
type RendererJsxChild = RoyalRendererJsxChild;
type Component = (props: never) => RendererComponentOutput;
type ElementType = keyof JSX.IntrinsicElements | Component;
type ReactJsxFactory = typeof reactJsx;
type RendererDescriptorFactory = (props: Record<string, unknown>) => RoyalRendererJsxElement;
type MarkedRendererComponent<Component extends (props: never) => unknown> =
  Component extends (props: infer Props) => infer Output
    ? Output extends RoyalRendererJsxElement
      ? {
          (props: Props): RoyalRendererJsxElement;
          (props: Props): ReactNode;
        }
      : (props: Props) => Output
    : never;

export type SceneProps = {
  readonly children?: RendererJsxChild;
};

export type PassProps = Omit<RenderPassOptions, 'camera' | 'children'> & {
  readonly camera?: Camera;
  readonly children?: RendererJsxChild;
};
type MeshTextureInput = TextureRef | string;
export type MeshProps = Omit<MeshOptions, 'geometry' | 'material'> & {
  readonly children?: RendererJsxChild;
  readonly color?: Rgba;
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
  readonly texture?: MeshTextureInput;
} & RoyalPointerEventProps;
export type TextProps = Omit<TextOptions, 'text'> & {
  readonly box?: TextSurfaceBox;
  readonly children?: RendererJsxChild;
  readonly copyable?: boolean;
  readonly maxWidth?: number;
  readonly selectable?: boolean;
  readonly text?: string;
};
export type ButtonProps = ButtonPrimitiveProps;
export type InputProps = InputPrimitiveProps;
export type TextareaProps = TextAreaPrimitiveProps;
export type ModelProps = GltfOptions & RoyalPointerEventProps;
type MeshChildren = {
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
};
type JsxProps = Partial<
  SceneProps &
  PassProps &
  MeshProps &
  TextProps &
  ButtonProps &
  InputProps &
  TextareaProps &
  ModelProps &
  PerspectiveCameraOptions &
  OrthographicCameraOptions &
  DirectionalLightOptions &
  BoxGeometryOptions &
  PlaneGeometryOptions &
  WireframeMaterialOptions
> & Record<string, unknown>;

const reactComponentMarker = Symbol.for('@royal/react.react-component');
const rendererDescriptorFactoryMarker = Symbol.for('@royal/react.renderer-descriptor-factory');

export const markReactComponent = <Component extends object>(component: Component): Component => {
  Object.defineProperty(component, reactComponentMarker, {
    configurable: false,
    enumerable: false,
    value: true
  });

  return component;
};

export const markRendererComponent = <Component extends (props: never) => unknown>(
  component: Component,
): MarkedRendererComponent<Component> => {
  const wrapped = ((props: Parameters<Component>[0]): ReactNode =>
    rendererOutputToReact(component(props) as RendererComponentOutput)) as MarkedRendererComponent<Component>;

  Object.defineProperty(wrapped, rendererDescriptorFactoryMarker, {
    configurable: false,
    enumerable: false,
    value: (props: Record<string, unknown>) => {
      const output = component(props as Parameters<Component>[0]) as RendererComponentOutput;
      const descriptor = rendererOutputToSingleDescriptor(output);
      if (isRoyalRendererJsxElement(descriptor)) return descriptor;

      throw new Error('Royal renderer JSX components must return one renderer descriptor');
    }
  });

  return wrapped;
};

const rendererDescriptorFactory = (type: ElementType): RendererDescriptorFactory | undefined =>
  typeof type === 'function'
    ? (type as { readonly [rendererDescriptorFactoryMarker]?: RendererDescriptorFactory })[rendererDescriptorFactoryMarker]
    : undefined;

const reactFactoryFor = (props: JsxProps | null): ReactJsxFactory =>
  Array.isArray(props?.children) ? reactJsxs : reactJsx;

export const isRoyalRendererJsxElement = (value: unknown): value is RoyalRendererJsxElement =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value;

const isRendererJsxChildArray = (
  value: RendererJsxChild
): value is readonly RendererJsxChild[] => Array.isArray(value);

const toArray = (value: RendererJsxChild): readonly ComponentOutput[] => {
  if (isRendererJsxChildArray(value)) {
    return value.flatMap((child) => toArray(child));
  }

  if (typeof value === 'boolean' || value === null || value === undefined) {
    return [];
  }

  return [value];
};

const toStructuralArray = (value: RendererJsxChild): readonly ComponentOutput[] =>
  toArray(value).filter((child) => !(typeof child === 'string' && child.trim() === ''));

const toTextContent = (children: RendererJsxChild | undefined): string =>
  toArray(children).map((child) => {
    if (
      typeof child === 'string' ||
      typeof child === 'number' ||
      typeof child === 'bigint'
    ) {
      return String(child);
    }

    throw new Error('Expected text content child under text');
  }).join('');

const isCamera = (element: ComponentOutput): element is Camera =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  (element.kind === 'perspective-camera' || element.kind === 'orthographic-camera');

const describeJsxChild = (child: ComponentOutput | undefined): string => {
  if (child === undefined) return 'nothing';

  if (typeof child === 'object' && child !== null && 'kind' in child) {
    return `kind "${String(child.kind)}"`;
  }

  if (typeof child === 'object' && child !== null && '$$typeof' in child) {
    return 'React element';
  }

  return typeof child;
};

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

const isMaterial = (element: ComponentOutput): element is Material =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  (
    element.kind === 'standard' ||
    element.kind === 'unlit' ||
    element.kind === 'wireframe'
  );

const isGeometry = (element: ComponentOutput): element is Geometry<GeometryKindValue> =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  (element.kind === 'box' || element.kind === 'plane');

const isRenderPass = (element: ComponentOutput): element is RenderPass =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  element.kind === 'pass' &&
  'camera' in element &&
  'children' in element;

const toRenderPasses = (children: RendererJsxChild): readonly RenderPass[] =>
  toStructuralArray(children).map((child) => {
    if (isRenderPass(child)) return child;
    if (isValidElement(child)) return child as unknown as RenderPass;

    throw new Error(`scene children must be pass elements; received ${describeJsxChild(child)}`);
  });

const toRenderNodes = (
  children: RendererJsxChild | undefined,
  errorPrefix: string
): readonly RenderNode[] => {
  const nodes: RenderNode[] = [];

  for (const child of toStructuralArray(children)) {
    if (isRenderNode(child)) {
      nodes.push(child);
      continue;
    }

    if (isValidElement(child)) {
      nodes.push(child as unknown as RenderNode);
      continue;
    }

    throw new Error(`${errorPrefix}; received ${describeJsxChild(child)}`);
  }

  return nodes;
};

const toPass = (props: PassProps): RenderPass => {
  let camera = props.camera;
  const children: RenderNode[] = [];

  for (const child of toStructuralArray(props.children)) {
    if (isCamera(child)) {
      if (camera !== undefined) {
        throw new Error('pass expects exactly one camera');
      }

      camera = child;
      continue;
    }

    children.push(...toRenderNodes([child], 'pass children must be one camera plus render nodes'));
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

export const toMesh = (props: MeshProps): RenderNode => {
  const children = toMeshChildren(props);
  const hasTextureMaterial = props.texture !== undefined;
  const materialSourceCount =
    (props.material === undefined ? 0 : 1) +
    (children.material === undefined ? 0 : 1) +
    (hasTextureMaterial ? 1 : 0) +
    (props.color === undefined ? 0 : 1);

  if (materialSourceCount > 1) {
    throw new Error('mesh expects only one material source: material, material child, color, or texture');
  }

  if (props.material !== undefined) {
    return mesh(toMeshOptions(props, props.material, children.geometry));
  }

  if (children.material !== undefined) {
    return mesh(toMeshOptions(props, children.material, children.geometry));
  }

  if (hasTextureMaterial) {
    return mesh(toMeshOptions(props, standardMaterial({
      texture: toMeshTexture(props.texture)
    }), children.geometry));
  }

  if (props.color === undefined) {
    throw new Error('mesh expects material, color, or texture');
  }

  return mesh(toMeshOptions(props, standardMaterial({ color: props.color }), children.geometry));
};

export const toGltfNode = (options: GltfOptions): RenderNode => gltf(options);

const toMeshTexture = (texture: MeshTextureInput | undefined): TextureRef => {
  if (texture === undefined) {
    throw new Error('mesh texture was not provided');
  }

  return typeof texture === 'string' ? imageTexture(texture) : texture;
};

const toMeshChildren = (props: MeshProps): MeshChildren => {
  const structuralChildren = toStructuralArray(props.children);
  const children: {
    geometry?: Geometry<GeometryKindValue>;
    material?: Material;
  } = {};

  for (const child of structuralChildren) {
    if (isGeometry(child)) {
      if (children.geometry !== undefined) {
        throw new Error('mesh expects at most one geometry child');
      }

      children.geometry = child;
      continue;
    }

    if (isMaterial(child)) {
      if (children.material !== undefined) {
        throw new Error('mesh expects at most one material child');
      }

      children.material = child;
      continue;
    }

    throw new Error(`mesh children must be geometry or material descriptors; received ${describeJsxChild(child)}`);
  }

  return children;
};

const toMeshGeometry = (
  props: MeshProps,
  childGeometry: Geometry<GeometryKindValue> | undefined
): Geometry<GeometryKindValue> => {
  if (props.geometry !== undefined && childGeometry !== undefined) {
    throw new Error('mesh expects geometry as a prop or child, not both');
  }

  if (props.geometry !== undefined) return props.geometry;
  if (childGeometry !== undefined) return childGeometry;

  throw new Error('mesh expects geometry as a prop or child');
};

const toMeshOptions = (
  props: MeshProps,
  material: Material,
  childGeometry: Geometry<GeometryKindValue> | undefined
): MeshOptions => {
  const options = {
    geometry: toMeshGeometry(props, childGeometry),
    material,
    ...(props.pickingId === undefined ? {} : { pickingId: props.pickingId }),
    ...(props.ref === undefined ? {} : { ref: props.ref })
  } satisfies Omit<MeshOptions, 'transform'>;

  return props.transform === undefined
    ? options
    : { ...options, transform: props.transform };
};

export const toText = (props: TextProps): RenderNode => {
  if (props.box !== undefined) {
    throw new Error('text box props require the @royal/react Canvas runtime');
  }

  const textValue = typeof props.text === 'string'
    ? props.text
    : toTextContent(props.children);

  return text({
    color: props.color,
    ...(props.font === undefined ? {} : { font: props.font }),
    ...(props.fontSize === undefined ? {} : { fontSize: props.fontSize }),
    ...(props.lineHeight === undefined ? {} : { lineHeight: props.lineHeight }),
    ...(props.origin === undefined ? {} : { origin: props.origin }),
    text: textValue
  });
};

const toInteractiveText = (
  props: TextProps,
  key: string | undefined,
): ReactNode => reactJsx(TextPrimitive as Parameters<ReactJsxFactory>[0], props as TextPrimitiveProps, key);

const toInput = (
  props: InputProps,
  key: string | undefined,
): ReactNode => reactJsx(InputPrimitive as Parameters<ReactJsxFactory>[0], props, key);

const toButton = (
  props: ButtonProps,
  key: string | undefined,
): ReactNode => reactJsx(ButtonPrimitive as Parameters<ReactJsxFactory>[0], props, key);

const toTextarea = (
  props: TextareaProps,
  key: string | undefined,
): ReactNode => reactJsx(TextareaPrimitive as Parameters<ReactJsxFactory>[0], props, key);

const assertNever = (type: never): never => {
  throw new Error(
    `Unsupported Royal JSX element: ${String(type)}. Use renderer tags such as scene/pass/mesh or a React component exported by @royal/react.`
  );
};

const createIntrinsicRendererElement = (
  type: keyof JSX.IntrinsicElements,
  props: JsxProps | null
): RoyalRendererJsxElement => {
  const elementProps = props ?? {};

  switch (type) {
    case 'scene':
      return scene({
        children: toRenderPasses((elementProps as SceneProps).children)
      });
    case 'pass':
      return toPass(elementProps as PassProps);
    case 'perspectiveCamera':
      return perspectiveCamera(elementProps as PerspectiveCameraOptions);
    case 'orthographicCamera':
      return orthographicCamera(elementProps as OrthographicCameraOptions);
    case 'directionalLight':
      return directionalLight(elementProps as DirectionalLightOptions);
    case 'mesh':
      return toMesh(elementProps as MeshProps);
    case 'model':
      return toGltfNode(elementProps as ModelProps);
    case 'text':
      return toText(elementProps as TextProps);
    case 'input':
    case 'button':
    case 'textarea':
      throw new Error('form control primitives require the @royal/react Canvas runtime');
    case 'boxGeometry':
      return boxGeometry(elementProps as BoxGeometryOptions);
    case 'planeGeometry':
      return planeGeometry(elementProps as PlaneGeometryOptions);
    case 'standardMaterial':
      return standardMaterial(elementProps as StandardMaterialOptions);
    case 'unlitMaterial':
      return unlitMaterial(elementProps as UnlitMaterialOptions);
    case 'wireframeMaterial':
      return wireframeMaterial(elementProps as WireframeMaterialOptions);
    default:
      return assertNever(type);
  }
};

export const createRendererElement = (
  type: ElementType,
  props: JsxProps | null
): RoyalRendererJsxElement => {
  if (typeof type === 'function') {
    const factory = rendererDescriptorFactory(type);
    if (factory === undefined) {
      throw new Error('Royal renderer JSX components must be marked with markRendererComponent');
    }

    const output = factory(props ?? {});
    if (isRoyalRendererJsxElement(output)) return output;

    throw new Error('Royal renderer JSX components must return one renderer descriptor');
  }

  const output = createIntrinsicRendererElement(type, props);
  if (isRoyalRendererJsxElement(output)) return output;

  throw new Error('Royal renderer JSX components must return one renderer descriptor');
};

const createElement = (
  type: ElementType,
  props: JsxProps | null,
  key?: string
): ReactNode => {
  if (typeof type === 'function') {
    const factory = reactFactoryFor(props);
    return factory(type as Parameters<ReactJsxFactory>[0], props, key);
  }

  if (typeof type === 'string') {
    if (
      type === 'text' &&
      (
        (props as TextProps | null)?.selectable === true ||
        (props as TextProps | null)?.copyable === true ||
        (props as TextProps | null)?.box !== undefined
      )
    ) {
      return toInteractiveText(props as TextProps, key);
    }

    if (type === 'input') return toInput(props as InputProps, key);
    if (type === 'button') return toButton(props as ButtonProps, key);
    if (type === 'textarea') return toTextarea(props as TextareaProps, key);
  }

  const factory = reactFactoryFor(props);
  return factory(type as Parameters<ReactJsxFactory>[0], props, key);
};

export const RendererFragment = markRendererComponent((_props: {
  readonly children?: RendererJsxChild;
}): RoyalRendererJsxElement => _props.children as RoyalRendererJsxElement);

export const Fragment = ReactFragment;
export const jsx = createElement;
export const jsxs = createElement;

export namespace JSX {
  export type Element = ReactNode;

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
    model: ModelProps;
    button: ButtonProps;
    text: TextProps;
    input: InputProps;
    textarea: TextareaProps;
    boxGeometry: BoxGeometryOptions;
    planeGeometry: PlaneGeometryOptions;
    standardMaterial: StandardMaterialOptions;
    unlitMaterial: UnlitMaterialOptions;
    wireframeMaterial: WireframeMaterialOptions;
  }
}

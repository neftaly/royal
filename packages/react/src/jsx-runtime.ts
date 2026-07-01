import {
  directionalLight,
  gltf,
  imageTexture,
  mesh,
  orthographicCamera,
  pass,
  perspectiveCamera,
  scene,
  standardMaterial,
  text,
  type Camera,
  type DirectionalLightOptions,
  type Geometry,
  type GeometryKindValue,
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
  type TextOptions,
  type TextureRef
} from '@royal/renderer-core';
import type { ReactNode } from 'react';
import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';

type RendererJsxElement = RenderElement | Camera | Geometry<GeometryKindValue> | Material;
type ComponentOutput = ReactNode | RendererJsxElement;
type EmptyJsxChild = boolean | null | undefined;
type RendererJsxChild = ComponentOutput | EmptyJsxChild | readonly RendererJsxChild[];
type Component = (props: Record<string, unknown>) => ComponentOutput;
type ElementType = keyof JSX.IntrinsicElements | Component;
type JsxProps = Record<string, unknown>;
type ReactJsxFactory = typeof reactJsx;

type SceneProps = {
  readonly children?: RendererJsxChild;
};

type PassProps = Omit<RenderPassOptions, 'camera' | 'children'> & {
  readonly camera?: Camera;
  readonly children?: RendererJsxChild;
};
type MeshTextureInput = TextureRef | string;
type MeshProps = Omit<MeshOptions, 'geometry' | 'material'> & {
  readonly children?: RendererJsxChild;
  readonly color?: Rgba;
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
  readonly texture?: MeshTextureInput;
  readonly textureSrc?: string;
};
type TextProps = Omit<TextOptions, 'text'> & {
  readonly children?: RendererJsxChild;
  readonly text?: string;
};

const reactComponentMarker = Symbol.for('@royal/react.react-component');

export const markReactComponent = <Component extends object>(component: Component): Component => {
  Object.defineProperty(component, reactComponentMarker, {
    configurable: false,
    enumerable: false,
    value: true
  });

  return component;
};

const isMarkedReactComponent = (type: ElementType): boolean =>
  typeof type === 'function' &&
  (type as { readonly [reactComponentMarker]?: true })[reactComponentMarker] === true;

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
  !isCamera(element) &&
  !isRenderNode(element) &&
  !isMaterial(element);

const isRenderPass = (element: ComponentOutput): element is RenderPass =>
  typeof element === 'object' &&
  element !== null &&
  'kind' in element &&
  element.kind === 'pass' &&
  'camera' in element &&
  'children' in element;

const toRenderPasses = (children: RendererJsxChild): readonly RenderPass[] =>
  toStructuralArray(children).map((child) => {
    if (!isRenderPass(child)) {
      throw new Error(`scene children must be pass elements; received ${describeJsxChild(child)}`);
    }

    return child;
  });

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

    if (isRenderNode(child)) {
      children.push(child);
      continue;
    }

    throw new Error(`pass children must be one camera plus render nodes; received ${describeJsxChild(child)}`);
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
  if (props.material !== undefined) {
    return mesh(toMeshOptions(props, props.material));
  }

  if (props.texture !== undefined && props.textureSrc !== undefined) {
    throw new Error('mesh expects either texture or textureSrc, not both');
  }

  if (props.texture !== undefined || props.textureSrc !== undefined) {
    return mesh(toMeshOptions(props, standardMaterial({
      texture: props.textureSrc === undefined
        ? toMeshTexture(props.texture)
        : imageTexture(props.textureSrc)
    })));
  }

  if (props.color === undefined) {
    throw new Error('mesh expects material, color, or texture');
  }

  return mesh(toMeshOptions(props, standardMaterial({ color: props.color })));
};

const toMeshTexture = (texture: MeshTextureInput | undefined): TextureRef => {
  if (texture === undefined) {
    throw new Error('mesh texture was not provided');
  }

  return typeof texture === 'string' ? imageTexture(texture) : texture;
};

const toMeshGeometry = (props: MeshProps): Geometry<GeometryKindValue> => {
  const structuralChildren = toStructuralArray(props.children);
  const geometryChildren = structuralChildren.filter(isGeometry);

  if (geometryChildren.length !== structuralChildren.length) {
    const invalidChild = structuralChildren.find((child) => !isGeometry(child));
    throw new Error(`mesh children must be geometry descriptors; received ${describeJsxChild(invalidChild)}`);
  }

  if (geometryChildren.length > 1) {
    throw new Error('mesh expects at most one geometry child');
  }

  if (props.geometry !== undefined && geometryChildren.length > 0) {
    throw new Error('mesh expects geometry as a prop or child, not both');
  }

  const childGeometry = geometryChildren[0];
  if (props.geometry !== undefined) return props.geometry;
  if (childGeometry !== undefined) return childGeometry;

  throw new Error('mesh expects geometry as a prop or child');
};

const toMeshOptions = (props: MeshProps, material: Material): MeshOptions => {
  const options = {
    geometry: toMeshGeometry(props),
    material
  } satisfies Omit<MeshOptions, 'transform'>;

  return props.transform === undefined
    ? options
    : { ...options, transform: props.transform };
};

const toText = (props: TextProps): RenderNode => {
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

const assertNever = (type: never): never => {
  throw new Error(
    `Unsupported Royal JSX element: ${String(type)}. Use renderer tags such as scene/pass/mesh or a React component exported by @royal/react.`
  );
};

const createElement = (
  type: ElementType,
  props: JsxProps | null,
  key?: string
): ComponentOutput => {
  if (isMarkedReactComponent(type)) {
    const factory: ReactJsxFactory = props?.children === undefined ? reactJsx : reactJsxs;
    return factory(type as Parameters<ReactJsxFactory>[0], props, key);
  }

  const elementProps = props ?? {};

  if (typeof type === 'function') {
    return type(elementProps);
  }

  switch (type) {
    case 'scene':
      return scene({
        children: toRenderPasses((elementProps as SceneProps).children)
      });
    case 'pass':
      return toPass(elementProps as PassProps);
    case 'perspectiveCamera':
      return perspectiveCamera(elementProps as unknown as PerspectiveCameraOptions);
    case 'orthographicCamera':
      return orthographicCamera(elementProps as unknown as OrthographicCameraOptions);
    case 'directionalLight':
      return directionalLight(elementProps as unknown as DirectionalLightOptions);
    case 'mesh':
      return toMesh(elementProps as unknown as MeshProps);
    case 'gltf':
      return toGltf(elementProps as unknown as GltfOptions);
    case 'text':
      return toText(elementProps as unknown as TextProps);
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
    text: TextProps;
  }
}

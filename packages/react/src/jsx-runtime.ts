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
import type { ReactNode } from 'react';
import { jsx as reactJsx, jsxs as reactJsxs } from 'react/jsx-runtime';

export type RoyalRendererJsxElement = RenderElement | Camera | Geometry<GeometryKindValue> | Material;
type ComponentOutput = ReactNode | RoyalRendererJsxElement;
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
};
type TextProps = Omit<TextOptions, 'text'> & {
  readonly children?: RendererJsxChild;
  readonly text?: string;
};
type MeshChildren = {
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
};

const reactComponentMarker = Symbol.for('@royal/react.react-component');
const rendererComponentMarker = Symbol.for('@royal/react.renderer-component');

export const markReactComponent = <Component extends object>(component: Component): Component => {
  Object.defineProperty(component, reactComponentMarker, {
    configurable: false,
    enumerable: false,
    value: true
  });

  return component;
};

export const markRendererComponent = <Component extends object>(component: Component): Component => {
  Object.defineProperty(component, rendererComponentMarker, {
    configurable: false,
    enumerable: false,
    value: true
  });

  return component;
};

const isMarkedRendererComponent = (type: ElementType): boolean =>
  typeof type === 'function' &&
  (type as { readonly [rendererComponentMarker]?: true })[rendererComponentMarker] === true;

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

const toMesh = (props: MeshProps): RenderNode => {
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

const toGltfNode = (options: GltfOptions): RenderNode => gltf(options);

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
  const elementProps = props ?? {};

  if (typeof type === 'function') {
    if (!isMarkedRendererComponent(type)) {
      const factory: ReactJsxFactory = props?.children === undefined ? reactJsx : reactJsxs;
      return factory(type as Parameters<ReactJsxFactory>[0], props, key);
    }

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
      return toGltfNode(elementProps as unknown as GltfOptions);
    case 'text':
      return toText(elementProps as unknown as TextProps);
    case 'boxGeometry':
      return boxGeometry(elementProps as unknown as BoxGeometryOptions);
    case 'planeGeometry':
      return planeGeometry(elementProps as unknown as PlaneGeometryOptions);
    case 'standardMaterial':
      return standardMaterial(elementProps as unknown as StandardMaterialOptions);
    case 'unlitMaterial':
      return unlitMaterial(elementProps as unknown as UnlitMaterialOptions);
    case 'wireframeMaterial':
      return wireframeMaterial(elementProps as unknown as WireframeMaterialOptions);
    default:
      return assertNever(type);
  }
};

export const Fragment = markRendererComponent((_props: {
  readonly children?: RendererJsxChild;
}): RendererJsxChild => _props.children);

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
    gltf: GltfOptions;
    text: TextProps;
    boxGeometry: BoxGeometryOptions;
    planeGeometry: PlaneGeometryOptions;
    standardMaterial: StandardMaterialOptions;
    unlitMaterial: UnlitMaterialOptions;
    wireframeMaterial: WireframeMaterialOptions;
  }
}

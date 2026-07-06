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
  type PerspectiveCameraOptions,
  type PlaneGeometryOptions,
  type RenderElement,
  type RenderNode,
  type RenderPass,
  type RenderPassOptions,
  type RenderRoot,
  type Rgba,
  type StandardMaterialOptions,
  type TextOptions,
  type TextureRef,
  type UnlitMaterialOptions,
  type WireframeMaterialOptions,
} from '@royal/renderer-core';
import { isValidElement, type ReactNode } from 'react';
import {
  rendererOutputToSingleDescriptor,
  type RendererComponentOutput,
} from './renderer-output';
import type { RoyalPointerEventProps } from './picking-events';

export type RoyalRendererJsxElement = RenderElement | Camera | Geometry<GeometryKindValue> | Material;
export type RoyalRendererJsxChild = ReactNode | RoyalRendererJsxElement | readonly RoyalRendererJsxChild[];
type ComponentOutput = ReactNode | RoyalRendererJsxElement;
type RendererJsxChild = RoyalRendererJsxChild;
type Component = (props: never) => RendererComponentOutput;
type MeshTextureInput = TextureRef | string;
type MeshChildren = {
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
};

export type SceneProps = {
  readonly children?: RendererJsxChild;
};

export type PassProps = Omit<RenderPassOptions, 'camera' | 'children'> & {
  readonly camera?: Camera;
  readonly children?: RendererJsxChild;
};

export type MeshProps = Omit<MeshOptions, 'geometry' | 'material'> & {
  readonly children?: RendererJsxChild;
  readonly color?: Rgba;
  readonly geometry?: Geometry<GeometryKindValue>;
  readonly material?: Material;
  readonly texture?: MeshTextureInput;
} & RoyalPointerEventProps;

export type RendererTextProps = Omit<TextOptions, 'text'> & {
  readonly children?: RendererJsxChild;
  readonly text?: string;
};

export type GltfProps = GltfOptions & RoyalPointerEventProps;

export type RoyalRendererIntrinsicElementProps = {
  scene: SceneProps;
  pass: PassProps;
  perspectiveCamera: PerspectiveCameraOptions;
  orthographicCamera: OrthographicCameraOptions;
  directionalLight: DirectionalLightOptions;
  mesh: MeshProps;
  gltf: GltfProps;
  text: RendererTextProps;
  boxGeometry: BoxGeometryOptions;
  planeGeometry: PlaneGeometryOptions;
  standardMaterial: StandardMaterialOptions;
  unlitMaterial: UnlitMaterialOptions;
  wireframeMaterial: WireframeMaterialOptions;
};

export type RoyalIntrinsicElementType = keyof RoyalRendererIntrinsicElementProps;
export type RendererElementType = RoyalIntrinsicElementType | Component;
export type RendererDescriptorHostChild = RoyalRendererJsxElement | string;

type JsxProps = Partial<
  SceneProps &
  PassProps &
  MeshProps &
  RendererTextProps &
  GltfProps &
  PerspectiveCameraOptions &
  OrthographicCameraOptions &
  DirectionalLightOptions &
  BoxGeometryOptions &
  PlaneGeometryOptions &
  WireframeMaterialOptions
> & Record<string, unknown>;

const descriptorKind = (value: unknown): string | undefined =>
  typeof value === 'object' && value !== null && 'kind' in value
    ? String(value.kind)
    : undefined;

export const isRoyalRendererJsxElement = (value: unknown): value is RoyalRendererJsxElement =>
  descriptorKind(value) !== undefined;

export const isRenderRootDescriptor = (value: unknown): value is RenderRoot =>
  descriptorKind(value) === 'scene';

const isRendererJsxChildArray = (
  value: RendererJsxChild,
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

export const isIgnorableRendererTextChild = (
  textValue: string,
  parentType?: string,
): boolean => parentType !== 'text' && textValue.trim() === '';

const toStructuralArray = (value: RendererJsxChild): readonly ComponentOutput[] =>
  toArray(value).filter((child) => !(
    typeof child === 'string' &&
    isIgnorableRendererTextChild(child)
  ));

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

const isCamera = (element: ComponentOutput): element is Camera => {
  const kind = descriptorKind(element);
  return kind === 'perspective-camera' || kind === 'orthographic-camera';
};

const describeJsxChild = (child: ComponentOutput | undefined): string => {
  if (child === undefined) return 'nothing';

  const kind = descriptorKind(child);
  if (kind !== undefined) {
    return `kind "${kind}"`;
  }

  if (typeof child === 'object' && child !== null && '$$typeof' in child) {
    return 'React element';
  }

  return typeof child;
};

const isRenderNode = (element: ComponentOutput): element is RenderNode => {
  const kind = descriptorKind(element);
  return kind === 'mesh' || kind === 'gltf' || kind === 'directional-light' || kind === 'text';
};

const isMaterial = (element: ComponentOutput): element is Material => {
  const kind = descriptorKind(element);
  return kind === 'standard' || kind === 'unlit' || kind === 'wireframe';
};

const isGeometry = (element: ComponentOutput): element is Geometry<GeometryKindValue> => {
  const kind = descriptorKind(element);
  return kind === 'box' || kind === 'plane';
};

const isRenderPass = (element: ComponentOutput): element is RenderPass =>
  descriptorKind(element) === 'pass' &&
  typeof element === 'object' &&
  element !== null &&
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
  errorPrefix: string,
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

  return pass({
    camera,
    children,
    ...(props.clear === undefined ? {} : { clear: props.clear }),
    ...(props.clearColor === undefined ? {} : { clearColor: props.clearColor }),
    ...(props.depthTest === undefined ? {} : { depthTest: props.depthTest }),
    ...(props.environment === undefined ? {} : { environment: props.environment }),
    ...(props.exposure === undefined ? {} : { exposure: props.exposure }),
    ...(props.toneMapping === undefined ? {} : { toneMapping: props.toneMapping }),
  });
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
      texture: toMeshTexture(props.texture),
    }), children.geometry));
  }

  if (props.color === undefined) {
    throw new Error('mesh expects material, color, or texture');
  }

  return mesh(toMeshOptions(props, standardMaterial({ color: props.color }), children.geometry));
};

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
  childGeometry: Geometry<GeometryKindValue> | undefined,
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
  childGeometry: Geometry<GeometryKindValue> | undefined,
): MeshOptions => {
  const options = {
    geometry: toMeshGeometry(props, childGeometry),
    material,
    ...(props.pickingId === undefined ? {} : { pickingId: props.pickingId }),
    ...(props.ref === undefined ? {} : { ref: props.ref }),
    ...(props.semantics === undefined ? {} : { semantics: props.semantics }),
  } satisfies Omit<MeshOptions, 'transform'>;

  return props.transform === undefined
    ? options
    : { ...options, transform: props.transform };
};

const toText = (props: RendererTextProps): RenderNode => {
  if ('box' in props && props.box !== undefined) {
    throw new Error('text box props require the @royal/react Canvas runtime');
  }

  const textValue = typeof props.text === 'string'
    ? props.text
    : toTextContent(props.children);

  return text({
    color: props.color,
    font: props.font,
    ...(props.fontSize === undefined ? {} : { fontSize: props.fontSize }),
    ...(props.lineHeight === undefined ? {} : { lineHeight: props.lineHeight }),
    ...(props.origin === undefined ? {} : { origin: props.origin }),
    ...(props.semantics === undefined ? {} : { semantics: props.semantics }),
    text: textValue,
  });
};

const assertNever = (type: never): never => {
  throw new Error(
    `Unsupported Royal JSX element: ${String(type)}. Use renderer tags such as scene/pass/mesh or a React component exported by @royal/react.`
  );
};

const createIntrinsicRendererElement = (
  type: RoyalIntrinsicElementType,
  props: JsxProps | null,
): RoyalRendererJsxElement => {
  const elementProps = props ?? {};

  switch (type) {
    case 'scene':
      return scene({
        children: toRenderPasses((elementProps as SceneProps).children),
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
    case 'gltf':
      return gltf(elementProps as GltfProps);
    case 'text':
      return toText(elementProps as RendererTextProps);
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
  type: RendererElementType,
  props: JsxProps | null,
): RoyalRendererJsxElement => {
  if (typeof type === 'function') {
    const output = rendererOutputToSingleDescriptor(type((props ?? {}) as never) as RendererComponentOutput);
    if (isRoyalRendererJsxElement(output)) return output;

    throw new Error('Royal renderer JSX components must return one renderer descriptor');
  }

  return createIntrinsicRendererElement(type, props);
};

export const createRendererHostDescriptor = (
  type: RoyalIntrinsicElementType,
  props: Record<string, unknown>,
  children: readonly RendererDescriptorHostChild[],
  renderObjectRef: unknown,
): RoyalRendererJsxElement => {
  const descriptorProps = { ...props };
  delete descriptorProps.children;
  delete descriptorProps.ref;

  return createIntrinsicRendererElement(type, {
    ...descriptorProps,
    ...(children.length === 1 ? { children: children[0] } : {}),
    ...(children.length > 1 ? { children } : {}),
    ...(renderObjectRef === null || renderObjectRef === undefined ? {} : { ref: renderObjectRef }),
  } as JsxProps);
};

import {
  ALIGN_CENTER,
  ALIGN_FLEX_END,
  ALIGN_FLEX_START,
  ALIGN_STRETCH,
  DIRECTION_LTR,
  DIRECTION_RTL,
  EDGE_ALL,
  EDGE_BOTTOM,
  EDGE_HORIZONTAL,
  EDGE_LEFT,
  EDGE_RIGHT,
  EDGE_TOP,
  EDGE_VERTICAL,
  FLEX_DIRECTION_COLUMN,
  FLEX_DIRECTION_ROW,
  GUTTER_ALL,
  Node,
} from 'flexily';

export type FlexLayoutAlignItems = 'center' | 'flex-end' | 'flex-start' | 'stretch';
export type FlexLayoutDirection = 'column' | 'row';
export type FlexLayoutTextDirection = 'ltr' | 'rtl';

export type FlexLayoutEdges = number | {
  readonly all?: number;
  readonly bottom?: number;
  readonly horizontal?: number;
  readonly left?: number;
  readonly right?: number;
  readonly top?: number;
  readonly vertical?: number;
};

export type FlexLayoutBox = {
  readonly bottom: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly width: number;
};

type FlexLayoutNode<Key extends string = string> = {
  readonly alignItems?: FlexLayoutAlignItems;
  readonly children?: readonly FlexLayoutNode<Key>[];
  readonly direction?: FlexLayoutDirection;
  readonly gap?: number;
  readonly height?: number;
  readonly id?: Key;
  readonly itemWidth?: number;
  readonly margin?: FlexLayoutEdges;
  readonly padding?: FlexLayoutEdges;
  readonly width?: number;
};

export type FlexLayoutElement<Key extends string = string> = FlexLayoutNode<Key>;

export type FlexLayoutSize = {
  readonly height: number;
  readonly width: number;
};

export type FlexLayoutContainerProps<Key extends string = string> = {
  readonly alignItems?: FlexLayoutAlignItems;
  readonly direction?: FlexLayoutDirection;
  readonly flexDirection?: FlexLayoutDirection;
  readonly gap?: number;
  readonly height?: number;
  readonly id?: Key;
  readonly itemWidth?: number;
  readonly margin?: FlexLayoutEdges;
  readonly padding?: FlexLayoutEdges;
  readonly size?: FlexLayoutSize;
  readonly width?: number;
};

export type FlexLayoutDirectedContainerProps<Key extends string = string> =
  Omit<FlexLayoutContainerProps<Key>, 'direction' | 'flexDirection'>;

export type FlexLayoutBoxProps = {
  readonly height?: number;
  readonly margin?: FlexLayoutEdges;
  readonly size?: FlexLayoutSize;
  readonly width?: number;
};

type FlexLayoutRootSize =
  | {
    readonly height: number;
    readonly size?: never;
    readonly width: number;
  }
  | {
    readonly height?: never;
    readonly size: FlexLayoutSize;
    readonly width?: never;
  };

type FlexLayoutRoot<Key extends string = string> =
  & FlexLayoutElement<Key>
  & {
    readonly height: number;
    readonly textDirection?: FlexLayoutTextDirection;
    readonly unitScale?: number;
    readonly width: number;
  };

export type FlexLayoutRootProps<Key extends string = string> =
  & Omit<FlexLayoutContainerProps<Key>, 'height' | 'size' | 'width'>
  & FlexLayoutRootSize
  & {
    readonly textDirection?: FlexLayoutTextDirection;
    readonly unitScale?: number;
  };

const defaultUnitScale = 1000;

const flexDirection = (direction: FlexLayoutDirection): number =>
  direction === 'row' ? FLEX_DIRECTION_ROW : FLEX_DIRECTION_COLUMN;

const alignItems = (align: FlexLayoutAlignItems): number => {
  switch (align) {
    case 'center':
      return ALIGN_CENTER;
    case 'flex-end':
      return ALIGN_FLEX_END;
    case 'stretch':
      return ALIGN_STRETCH;
    case 'flex-start':
      return ALIGN_FLEX_START;
  }
};

const textDirection = (direction: FlexLayoutTextDirection): number =>
  direction === 'rtl' ? DIRECTION_RTL : DIRECTION_LTR;

const isFiniteNumber = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value);

const applyEdges = (
  value: FlexLayoutEdges | undefined,
  set: (edge: number, amount: number) => void,
  unitScale: number,
): void => {
  if (value === undefined) return;

  if (typeof value === 'number') {
    set(EDGE_ALL, value * unitScale);
    return;
  }

  if (isFiniteNumber(value.all)) set(EDGE_ALL, value.all * unitScale);
  if (isFiniteNumber(value.horizontal)) set(EDGE_HORIZONTAL, value.horizontal * unitScale);
  if (isFiniteNumber(value.vertical)) set(EDGE_VERTICAL, value.vertical * unitScale);
  if (isFiniteNumber(value.left)) set(EDGE_LEFT, value.left * unitScale);
  if (isFiniteNumber(value.top)) set(EDGE_TOP, value.top * unitScale);
  if (isFiniteNumber(value.right)) set(EDGE_RIGHT, value.right * unitScale);
  if (isFiniteNumber(value.bottom)) set(EDGE_BOTTOM, value.bottom * unitScale);
};

const applyLayoutNode = (node: Node, input: FlexLayoutNode, unitScale: number): void => {
  if (isFiniteNumber(input.width)) node.setWidth(input.width * unitScale);
  if (isFiniteNumber(input.height)) node.setHeight(input.height * unitScale);
  if (input.direction !== undefined) node.setFlexDirection(flexDirection(input.direction));
  if (input.alignItems !== undefined) node.setAlignItems(alignItems(input.alignItems));
  if (isFiniteNumber(input.gap)) node.setGap(GUTTER_ALL, input.gap * unitScale);
  applyEdges(input.padding, (edge, amount) => node.setPadding(edge, amount), unitScale);
  applyEdges(input.margin, (edge, amount) => node.setMargin(edge, amount), unitScale);
};

const sizeProps = (
  size: FlexLayoutSize | undefined,
): Pick<FlexLayoutNode, 'height' | 'width'> =>
  size === undefined
    ? {}
    : {
      height: size.height,
      width: size.width,
    };

const createContainer = <Key extends string>(
  props: FlexLayoutContainerProps<Key> & {
    readonly textDirection?: FlexLayoutTextDirection;
    readonly unitScale?: number;
  },
  defaultDirection: FlexLayoutDirection,
  children: readonly FlexLayoutElement<Key>[],
): FlexLayoutElement<Key> & {
  readonly textDirection?: FlexLayoutTextDirection;
  readonly unitScale?: number;
} => {
  const {
    direction,
    flexDirection,
    size,
    ...node
  } = props;

  return {
    ...node,
    ...sizeProps(size),
    children,
    direction: flexDirection ?? direction ?? defaultDirection,
  };
};

export function Container<Key extends string>(
  props: FlexLayoutRootProps<Key>,
  ...children: readonly FlexLayoutElement<Key>[]
): FlexLayoutRoot<Key>;
export function Container<Key extends string>(
  props: FlexLayoutContainerProps<Key>,
  ...children: readonly FlexLayoutElement<Key>[]
): FlexLayoutElement<Key>;
export function Container<Key extends string>(
  props: FlexLayoutContainerProps<Key> | FlexLayoutRootProps<Key>,
  ...children: readonly FlexLayoutElement<Key>[]
): FlexLayoutElement<Key> | FlexLayoutRoot<Key> {
  return createContainer(props, 'column', children);
}

export const Column = <Key extends string>(
  props: FlexLayoutDirectedContainerProps<Key>,
  ...children: readonly FlexLayoutElement<Key>[]
): FlexLayoutElement<Key> => createContainer({ ...props, flexDirection: 'column' }, 'column', children);

export const Row = <Key extends string>(
  props: FlexLayoutDirectedContainerProps<Key>,
  ...children: readonly FlexLayoutElement<Key>[]
): FlexLayoutElement<Key> => createContainer({ ...props, flexDirection: 'row' }, 'row', children);

export const Box = <Key extends string>(
  id: Key,
  props: FlexLayoutBoxProps = {},
): FlexLayoutElement<Key> => {
  const { size, ...node } = props;

  return {
    ...node,
    ...sizeProps(size),
    id,
  };
};

const createLayoutNode = <Key extends string>(
  input: FlexLayoutNode<Key>,
  unitScale: number,
): Node => {
  const node = Node.create({ defaults: 'css' });
  applyLayoutNode(node, input, unitScale);

  for (const [index, child] of (input.children ?? []).entries()) {
    node.insertChild(createLayoutNode({
      ...(input.itemWidth === undefined || child.width !== undefined ? {} : { width: input.itemWidth }),
      ...child,
    }, unitScale), index);
  }

  return node;
};

const collectBoxes = <Key extends string>(
  input: FlexLayoutNode<Key>,
  node: Node,
  boxes: Partial<Record<Key, FlexLayoutBox>>,
  unitScale: number,
  offsetLeft = 0,
  offsetTop = 0,
): void => {
  const left = offsetLeft + node.getComputedLeft() / unitScale;
  const top = offsetTop + node.getComputedTop() / unitScale;
  const width = node.getComputedWidth() / unitScale;
  const height = node.getComputedHeight() / unitScale;

  if (input.id !== undefined) {
    boxes[input.id] = {
      bottom: top + height,
      height,
      left,
      right: left + width,
      top,
      width,
    };
  }

  for (const [index, child] of (input.children ?? []).entries()) {
    const childNode = node.getChild(index);
    if (childNode !== undefined) collectBoxes(child, childNode, boxes, unitScale, left, top);
  }
};

export const layoutFlex = <Key extends string>(
  input: FlexLayoutRoot<Key>,
): Record<Key, FlexLayoutBox> => {
  const unitScale = input.unitScale ?? defaultUnitScale;
  const boxes: Partial<Record<Key, FlexLayoutBox>> = {};
  const root = createLayoutNode(input, unitScale);

  try {
    root.calculateLayout(input.width * unitScale, input.height * unitScale, textDirection(input.textDirection ?? 'ltr'));
    collectBoxes(input, root, boxes, unitScale);
    return boxes as Record<Key, FlexLayoutBox>;
  } finally {
    root.freeRecursive();
  }
};

export const flexStyle = <Style extends object = Record<never, never>>(
  box: FlexLayoutBox,
  style?: Style,
): {
  readonly height: number;
  readonly left: number;
  readonly top: number;
  readonly width: number;
} & Style => ({
  height: box.height,
  left: box.left,
  top: box.top,
  width: box.width,
  ...(style ?? ({} as Style)),
});

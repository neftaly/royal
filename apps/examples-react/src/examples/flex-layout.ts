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

export type FlexLayoutNode<Key extends string = string> = {
  readonly alignItems?: FlexLayoutAlignItems;
  readonly children?: readonly FlexLayoutNode<Key>[];
  readonly direction?: FlexLayoutDirection;
  readonly gap?: number;
  readonly height?: number;
  readonly id?: Key;
  readonly margin?: FlexLayoutEdges;
  readonly padding?: FlexLayoutEdges;
  readonly width?: number;
};

export type FlexLayoutRoot<Key extends string = string> =
  & FlexLayoutNode<Key>
  & {
    readonly height: number;
    readonly textDirection?: FlexLayoutTextDirection;
    readonly unitScale?: number;
    readonly width: number;
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

const createLayoutNode = <Key extends string>(
  input: FlexLayoutNode<Key>,
  unitScale: number,
): Node => {
  const node = Node.create({ defaults: 'css' });
  applyLayoutNode(node, input, unitScale);

  for (const [index, child] of (input.children ?? []).entries()) {
    node.insertChild(createLayoutNode(child, unitScale), index);
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

export const layoutFlexTree = <Key extends string>(
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

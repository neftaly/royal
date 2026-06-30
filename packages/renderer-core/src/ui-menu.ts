export type UiMenuCommandId = string;
export type UiMenuCommandAction = string;

export interface UiMenuCommand {
  readonly action?: UiMenuCommandAction;
  readonly enabled: boolean;
  readonly id: UiMenuCommandId;
  readonly label: string;
  readonly visible: boolean;
}

export interface UiMenuCommandOptions {
  readonly action?: UiMenuCommandAction;
  /** @defaultValue `true` */
  readonly enabled?: boolean;
  readonly id: UiMenuCommandId;
  readonly label: string;
  /** @defaultValue `true` */
  readonly visible?: boolean;
}

export interface UiMenuPoint {
  readonly x: number;
  readonly y: number;
}

export type UiMenuAnchor = UiMenuPoint;
export type UiMenuPosition = UiMenuPoint;

export interface UiMenuBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export type UiMenuViewport = UiMenuBounds;

export interface UiMenuLayoutMetrics {
  readonly commandGap: number;
  readonly commandHeight: number;
  readonly paddingX: number;
  readonly paddingY: number;
  readonly width: number;
}

export interface UiMenuLayoutOptions {
  readonly anchor: UiMenuAnchor;
  readonly bounds: UiMenuBounds;
  readonly commands: readonly UiMenuCommandOptions[];
  readonly metrics: UiMenuLayoutMetrics;
}

export interface UiMenuCommandRect {
  readonly action?: UiMenuCommandAction;
  readonly bounds: UiMenuBounds;
  readonly enabled: boolean;
  readonly id: UiMenuCommandId;
  readonly label: string;
  readonly visible: boolean;
}

export interface UiMenuLayout {
  readonly anchor: UiMenuAnchor;
  readonly bounds: UiMenuBounds;
  readonly commands: readonly UiMenuCommandRect[];
  readonly position: UiMenuPosition;
}

export const uiMenuCommand = (options: UiMenuCommandOptions): UiMenuCommand => {
  const label = options.label.trim();
  if (label.length === 0) {
    throw new Error('UI menu command label must be a non-empty string');
  }

  const command: UiMenuCommand = {
    enabled: options.enabled ?? true,
    id: uiMenuCommandId(options.id),
    label,
    visible: options.visible ?? true,
    ...(options.action !== undefined ? { action: uiMenuCommandAction(options.action) } : {})
  };

  return Object.freeze(command);
};

export const layoutUiMenuCommands = ({
  anchor,
  bounds,
  commands,
  metrics
}: UiMenuLayoutOptions): UiMenuLayout => {
  const normalizedAnchor = normalizePoint(anchor, 'UI menu anchor');
  const normalizedBounds = normalizeBounds(bounds, 'UI menu bounds');
  const normalizedMetrics = normalizeMetrics(metrics);
  const normalizedCommands = commands.map(uiMenuCommand);
  const visibleCommands = normalizedCommands.filter((command) => command.visible);
  const menuHeight = menuContentHeight(visibleCommands.length, normalizedMetrics);
  const menuWidth = normalizedMetrics.width;
  const position = Object.freeze({
    x: clamp(normalizedAnchor.x, normalizedBounds.x, normalizedBounds.x + normalizedBounds.width - menuWidth),
    y: clamp(normalizedAnchor.y, normalizedBounds.y, normalizedBounds.y + normalizedBounds.height - menuHeight)
  });
  const menuBounds = Object.freeze({
    height: menuHeight,
    width: menuWidth,
    x: position.x,
    y: position.y
  });
  const commandRects = visibleCommands.map((command, index): UiMenuCommandRect => Object.freeze({
    ...command,
    bounds: Object.freeze({
      height: normalizedMetrics.commandHeight,
      width: normalizedMetrics.width - (normalizedMetrics.paddingX * 2),
      x: position.x + normalizedMetrics.paddingX,
      y: position.y + normalizedMetrics.paddingY + (index * (normalizedMetrics.commandHeight + normalizedMetrics.commandGap))
    })
  }));

  return Object.freeze({
    anchor: normalizedAnchor,
    bounds: menuBounds,
    commands: Object.freeze(commandRects),
    position
  });
};

export const uiMenuCommandAt = (
  commands: readonly UiMenuCommandRect[],
  point: UiMenuPoint
): UiMenuCommandRect | undefined => {
  const normalizedPoint = normalizePoint(point, 'UI menu hit point');
  return commands.find((command) => command.enabled && command.visible && containsPoint(command.bounds, normalizedPoint));
};

const uiMenuCommandId = (id: UiMenuCommandId): UiMenuCommandId => {
  if (id.trim().length === 0) {
    throw new Error('UI menu command id must be a non-empty string');
  }

  return id;
};

const uiMenuCommandAction = (action: UiMenuCommandAction): UiMenuCommandAction => {
  if (action.trim().length === 0) {
    throw new Error('UI menu command action must be a non-empty string');
  }

  return action;
};

const normalizePoint = (point: UiMenuPoint, label: string): UiMenuPoint => Object.freeze({
  x: finiteNumber(point.x, `${label} x`),
  y: finiteNumber(point.y, `${label} y`)
});

const normalizeBounds = (bounds: UiMenuBounds, label: string): UiMenuBounds => Object.freeze({
  height: finitePositiveNumber(bounds.height, `${label} height`),
  width: finitePositiveNumber(bounds.width, `${label} width`),
  x: finiteNumber(bounds.x, `${label} x`),
  y: finiteNumber(bounds.y, `${label} y`)
});

const normalizeMetrics = (metrics: UiMenuLayoutMetrics): UiMenuLayoutMetrics => Object.freeze({
  commandGap: finiteNonNegativeNumber(metrics.commandGap, 'UI menu command gap'),
  commandHeight: finitePositiveNumber(metrics.commandHeight, 'UI menu command height'),
  paddingX: finiteNonNegativeNumber(metrics.paddingX, 'UI menu padding x'),
  paddingY: finiteNonNegativeNumber(metrics.paddingY, 'UI menu padding y'),
  width: menuWidth(metrics.width, metrics.paddingX)
});

const menuContentHeight = (commandCount: number, metrics: UiMenuLayoutMetrics): number => {
  if (commandCount === 0) return metrics.paddingY * 2;
  return (metrics.paddingY * 2) +
    (commandCount * metrics.commandHeight) +
    ((commandCount - 1) * metrics.commandGap);
};

const containsPoint = (bounds: UiMenuBounds, point: UiMenuPoint): boolean => {
  return point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
};

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
};

const finitePositiveNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }

  return value;
};

const finiteNonNegativeNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }

  return value;
};

const finiteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
};

const menuWidth = (width: number, paddingX: number): number => {
  const normalizedWidth = finitePositiveNumber(width, 'UI menu width');
  const normalizedPaddingX = finiteNonNegativeNumber(paddingX, 'UI menu padding x');
  if (normalizedWidth <= normalizedPaddingX * 2) {
    throw new Error('UI menu width must be greater than horizontal padding');
  }

  return normalizedWidth;
};

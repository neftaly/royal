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
  const action = normalizeOptionalUiMenuCommandAction(options.action);
  const id = uiMenuCommandId(options.id);
  const label = uiMenuCommandLabel(options.label, id, action);

  const command: UiMenuCommand = {
    enabled: options.enabled ?? true,
    id,
    label,
    visible: options.visible ?? true,
    ...(action !== undefined ? { action } : {})
  };

  return Object.freeze(command);
};

export const layoutUiMenuCommands = ({
  anchor,
  bounds,
  commands,
  metrics
}: UiMenuLayoutOptions): UiMenuLayout => {
  const normalizedAnchor = normalizePoint(anchor);
  const normalizedMetrics = normalizeMetrics(metrics);
  const normalizedCommands = commands.map(uiMenuCommand);
  const normalizedBounds = normalizeLayoutBounds(bounds);
  if (normalizedBounds === undefined || !isFinitePoint(anchor)) return inertMenuLayout(normalizedAnchor);

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
  const normalizedPoint = normalizeHitPoint(point);
  if (normalizedPoint === undefined) return undefined;

  return commands.find((command) => command.enabled && command.visible && containsPoint(command.bounds, normalizedPoint));
};

const uiMenuCommandId = (id: UiMenuCommandId): UiMenuCommandId => {
  const normalized = id.trim();
  if (normalized.length === 0) {
    throw new Error('UI menu command id must be a non-empty string');
  }

  return normalized;
};

const uiMenuCommandLabel = (
  label: string,
  id: UiMenuCommandId,
  action: UiMenuCommandAction | undefined
): string => {
  const normalized = optionalNonBlankText(label) ?? optionalNonBlankText(id) ?? action;
  if (normalized === undefined) {
    throw new Error('UI menu command label must be a non-empty string');
  }

  return normalized;
};

const normalizeOptionalUiMenuCommandAction = (
  action: UiMenuCommandAction | undefined
): UiMenuCommandAction | undefined => optionalNonBlankText(action);

const optionalNonBlankText = (text: string | undefined): string | undefined => {
  const normalized = text?.trim();
  return normalized === '' ? undefined : normalized;
};

const normalizePoint = (point: UiMenuPoint): UiMenuPoint => Object.freeze({
  x: finiteNumberOrDefault(point.x, 0),
  y: finiteNumberOrDefault(point.y, 0)
});

const normalizeHitPoint = (point: UiMenuPoint): UiMenuPoint | undefined => {
  if (!isFinitePoint(point)) return undefined;
  return Object.freeze({ x: point.x, y: point.y });
};

const normalizeLayoutBounds = (bounds: UiMenuBounds): UiMenuBounds | undefined => {
  if (!isFinitePositiveNumber(bounds.height) ||
    !isFinitePositiveNumber(bounds.width) ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y)) {
    return undefined;
  }

  return Object.freeze({
    height: bounds.height,
    width: bounds.width,
    x: bounds.x,
    y: bounds.y
  });
};

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
  const normalizedBounds = normalizeHitBounds(bounds);
  return normalizedBounds !== undefined &&
    point.x >= normalizedBounds.x &&
    point.x < normalizedBounds.x + normalizedBounds.width &&
    point.y >= normalizedBounds.y &&
    point.y < normalizedBounds.y + normalizedBounds.height;
};

const normalizeHitBounds = (bounds: UiMenuBounds): UiMenuBounds | undefined => {
  if (!isFinitePositiveNumber(bounds.height) ||
    !isFinitePositiveNumber(bounds.width) ||
    !Number.isFinite(bounds.x) ||
    !Number.isFinite(bounds.y)) {
    return undefined;
  }

  return bounds;
};

const isFinitePoint = (point: UiMenuPoint): boolean => Number.isFinite(point.x) && Number.isFinite(point.y);

const inertMenuLayout = (anchor: UiMenuAnchor): UiMenuLayout => {
  const position = Object.freeze({
    x: anchor.x,
    y: anchor.y
  });

  return Object.freeze({
    anchor,
    bounds: Object.freeze({
      height: 0,
      width: 0,
      x: position.x,
      y: position.y
    }),
    commands: Object.freeze([]),
    position
  });
};

const clamp = (value: number, min: number, max: number): number => {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
};

const finitePositiveNumber = (value: number, label: string): number => {
  if (!isFinitePositiveNumber(value)) {
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

const finiteNumberOrDefault = (value: number, fallback: number): number => {
  return Number.isFinite(value) ? value : fallback;
};

const isFinitePositiveNumber = (value: number): boolean => Number.isFinite(value) && value > 0;

const menuWidth = (width: number, paddingX: number): number => {
  const normalizedWidth = finitePositiveNumber(width, 'UI menu width');
  const normalizedPaddingX = finiteNonNegativeNumber(paddingX, 'UI menu padding x');
  if (normalizedWidth <= normalizedPaddingX * 2) {
    throw new Error('UI menu width must be greater than horizontal padding');
  }

  return normalizedWidth;
};

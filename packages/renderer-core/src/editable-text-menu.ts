import {
  layoutUiMenuCommands,
  uiMenuCommand,
  uiMenuCommandAt,
  type UiMenuAnchor,
  type UiMenuBounds,
  type UiMenuCommand,
  type UiMenuCommandOptions,
  type UiMenuCommandRect,
  type UiMenuLayout,
  type UiMenuLayoutMetrics,
  type UiMenuPoint,
} from './ui-menu';

export type EditableTextMenuAction = 'copy' | 'cut' | 'paste';

export type EditableTextMenuCommand<Action extends string = EditableTextMenuAction> =
  Omit<UiMenuCommand, 'action' | 'id'> & {
    readonly action: Action;
    readonly id: Action;
  };

export type EditableTextMenuCommandRect<Action extends string = EditableTextMenuAction> =
  Omit<UiMenuCommandRect, 'action' | 'id'> & {
    readonly action: Action;
    readonly id: Action;
  };

export type EditableTextMenuLayout<Action extends string = EditableTextMenuAction> =
  Omit<UiMenuLayout, 'commands'> & {
    readonly commands: readonly EditableTextMenuCommandRect<Action>[];
  };

export interface EditableTextMenuCommandOptions<Action extends string = EditableTextMenuAction> {
  readonly action: Action;
  readonly enabled?: boolean;
  readonly label: string;
  readonly visible?: boolean;
}

export interface EditableTextClipboardMenuEnabled {
  readonly copy: boolean;
  readonly cut: boolean;
  readonly paste: boolean;
}

export interface EditableTextMenuLayoutOptions<Action extends string = EditableTextMenuAction> {
  readonly anchor: UiMenuAnchor;
  readonly bounds: UiMenuBounds;
  readonly commands: readonly EditableTextMenuCommandOptions<Action>[];
  readonly metrics: UiMenuLayoutMetrics;
  readonly open?: boolean;
}

const toUiMenuCommandOptions = <Action extends string>({
  action,
  enabled,
  label,
  visible,
}: EditableTextMenuCommandOptions<Action>): UiMenuCommandOptions => {
  const options: UiMenuCommandOptions = {
    action,
    id: action,
    label,
  };

  return {
    ...options,
    ...(enabled === undefined ? {} : { enabled }),
    ...(visible === undefined ? {} : { visible }),
  };
};

export const editableTextMenuCommand = <Action extends string>(
  options: EditableTextMenuCommandOptions<Action>,
): EditableTextMenuCommand<Action> =>
  uiMenuCommand(toUiMenuCommandOptions(options)) as EditableTextMenuCommand<Action>;

export const editableTextClipboardMenuCommands = (
  enabled: EditableTextClipboardMenuEnabled,
): readonly EditableTextMenuCommand[] => [
  editableTextMenuCommand({ action: 'cut', enabled: enabled.cut, label: 'Cut' }),
  editableTextMenuCommand({ action: 'copy', enabled: enabled.copy, label: 'Copy' }),
  editableTextMenuCommand({ action: 'paste', enabled: enabled.paste, label: 'Paste' }),
];

export const layoutEditableTextMenu = <Action extends string>({
  anchor,
  bounds,
  commands,
  metrics,
  open,
}: EditableTextMenuLayoutOptions<Action>): EditableTextMenuLayout<Action> | undefined => {
  if (open === false) return undefined;
  const layout = layoutUiMenuCommands({
    anchor,
    bounds,
    commands: commands.map(toUiMenuCommandOptions),
    metrics,
  });

  return {
    ...layout,
    commands: layout.commands as readonly EditableTextMenuCommandRect<Action>[],
  };
};

export const editableTextMenuCommandAt = <Action extends string>(
  commands: readonly EditableTextMenuCommandRect<Action>[],
  point: UiMenuPoint,
): EditableTextMenuCommandRect<Action> | undefined =>
  uiMenuCommandAt(commands, point) as EditableTextMenuCommandRect<Action> | undefined;

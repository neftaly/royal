export type UiId = string;

export type UiRole =
  | 'button'
  | 'checkbox'
  | 'group'
  | 'image'
  | 'link'
  | 'list'
  | 'listitem'
  | 'menuitem'
  | 'none'
  | 'option'
  | 'radio'
  | 'region'
  | 'slider'
  | 'switch'
  | 'tab'
  | 'text'
  | 'textbox';

export type UiControlValue = number | string | readonly string[];
export type UiCheckedState = boolean | 'mixed';

export interface UiControlState {
  readonly checked?: UiCheckedState;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  readonly required: boolean;
  readonly selected?: boolean;
  readonly value?: UiControlValue;
}

export interface UiControlStateOptions {
  readonly checked?: UiCheckedState;
  /** @defaultValue `false` */
  readonly disabled?: boolean;
  /** @defaultValue `false` */
  readonly readOnly?: boolean;
  /** @defaultValue `false` */
  readonly required?: boolean;
  readonly selected?: boolean;
  readonly value?: UiControlValue;
}

export interface UiFocusState {
  readonly focusable: boolean;
  readonly focused: boolean;
  readonly focusVisible: boolean;
  readonly tabIndex?: number;
}

export interface UiFocusStateOptions {
  /** @defaultValue `false` */
  readonly focusable?: boolean;
  /** @defaultValue `false` */
  readonly focused?: boolean;
  /** @defaultValue `false` */
  readonly focusVisible?: boolean;
  readonly tabIndex?: number;
}

export interface UiInputState {
  readonly active: boolean;
  readonly hovered: boolean;
  readonly pressed: boolean;
}

export interface UiInputStateOptions {
  /** @defaultValue `false` */
  readonly active?: boolean;
  /** @defaultValue `false` */
  readonly hovered?: boolean;
  /** @defaultValue `false` */
  readonly pressed?: boolean;
}

export type UiHitRegionKind = 'bounds' | 'custom' | 'shape' | 'text';
export type UiHitRegionCoordinateSpace = 'local' | 'screen' | 'world';

export interface UiHitBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export interface UiHitRegion {
  readonly bounds?: UiHitBounds;
  readonly coordinateSpace: UiHitRegionCoordinateSpace;
  readonly id: UiId;
  readonly kind: UiHitRegionKind;
  readonly priority: number;
  readonly targetId?: UiId;
}

export interface UiHitRegionOptions {
  readonly bounds?: UiHitBounds;
  /** @defaultValue `'local'` */
  readonly coordinateSpace?: UiHitRegionCoordinateSpace;
  readonly id: UiId;
  /** @defaultValue `'bounds'` */
  readonly kind?: UiHitRegionKind;
  /** @defaultValue `0` */
  readonly priority?: number;
  readonly targetId?: UiId;
}

export interface UiNodeSemantics {
  readonly controlState: UiControlState;
  readonly description?: string;
  readonly focusState: UiFocusState;
  readonly hitRegion?: UiHitRegion;
  readonly id: UiId;
  readonly inputState: UiInputState;
  readonly label?: string;
  readonly role: UiRole;
}

export interface UiNodeSemanticsOptions {
  readonly controlState?: UiControlStateOptions;
  readonly description?: string;
  readonly focusState?: UiFocusStateOptions;
  readonly hitRegion?: UiHitRegion;
  readonly id: UiId;
  readonly inputState?: UiInputStateOptions;
  readonly label?: string;
  readonly role: UiRole;
}

const uiRoles: ReadonlySet<UiRole> = new Set([
  'button',
  'checkbox',
  'group',
  'image',
  'link',
  'list',
  'listitem',
  'menuitem',
  'none',
  'option',
  'radio',
  'region',
  'slider',
  'switch',
  'tab',
  'text',
  'textbox'
]);

const focusableRoles: ReadonlySet<UiRole> = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'option',
  'radio',
  'slider',
  'switch',
  'tab',
  'textbox'
]);

const activatableRoles: ReadonlySet<UiRole> = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'option',
  'radio',
  'switch',
  'tab'
]);

const hitRegionKinds: ReadonlySet<UiHitRegionKind> = new Set(['bounds', 'custom', 'shape', 'text']);
const hitRegionCoordinateSpaces: ReadonlySet<UiHitRegionCoordinateSpace> = new Set(['local', 'screen', 'world']);

export const uiId = (id: string): UiId => {
  if (id.trim().length === 0) {
    throw new Error('UI id must be a non-empty string');
  }

  return id;
};

export const uiControlState = (options: UiControlStateOptions = {}): UiControlState => {
  const state: UiControlState = {
    disabled: options.disabled ?? false,
    readOnly: options.readOnly ?? false,
    required: options.required ?? false,
    ...(options.checked !== undefined ? { checked: options.checked } : {}),
    ...(options.selected !== undefined ? { selected: options.selected } : {}),
    ...(options.value !== undefined ? { value: freezeControlValue(options.value) } : {})
  };

  return Object.freeze(state);
};

export const uiFocusState = (options: UiFocusStateOptions = {}): UiFocusState => {
  const focusable = options.focusable ?? options.focused ?? false;
  const state: UiFocusState = {
    focusable,
    focused: focusable ? options.focused ?? false : false,
    focusVisible: focusable ? options.focusVisible ?? false : false,
    ...(options.tabIndex !== undefined ? { tabIndex: integer(options.tabIndex, 'UI tabIndex') } : {})
  };

  return Object.freeze(state);
};

export const uiInputState = (options: UiInputStateOptions = {}): UiInputState => {
  return Object.freeze({
    active: options.active ?? false,
    hovered: options.hovered ?? false,
    pressed: options.pressed ?? false
  });
};

export const uiHitRegion = (options: UiHitRegionOptions): UiHitRegion => {
  const kind = options.kind ?? 'bounds';
  const coordinateSpace = options.coordinateSpace ?? 'local';

  if (!hitRegionKinds.has(kind)) {
    throw new Error(`Unknown UI hit region kind: ${kind}`);
  }

  if (!hitRegionCoordinateSpaces.has(coordinateSpace)) {
    throw new Error(`Unknown UI hit region coordinate space: ${coordinateSpace}`);
  }

  const region: UiHitRegion = {
    coordinateSpace,
    id: uiId(options.id),
    kind,
    priority: finiteNumber(options.priority ?? 0, 'UI hit region priority'),
    ...(options.bounds !== undefined ? { bounds: normalizeHitBounds(options.bounds) } : {}),
    ...(options.targetId !== undefined ? { targetId: uiId(options.targetId) } : {})
  };

  return Object.freeze(region);
};

export const uiNodeSemantics = (options: UiNodeSemanticsOptions): UiNodeSemantics => {
  const role = uiRole(options.role);
  const controlState = uiControlState(options.controlState);
  const focusable = !controlState.disabled && (options.focusState?.focusable ?? focusableRoles.has(role));
  const focusStateOptions: UiFocusStateOptions = controlState.disabled
    ? { ...options.focusState, focusable, focused: false, focusVisible: false }
    : { ...options.focusState, focusable };
  const label = normalizeOptionalText(options.label);
  const description = normalizeOptionalText(options.description);
  const focusState = uiFocusState(focusStateOptions);
  const semantics: UiNodeSemantics = {
    controlState,
    focusState,
    id: uiId(options.id),
    inputState: uiInputState(options.inputState),
    role,
    ...(label !== undefined ? { label } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(options.hitRegion !== undefined ? { hitRegion: options.hitRegion } : {})
  };

  return Object.freeze(semantics);
};

export const isUiFocusable = (semantics: Pick<UiNodeSemantics, 'controlState' | 'focusState'>): boolean => {
  return !semantics.controlState.disabled && semantics.focusState.focusable;
};

export const isUiActivatable = (semantics: Pick<UiNodeSemantics, 'controlState' | 'role'>): boolean => {
  return !semantics.controlState.disabled && !semantics.controlState.readOnly && activatableRoles.has(semantics.role);
};

const uiRole = (role: UiRole): UiRole => {
  if (!uiRoles.has(role)) {
    throw new Error(`Unknown UI role: ${role}`);
  }

  return role;
};

const normalizeOptionalText = (text: string | undefined): string | undefined => {
  const normalized = text?.trim();
  return normalized === '' ? undefined : normalized;
};

const freezeControlValue = (value: UiControlValue): UiControlValue => {
  return Array.isArray(value) ? Object.freeze([...value]) : value;
};

const normalizeHitBounds = (bounds: UiHitBounds): UiHitBounds => {
  const normalized = {
    height: finitePositiveNumber(bounds.height, 'UI hit bounds height'),
    width: finitePositiveNumber(bounds.width, 'UI hit bounds width'),
    x: finiteNumber(bounds.x, 'UI hit bounds x'),
    y: finiteNumber(bounds.y, 'UI hit bounds y')
  };

  return Object.freeze(normalized);
};

const integer = (value: number, label: string): number => {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer`);
  }

  return value;
};

const finitePositiveNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number`);
  }

  return value;
};

const finiteNumber = (value: number, label: string): number => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }

  return value;
};

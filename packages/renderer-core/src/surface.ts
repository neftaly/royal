export type SurfaceTargetId = string;

export type SurfaceEventKind =
  | 'activate'
  | 'drag-end'
  | 'drag-move'
  | 'drag-start'
  | 'focus'
  | 'pick';

export type SurfaceEventRow = {
  readonly path: readonly SurfaceTargetId[];
  readonly targetId: SurfaceTargetId;
  readonly type: SurfaceEventKind;
};

export type SurfaceNode =
  | SurfaceItemNode
  | SurfacePanelNode
  | SurfaceTableNode
  | SurfaceTextNode
  | SurfaceZoneNode;

export interface SurfaceDescriptor {
  readonly id: SurfaceTargetId;
  readonly nodes: readonly SurfaceNode[];
}

export interface SurfacePanelNode {
  readonly children: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly kind: 'panel';
  readonly label?: string;
}

export interface SurfaceTableNode {
  readonly children: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly kind: 'table';
  readonly label?: string;
}

export interface SurfaceZoneNode {
  readonly children: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly kind: 'zone';
  readonly label?: string;
}

export interface SurfaceItemNode {
  readonly id: SurfaceTargetId;
  readonly kind: 'item';
  readonly label?: string;
}

export interface SurfaceTextNode {
  readonly id: SurfaceTargetId;
  readonly kind: 'text';
  readonly value: string;
}

export type SurfaceDiagnosticCode =
  | 'duplicate_target_id'
  | 'empty_target_id';

export interface SurfaceDiagnostic {
  readonly code: SurfaceDiagnosticCode;
  readonly message: string;
  readonly targetId?: string;
}

export interface SurfaceDescriptorOptions {
  readonly id: SurfaceTargetId;
  readonly nodes?: readonly SurfaceNode[];
}

export interface SurfacePanelOptions {
  readonly children?: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly label?: string;
}

export interface SurfaceTableOptions {
  readonly children?: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly label?: string;
}

export interface SurfaceZoneOptions {
  readonly children?: readonly SurfaceNode[];
  readonly id: SurfaceTargetId;
  readonly label?: string;
}

export interface SurfaceItemOptions {
  readonly id: SurfaceTargetId;
  readonly label?: string;
}

export interface SurfaceTextOptions {
  readonly id: SurfaceTargetId;
  readonly value: string;
}

export interface SurfaceEventRowOptions {
  readonly path: readonly SurfaceTargetId[];
  readonly targetId: SurfaceTargetId;
  readonly type: SurfaceEventKind;
}

export const surfaceTargetId = (id: string): SurfaceTargetId => {
  const normalized = id.trim();
  if (normalized.length === 0) {
    throw new Error('Surface target ID must be a non-empty string');
  }

  return normalized;
};

export const surface = (options: SurfaceDescriptorOptions): SurfaceDescriptor =>
  Object.freeze({
    id: surfaceTargetId(options.id),
    nodes: freezeNodes(options.nodes ?? []),
  });

export const surfacePanel = (options: SurfacePanelOptions): SurfacePanelNode =>
  Object.freeze({
    children: freezeNodes(options.children ?? []),
    id: surfaceTargetId(options.id),
    kind: 'panel',
    ...(options.label === undefined ? {} : { label: options.label }),
  });

export const surfaceTable = (options: SurfaceTableOptions): SurfaceTableNode =>
  Object.freeze({
    children: freezeNodes(options.children ?? []),
    id: surfaceTargetId(options.id),
    kind: 'table',
    ...(options.label === undefined ? {} : { label: options.label }),
  });

export const surfaceZone = (options: SurfaceZoneOptions): SurfaceZoneNode =>
  Object.freeze({
    children: freezeNodes(options.children ?? []),
    id: surfaceTargetId(options.id),
    kind: 'zone',
    ...(options.label === undefined ? {} : { label: options.label }),
  });

export const surfaceItem = (options: SurfaceItemOptions): SurfaceItemNode =>
  Object.freeze({
    id: surfaceTargetId(options.id),
    kind: 'item',
    ...(options.label === undefined ? {} : { label: options.label }),
  });

export const surfaceText = (options: SurfaceTextOptions): SurfaceTextNode =>
  Object.freeze({
    id: surfaceTargetId(options.id),
    kind: 'text',
    value: options.value,
  });

export const surfaceEventRow = (options: SurfaceEventRowOptions): SurfaceEventRow => {
  const targetId = surfaceTargetId(options.targetId);
  const path = options.path.map(surfaceTargetId);

  if (path.length === 0) {
    throw new Error('Surface event path must include the target ID');
  }

  if (path.at(-1) !== targetId) {
    throw new Error('Surface event path must end with the target ID');
  }

  return Object.freeze({
    path: Object.freeze(path),
    targetId,
    type: options.type,
  });
};

export const validateSurfaceDescriptor = (
  surface: SurfaceDescriptor,
): readonly SurfaceDiagnostic[] => {
  const diagnostics: SurfaceDiagnostic[] = [];
  const seen = new Set<string>();

  visitTargetId(surface.id, diagnostics, seen);
  for (const node of surface.nodes) {
    visitNode(node, diagnostics, seen);
  }

  return diagnostics;
};

const visitNode = (
  node: SurfaceNode,
  diagnostics: SurfaceDiagnostic[],
  seen: Set<string>,
): void => {
  visitTargetId(node.id, diagnostics, seen);

  if (node.kind === 'panel' || node.kind === 'table' || node.kind === 'zone') {
    for (const child of node.children) {
      visitNode(child, diagnostics, seen);
    }
  }
};

const visitTargetId = (
  targetId: string,
  diagnostics: SurfaceDiagnostic[],
  seen: Set<string>,
): void => {
  const normalizedTargetId = targetId.trim();

  if (normalizedTargetId.length === 0) {
    diagnostics.push({
      code: 'empty_target_id',
      message: 'Surface target IDs must be non-empty strings',
      targetId,
    });
    return;
  }

  if (seen.has(normalizedTargetId)) {
    diagnostics.push({
      code: 'duplicate_target_id',
      message: `Duplicate surface target ID: ${normalizedTargetId}`,
      targetId,
    });
    return;
  }

  seen.add(normalizedTargetId);
};

const freezeNodes = (nodes: readonly SurfaceNode[]): readonly SurfaceNode[] =>
  Object.freeze([...nodes]);

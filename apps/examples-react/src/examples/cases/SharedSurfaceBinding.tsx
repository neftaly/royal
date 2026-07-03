import {
  type Rgba,
  type Vec3,
} from '@royal/renderer-core';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { Canvas } from '@royal/react';
import {
  createElement,
  useCallback,
  useState,
  type ReactNode,
} from 'react';
import { htmlColor } from '../color';
import { exampleCanvasRenderer } from '../example-renderer';
import {
  Box,
  Column,
  Container,
  layoutFlex,
  Row,
  type FlexLayoutBox,
} from '../flex-layout';
import { HudPass } from '../hud';
import { useAtkinsonFont } from './text-font';

type TargetId = 'north-gate' | 'medical-tent' | 'supply-cache' | 'drone-feed';
type ProjectionId = 'tablet-hud' | 'world-board';

type IncidentTarget = {
  readonly id: TargetId;
  readonly label: string;
  readonly status: string;
  readonly team: string;
  readonly tone: 'blue' | 'green';
};

type IncidentSurfaceContract = {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
  readonly targets: readonly IncidentTarget[];
};

type PickEvent = {
  readonly path: readonly string[];
  readonly sequence: number;
  readonly source: ProjectionId;
  readonly targetId: TargetId;
  readonly type: 'pick';
};

type ProjectionSpace = 'hud' | 'world';

type ProjectionBinding = {
  readonly accent: Rgba;
  readonly background: Rgba;
  readonly id: ProjectionId;
  readonly origin: Vec3;
  readonly placementLabel: string;
  readonly royalLabel: string;
  readonly scale: number;
  readonly title: string;
  readonly space: ProjectionSpace;
};

type LayoutId =
  | 'app-chip'
  | 'event-help'
  | 'event-row-0'
  | 'event-row-1'
  | 'event-row-2'
  | 'event-title'
  | 'incident-board'
  | 'north-gate'
  | 'medical-tent'
  | 'placement-chip'
  | 'projection-root'
  | 'royal-chip'
  | 'status-copy'
  | 'supply-cache'
  | 'target-grid'
  | 'title'
  | 'drone-feed';

const incidentSurface = {
  id: 'patchpit-incident-surface',
  title: 'Shared Incident Board',
  subtitle: 'One app contract, two Royal placements',
  targets: [
    {
      id: 'north-gate',
      label: 'North gate',
      status: 'Crowd line moving',
      team: 'Field A',
      tone: 'green',
    },
    {
      id: 'medical-tent',
      label: 'Medical tent',
      status: 'Two arrivals',
      team: 'Care 2',
      tone: 'blue',
    },
    {
      id: 'supply-cache',
      label: 'Supply cache',
      status: 'ETA 7 min',
      team: 'Logistics',
      tone: 'green',
    },
    {
      id: 'drone-feed',
      label: 'Drone feed',
      status: 'Thermal sweep',
      team: 'Air 1',
      tone: 'blue',
    },
  ],
} as const satisfies IncidentSurfaceContract;

const projectionSize = {
  height: 6.7,
  width: 7.45,
} as const;

const hudSize = {
  height: 9,
  width: 16,
} as const;

const palette = {
  active: htmlColor('#55e08a'),
  activeInk: htmlColor('#071116'),
  amber: htmlColor('#ffd166'),
  board: htmlColor('#10262b'),
  cellBlue: htmlColor('#203c5c'),
  cellGreen: htmlColor('#15383f'),
  cyan: htmlColor('#8ee8ff'),
  floor: htmlColor('#182126'),
  muted: htmlColor('#9bb8b4'),
  panel: htmlColor('#071116'),
  roomLine: htmlColor('#3e4d57'),
  tabletAccent: htmlColor('#8ee8ff'),
  tabletBack: htmlColor('#0b171b'),
  text: htmlColor('#e7f7f4'),
  wall: htmlColor('#222a30'),
  worldAccent: htmlColor('#df8cff'),
  worldBack: htmlColor('#081014'),
} as const;

const layout = layoutFlex<LayoutId>(
  Container({
    gap: 0.14,
    id: 'projection-root',
    padding: 0.28,
    size: projectionSize,
  },
    Box('title', { height: 0.46 }),
    Row({ gap: 0.14, height: 0.8 },
      Box('app-chip', { width: 2.12 }),
      Box('placement-chip', { width: 2.12 }),
      Box('royal-chip', { width: 2.12 }),
    ),
    Row({
      gap: 0.22,
      height: 4.48,
    },
      Column({
        gap: 0.16,
        height: 4.48,
        id: 'incident-board',
        padding: 0.2,
        width: 4.18,
      },
        Box('target-grid', { height: 0.42 }),
        Row({ gap: 0.16, height: 1.75 },
          Box('north-gate', { width: 1.8 }),
          Box('medical-tent', { width: 1.8 }),
        ),
        Row({ gap: 0.16, height: 1.75 },
          Box('supply-cache', { width: 1.8 }),
          Box('drone-feed', { width: 1.8 }),
        ),
      ),
      Column({
        gap: 0.14,
        height: 4.48,
        padding: 0.2,
        width: 2.38,
      },
        Box('event-title', { height: 0.42 }),
        Box('event-row-0', { height: 0.8 }),
        Box('event-row-1', { height: 0.8 }),
        Box('event-row-2', { height: 0.8 }),
        Box('event-help', { height: 0.52 }),
      ),
    ),
    Box('status-copy', { height: 0.36 }),
  ),
);

const projectionBindings = [
  {
    accent: palette.tabletAccent,
    background: palette.tabletBack,
    id: 'tablet-hud',
    origin: [0.46, -0.52, 0],
    placementLabel: 'near-user tablet HUD',
    royalLabel: 'orthographic HUD pass',
    scale: 1,
    space: 'hud',
    title: 'Tablet projection',
  },
  {
    accent: palette.worldAccent,
    background: palette.worldBack,
    id: 'world-board',
    origin: [2.05, 0.08, -1.25],
    placementLabel: 'room wall anchor',
    royalLabel: 'perspective pass + picking',
    scale: 0.52,
    space: 'world',
    title: 'World-board projection',
  },
] as const satisfies readonly ProjectionBinding[];

const eventRowIds = ['event-row-0', 'event-row-1', 'event-row-2'] as const;
const firstTarget = incidentSurface.targets[0];

const targetById = new Map(
  incidentSurface.targets.map((target) => [target.id, target]),
);

const validateIncidentSurface = (surface: IncidentSurfaceContract): readonly string[] => {
  const ids = new Set<string>();
  const diagnostics: string[] = [];

  for (const target of surface.targets) {
    if (ids.has(target.id)) diagnostics.push(`Duplicate target id: ${target.id}`);
    ids.add(target.id);
  }

  if (surface.targets.length === 0) diagnostics.push('At least one target is required');
  return diagnostics;
};

const incidentDiagnostics = validateIncidentSurface(incidentSurface);

const createPickEvent = (
  target: IncidentTarget,
  source: ProjectionId,
  sequence: number,
): PickEvent => ({
  path: [incidentSurface.id, 'targets', target.id],
  sequence,
  source,
  targetId: target.id,
  type: 'pick',
});

const initialEvents = firstTarget === undefined
  ? []
  : [createPickEvent(firstTarget, 'tablet-hud', 1)];

const projectionScale = (binding: ProjectionBinding): number =>
  binding.space === 'hud' ? 1 : binding.scale;

const projectCenter = (
  box: FlexLayoutBox,
  binding: ProjectionBinding,
  z = 0,
): Vec3 => {
  if (binding.space === 'hud') {
    return [
      binding.origin[0] + box.left + box.width / 2,
      binding.origin[1] - box.top - box.height / 2,
      binding.origin[2] + z,
    ];
  }

  return [
    binding.origin[0] + (box.left - projectionSize.width / 2 + box.width / 2) * binding.scale,
    binding.origin[1] + (projectionSize.height / 2 - box.top - box.height / 2) * binding.scale,
    binding.origin[2] + z,
  ];
};

const projectTextOrigin = (
  box: FlexLayoutBox,
  binding: ProjectionBinding,
  fontSize: number,
  insetX: number,
  insetY: number,
  z: number,
): Vec3 => {
  if (binding.space === 'hud') {
    return [
      binding.origin[0] + box.left + insetX,
      binding.origin[1] - box.top - insetY - fontSize * 0.82,
      binding.origin[2] + z,
    ];
  }

  return [
    binding.origin[0] + (box.left - projectionSize.width / 2 + insetX) * binding.scale,
    binding.origin[1] + (projectionSize.height / 2 - box.top - insetY - fontSize * 0.82) * binding.scale,
    binding.origin[2] + z,
  ];
};

const insetBox = (
  box: FlexLayoutBox,
  inset: number,
): FlexLayoutBox => ({
  bottom: box.bottom - inset,
  height: box.height - inset * 2,
  left: box.left + inset,
  right: box.right - inset,
  top: box.top + inset,
  width: box.width - inset * 2,
});

const leftAccentBox = (
  box: FlexLayoutBox,
  width: number,
): FlexLayoutBox => ({
  bottom: box.bottom,
  height: box.height,
  left: box.left,
  right: box.left + width,
  top: box.top,
  width,
});

const eventSourceLabel = (source: ProjectionId): string =>
  source === 'tablet-hud' ? 'Tablet HUD' : 'World board';

const eventTargetLabel = (event: PickEvent | undefined): string => {
  if (event === undefined) return 'waiting for pick';

  const target = targetById.get(event.targetId);
  return `${event.type.toUpperCase()} ${event.sequence} / ${target?.label ?? event.targetId}`;
};

const eventPathLabel = (event: PickEvent | undefined): string =>
  event === undefined
    ? 'same target path appears in both projections'
    : `${eventSourceLabel(event.source)} -> ${event.path.slice(-2).join(' / ')}`;

const ProjectionRect = ({
  binding,
  box,
  color,
  z = 0,
}: {
  readonly binding: ProjectionBinding;
  readonly box: FlexLayoutBox;
  readonly color: Rgba;
  readonly z?: number;
}): ReactNode => (
  <mesh transform={{ position: projectCenter(box, binding, z), rotation: [0, 0, 0] }}>
    <planeGeometry size={[box.width * projectionScale(binding), box.height * projectionScale(binding)]} />
    <unlitMaterial color={color} />
  </mesh>
);

const ProjectionText = ({
  binding,
  box,
  children,
  color,
  font,
  fontSize,
  insetX = 0,
  insetY = 0,
  lineHeight = fontSize * 1.22,
  z = 0.08,
}: {
  readonly binding: ProjectionBinding;
  readonly box: FlexLayoutBox;
  readonly children: ReactNode;
  readonly color: Rgba;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly insetX?: number;
  readonly insetY?: number;
  readonly lineHeight?: number;
  readonly z?: number;
}): ReactNode => (
  <text
    color={color}
    font={font}
    fontSize={fontSize * projectionScale(binding)}
    lineHeight={lineHeight * projectionScale(binding)}
    origin={projectTextOrigin(box, binding, fontSize, insetX, insetY, z)}
  >
    {children}
  </text>
);

const ProjectionChip = ({
  binding,
  box,
  children,
  font,
}: {
  readonly binding: ProjectionBinding;
  readonly box: FlexLayoutBox;
  readonly children: ReactNode;
  readonly font: TextFontFace;
}): ReactNode => (
  <>
    <ProjectionRect binding={binding} box={box} color={palette.panel} z={0.02} />
    <ProjectionRect binding={binding} box={leftAccentBox(box, 0.07)} color={binding.accent} z={0.06} />
    <ProjectionText
      binding={binding}
      box={box}
      color={palette.text}
      font={font}
      fontSize={0.13}
      insetX={0.15}
      insetY={0.1}
      lineHeight={0.18}
      z={0.09}
    >
      {children}
    </ProjectionText>
  </>
);

const ProjectionBackplate = ({
  binding,
}: {
  readonly binding: ProjectionBinding;
}): ReactNode => (
  <mesh transform={{ position: projectCenter(layout['projection-root'], binding, -0.04), rotation: [0, 0, 0] }}>
    <planeGeometry
      size={[
        projectionSize.width * projectionScale(binding),
        projectionSize.height * projectionScale(binding),
      ]}
    />
    <unlitMaterial color={binding.background} />
  </mesh>
);

const TargetTile = ({
  binding,
  font,
  onPick,
  selected,
  target,
}: {
  readonly binding: ProjectionBinding;
  readonly font: TextFontFace;
  readonly onPick: () => void;
  readonly selected: boolean;
  readonly target: IncidentTarget;
}): ReactNode => {
  const box = layout[target.id];
  const color = selected
    ? palette.active
    : target.tone === 'green'
      ? palette.cellGreen
      : palette.cellBlue;

  return (
    <>
      <ProjectionRect binding={binding} box={box} color={color} z={selected ? 0.08 : 0.03} />
      <mesh
        onClick={onPick}
        transform={{
          position: projectCenter(insetBox(box, 0.03), binding, selected ? 0.11 : 0.06),
          rotation: [0, 0, 0],
        }}
      >
        <planeGeometry
          size={[
            (box.width - 0.06) * projectionScale(binding),
            (box.height - 0.06) * projectionScale(binding),
          ]}
        />
        <unlitMaterial color={color} />
      </mesh>
      <ProjectionText
        binding={binding}
        box={box}
        color={selected ? palette.activeInk : palette.text}
        font={font}
        fontSize={0.22}
        insetX={0.16}
        insetY={0.32}
        z={0.13}
      >
        {target.label}
      </ProjectionText>
      <ProjectionText
        binding={binding}
        box={box}
        color={selected ? palette.activeInk : palette.muted}
        font={font}
        fontSize={0.12}
        insetX={0.16}
        insetY={0.72}
        lineHeight={0.18}
        z={0.14}
      >
        {target.team}{'\n'}
        {target.status}
      </ProjectionText>
    </>
  );
};

const IncidentRoom = (): ReactNode => (
  <>
    <mesh transform={{ position: [0, -1.86, -1.4], rotation: [-Math.PI / 2, 0, 0] }}>
      <planeGeometry size={[9.2, 5.6]} />
      <standardMaterial color={palette.floor} />
    </mesh>
    <mesh transform={{ position: [2.05, 0.08, -1.36], rotation: [0, 0, 0] }}>
      <planeGeometry size={[4.24, 3.78]} />
      <standardMaterial color={palette.wall} />
    </mesh>
    <mesh transform={{ position: [-1.74, -0.84, -0.86], rotation: [0.18, 0.48, 0] }}>
      <boxGeometry size={[0.42, 1.34, 0.42]} />
      <standardMaterial color={htmlColor('#f97356')} />
    </mesh>
    <mesh transform={{ position: [-0.92, -1.3, -0.34], rotation: [0, 0.2, 0] }}>
      <boxGeometry size={[1.22, 0.12, 0.82]} />
      <standardMaterial color={palette.roomLine} />
    </mesh>
  </>
);

const SurfaceProjection = ({
  binding,
  events,
  font,
  onPick,
  selectedTarget,
}: {
  readonly binding: ProjectionBinding;
  readonly events: readonly PickEvent[];
  readonly font: TextFontFace;
  readonly onPick: (target: IncidentTarget, source: ProjectionId) => void;
  readonly selectedTarget: TargetId;
}): ReactNode => (
  <>
    <ProjectionBackplate binding={binding} />
    <ProjectionText
      binding={binding}
      box={layout.title}
      color={palette.text}
      font={font}
      fontSize={0.29}
      z={0.09}
    >
      {incidentSurface.title}{'\n'}
      {binding.title}
    </ProjectionText>
    <ProjectionChip binding={binding} box={layout['app-chip']} font={font}>
      app contract{'\n'}
      Patchpit/Opshop owns targets
    </ProjectionChip>
    <ProjectionChip binding={binding} box={layout['placement-chip']} font={font}>
      placement{'\n'}
      {binding.placementLabel}
    </ProjectionChip>
    <ProjectionChip binding={binding} box={layout['royal-chip']} font={font}>
      Royal{'\n'}
      {binding.royalLabel}
    </ProjectionChip>
    <ProjectionRect binding={binding} box={layout['incident-board']} color={palette.board} z={0.01} />
    <ProjectionText
      binding={binding}
      box={layout['target-grid']}
      color={palette.cyan}
      font={font}
      fontSize={0.16}
      insetX={0.04}
      lineHeight={0.2}
      z={0.08}
    >
      shared targets{'\n'}
      {incidentSurface.subtitle}
    </ProjectionText>
    {incidentSurface.targets.map((target) => (
      createElement(
        TargetTile,
        {
          binding,
          font,
          key: `${binding.id}-${target.id}`,
          onPick: () => onPick(target, binding.id),
          selected: target.id === selectedTarget,
          target,
        },
      )
    ))}
    <ProjectionRect binding={binding} box={layout['event-title']} color={palette.panel} z={0.03} />
    <ProjectionText
      binding={binding}
      box={layout['event-title']}
      color={palette.amber}
      font={font}
      fontSize={0.15}
      insetX={0.04}
      lineHeight={0.19}
      z={0.09}
    >
      shared event rows{'\n'}
      pick either projection
    </ProjectionText>
    {eventRowIds.map((rowId, index) => (
      createElement(
        ProjectionText,
        {
          binding,
          box: layout[rowId],
          children: [
            eventTargetLabel(events[index]),
            '\n',
            eventPathLabel(events[index]),
          ],
          color: index === 0 ? palette.active : palette.text,
          font,
          fontSize: 0.135,
          key: `${binding.id}-${rowId}`,
          lineHeight: 0.2,
          z: 0.08,
        },
      )
    ))}
    <ProjectionText
      binding={binding}
      box={layout['event-help']}
      color={palette.muted}
      font={font}
      fontSize={0.13}
      insetX={0.04}
      lineHeight={0.18}
      z={0.08}
    >
      Same React state feeds both placements.
    </ProjectionText>
    <ProjectionText
      binding={binding}
      box={layout['status-copy']}
      color={incidentDiagnostics.length === 0 ? palette.active : palette.amber}
      font={font}
      fontSize={0.145}
      z={0.08}
    >
      {incidentDiagnostics.length === 0
        ? 'Boundary: Patchpit/Opshop model; Royal render/pick/placement.'
        : `${incidentDiagnostics.length} app contract issue(s)`}
    </ProjectionText>
  </>
);

export const SharedSurfaceBinding = (): ReactNode => {
  const fontState = useAtkinsonFont();
  const [selectedTarget, setSelectedTarget] = useState<TargetId>(firstTarget?.id ?? 'north-gate');
  const [events, setEvents] = useState<readonly PickEvent[]>(initialEvents);

  const pickTarget = useCallback((target: IncidentTarget, source: ProjectionId): void => {
    setSelectedTarget(target.id);
    setEvents((rows) => [
      createPickEvent(target, source, (rows[0]?.sequence ?? 0) + 1),
      ...rows,
    ].slice(0, eventRowIds.length));
  }, []);

  if (fontState.status !== 'ready') return null;

  return (
    <Canvas
      aria-label="Shared surface binding rendered as tablet HUD and world board"
      data-royal-boundary="Patchpit/Opshop owns the app contract; Royal renders, places, and picks"
      data-royal-selected-target={selectedTarget}
      data-royal-shared-event-count={events.length}
      data-royal-shared-last-source={events[0]?.source ?? ''}
      renderer={exampleCanvasRenderer}
      style={{ cursor: 'pointer', touchAction: 'none' }}
    >
      <scene>
        <pass>
          <perspectiveCamera
            far={80}
            fovY={0.82}
            near={0.05}
            position={[0, 0, 7.4]}
            rotation={[0, 0, 0]}
          />
          <directionalLight color={[0.9, 0.95, 1, 1]} direction={[0.2, -0.45, -1]} />
          <directionalLight color={[0.28, 0.38, 0.58, 1]} direction={[-0.45, -0.2, 0.45]} />
          <IncidentRoom />
          <SurfaceProjection
            binding={projectionBindings[1]}
            events={events}
            font={fontState.font}
            onPick={pickTarget}
            selectedTarget={selectedTarget}
          />
        </pass>
        <HudPass height={hudSize.height} width={hudSize.width}>
          <SurfaceProjection
            binding={projectionBindings[0]}
            events={events}
            font={fontState.font}
            onPick={pickTarget}
            selectedTarget={selectedTarget}
          />
        </HudPass>
      </scene>
    </Canvas>
  );
};

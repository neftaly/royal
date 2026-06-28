import { createRoot as createRoyalRoot } from '@royal/react';
import { Canvas } from '@royal/react';
import { layoutText, textMesh, type EulerRads } from '@royal/renderer-core';
import {
  createRoyalLensSnapshot,
  evaluateRoyalLens,
  royalCapabilityBoundaryContract,
  royalLensSchema,
  royalQueries,
  type RoyalInteractionState,
  type RoyalPickProbeRow,
  type RoyalRenderRow,
} from '@royal/tarstate-lens/v1';
import {
  createElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  interactionState,
  layoutState,
  pickTargets,
  pointerSample,
  royalStores,
  targetIdAtGridPoint,
} from '../demo-data';
import {
  cubeScene,
  multiObjectScene,
  tarstateScene,
  textLayoutScene,
} from './royal-scenes';

type RowValue = string | number | boolean | undefined;
type Row = Record<string, RowValue>;

const canvasRootOptions = { alpha: true, antialias: true } as const;

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

const MiniTable = ({
  rows,
  columns,
}: {
  readonly rows: readonly Row[];
  readonly columns: readonly string[];
}): ReactNode => (
  <table className="probe-table">
    <thead>
      <tr>
        {columns.map((column) => (
          <th key={column}>{column}</th>
        ))}
      </tr>
    </thead>
    <tbody>
      {rows.map((row, index) => (
        <tr key={String(row.id ?? row.boxId ?? row.targetId ?? row.sampleId ?? index)}>
          {columns.map((column) => (
            <td key={column}>{String(row[column] ?? '')}</td>
          ))}
        </tr>
      ))}
    </tbody>
  </table>
);

export const HelloCubeDemo = (): ReactNode =>
  createElement(Canvas, {
    children: cubeScene(),
    rootOptions: canvasRootOptions,
  });

export const ImperativeRootDemo = (): ReactNode => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) {
      return undefined;
    }

    const root = createRoyalRoot(canvas, canvasRootOptions);
    let frameId = 0;
    let disposed = false;

    const renderFrame = (time: number): void => {
      if (disposed) {
        return;
      }

      const phase = time / 1100;
      root.render(cubeScene([0.45 + Math.sin(phase) * 0.25, phase, 0.1]));
      frameId = window.requestAnimationFrame(renderFrame);
    };

    frameId = window.requestAnimationFrame(renderFrame);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      root.unmount();
    };
  }, []);

  return <canvas ref={canvasRef} aria-label="Imperative Royal root demo" />;
};

export const InteractiveSceneDemo = (): ReactNode => {
  const [rotation, setRotation] = useState<EulerRads>([0.35, 0.7, 0]);
  const [scale, setScale] = useState(1);

  const rotate = (event: PointerEvent<HTMLCanvasElement>): void => {
    if (event.buttons !== 1) {
      return;
    }

    setRotation(([x, y, z]) => [
      x + event.movementY / 120,
      y + event.movementX / 120,
      z,
    ]);
  };

  return (
    <div className="stacked-demo">
      <div className="canvas-slot">
        {createElement(Canvas, {
          children: multiObjectScene(rotation, scale),
          rootOptions: canvasRootOptions,
          onPointerMove: rotate,
          'aria-label': 'Interactive multi object scene',
        })}
      </div>
      <div className="control-strip" aria-label="Scene controls">
        <label>
          Scale
          <input
            max="1.4"
            min="0.7"
            step="0.05"
            type="range"
            value={scale}
            onChange={(event) => setScale(Number(event.currentTarget.value))}
          />
        </label>
        <button
          type="button"
          onClick={() => setRotation(([x, y, z]) => [x, y + Math.PI / 8, z])}
        >
          Rotate
        </button>
      </div>
    </div>
  );
};

export const TarstateSceneSourceDemo = (): ReactNode => {
  const activeBoxId = interactionState.activeId;

  return createElement(Canvas, {
    children: tarstateScene(activeBoxId),
    rootOptions: canvasRootOptions,
  });
};

export const TextLayoutDemo = (): ReactNode => {
  const [label, setLabel] = useState('Royal layout');

  return (
    <div className="stacked-demo">
      <div className="canvas-slot">
        {createElement(Canvas, {
          children: textLayoutScene(label),
          rootOptions: canvasRootOptions,
        })}
      </div>
      <div className="control-strip">
        <input
          aria-label="Text label"
          maxLength={22}
          value={label}
          onChange={(event) => setLabel(event.currentTarget.value)}
        />
      </div>
    </div>
  );
};

export const CapabilityProbeDemo = (): ReactNode => {
  const stores = useMemo(() => royalStores(), []);
  const snapshot = useMemo(() => createRoyalLensSnapshot(stores), [stores]);

  return (
    <div className="probe-demo">
      <div>
        <span className="metric-value">{snapshot.probe.relationNames.length}</span>
        <span className="metric-label">relations</span>
      </div>
      <div>
        <span className="metric-value">
          {snapshot.probe.rowCount(royalLensSchema.effectResults)}
        </span>
        <span className="metric-label">capability results</span>
      </div>
      <div>
        <span className="metric-value">
          {royalCapabilityBoundaryContract.adapterOnly.length}
        </span>
        <span className="metric-label">adapter-only handles</span>
      </div>
    </div>
  );
};

export const PickingFuzzShapeDemo = (): ReactNode => {
  const [samples, setSamples] = useState(interactionState.pointerSamples);
  const lastSample = samples.at(-1);

  const interaction = useMemo<RoyalInteractionState>(() => ({
    ...interactionState,
    hoveredId: lastSample?.targetId,
    pointerSamples: samples,
  }), [lastSample?.targetId, samples]);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * layoutState.grid.columns;
    const y = ((event.clientY - bounds.top) / bounds.height) * layoutState.grid.rows;
    const sequence = samples.length + 1;
    setSamples((previous) => [...previous.slice(-5), pointerSample(sequence, x, y)]);
  };

  return (
    <div className="pick-stage" onPointerMove={onPointerMove}>
      {layoutState.boxes.map((box) => {
        const hovered = box.id === lastSample?.targetId;
        return (
          <div
            className={hovered ? 'pick-box active' : 'pick-box'}
            key={box.id}
            style={{
              gridColumn: `${box.x + 1} / span ${box.width}`,
              gridRow: `${box.y + 1} / span ${box.height}`,
            }}
          >
            {box.label}
          </div>
        );
      })}
      <span className="pick-readout">
        {lastSample === undefined
          ? 'No sample'
          : `${formatNumber(lastSample.x)}, ${formatNumber(lastSample.y)} -> ${lastSample.targetId ?? 'none'}`}
      </span>
      <PickingProbe interaction={interaction} />
    </div>
  );
};

export const RenderRowsProbe = (): ReactNode => {
  const stores = useMemo(() => royalStores(), []);
  const [rows, setRows] = useState<readonly RoyalRenderRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void evaluateRoyalLens(stores, royalQueries.renderRows).then((result) => {
      if (!cancelled) {
        setRows(result.rows);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stores]);

  return (
    <MiniTable
      columns={['boxId', 'primitive', 'tone', 'active', 'hovered']}
      rows={rows.map((row) => ({
        boxId: row.boxId,
        primitive: row.primitive,
        tone: row.tone,
        active: row.active,
        hovered: row.hovered,
      }))}
    />
  );
};

export const TarstateSourceProbe = (): ReactNode => {
  const stores = useMemo(() => royalStores(), []);
  const snapshot = useMemo(() => createRoyalLensSnapshot(stores), [stores]);

  return (
    <MiniTable
      columns={['relation', 'rows']}
      rows={snapshot.probe.relationNames.map((name) => ({
        relation: name,
        rows: snapshot.probe.rowCount(name),
      }))}
    />
  );
};

export const TextLayoutProbe = (): ReactNode => {
  const layout = layoutText({
    text: 'Royal layout',
    fontSize: 0.72,
    lineHeight: 0.9,
  });
  const meshResult = textMesh(layout);

  return (
    <MiniTable
      columns={['metric', 'value']}
      rows={[
        { metric: 'lines', value: layout.lines.length },
        { metric: 'glyphs', value: layout.lines[0]?.glyphs.length ?? 0 },
        { metric: 'mesh vertices', value: meshResult.vertices.length },
        { metric: 'diagnostics', value: layout.diagnostics.length },
      ]}
    />
  );
};

export const CapabilityRowsProbe = (): ReactNode => {
  const stores = useMemo(() => royalStores(), []);
  const [rows, setRows] = useState<readonly Row[]>([]);

  useEffect(() => {
    let cancelled = false;
    void evaluateRoyalLens(stores, royalQueries.capabilityResultRows).then((result) => {
      if (!cancelled) {
        setRows(result.rows.map((row) => ({
          resultId: row.resultId,
          status: row.status,
          capabilityId: row.capabilityId,
          diagnosticCode: row.diagnosticCode,
        })));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stores]);

  return (
    <MiniTable
      columns={['resultId', 'capabilityId', 'status', 'diagnosticCode']}
      rows={rows}
    />
  );
};

const PickingProbe = ({
  interaction,
}: {
  readonly interaction: RoyalInteractionState;
}): ReactNode => {
  const stores = useMemo(() => royalStores({ interaction }), [interaction]);
  const [rows, setRows] = useState<readonly RoyalPickProbeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    void evaluateRoyalLens(stores, royalQueries.pickProbeRows).then((result) => {
      if (!cancelled) {
        setRows(result.rows.slice(-3));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [stores]);

  return (
    <div className="pick-probe-overlay">
      <MiniTable
        columns={['sampleId', 'targetLabel']}
        rows={rows.map((row) => ({
          sampleId: row.sampleId.replace('sample-live-', ''),
          targetLabel: row.targetLabel,
        }))}
      />
    </div>
  );
};

export const PickingRowsProbe = (): ReactNode => {
  const rows = pickTargets.map((target) => ({
    targetId: target.id,
    label: target.label,
    x: target.bounds.rect.x,
    y: target.bounds.rect.y,
    role: target.interaction.role,
    fuzzHit: targetIdAtGridPoint(target.bounds.rect.x + 0.2, target.bounds.rect.y + 0.2),
  }));

  return (
    <MiniTable
      columns={['targetId', 'role', 'x', 'y', 'fuzzHit']}
      rows={rows}
    />
  );
};

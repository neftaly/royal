import {
  evaluateRoyalLens,
  royalQueries,
  type RoyalInteractionState,
  type RoyalPickProbeRow,
} from '@royal/tarstate-lens/v1';
import { useEffect, useMemo, useState, type PointerEvent, type ReactNode } from 'react';
import {
  interactionState,
  layoutState,
  pointerSample,
  royalStores,
} from '../demo-data';
import { MiniTable } from '../probes';

const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(2);

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

export const PickingFuzzLab = (): ReactNode => {
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

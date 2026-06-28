import {
  createRoyalLensSnapshot,
  evaluateRoyalLens,
  royalQueries,
  type RoyalRenderRow,
} from '@royal/tarstate-lens/v1';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  pickTargets,
  royalStores,
  targetIdAtGridPoint,
} from './demo-data';

type RowValue = string | number | boolean | undefined;
type Row = Record<string, RowValue>;

export const MiniTable = ({
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

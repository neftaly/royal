import {
  createRoyalLensSnapshot,
  royalCapabilityBoundaryContract,
  royalLensSchema,
} from '@royal/tarstate-lens/v1';
import { useMemo, type ReactNode } from 'react';
import { royalStores } from '../demo-data';

export const CapabilityLab = (): ReactNode => {
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

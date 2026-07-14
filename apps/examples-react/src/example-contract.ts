import contractJson from '../example-contract.json';
import type { RoyalRendererDiagnosticsSnapshot } from '@royal/react';

export type ExampleContractEntry = {
  readonly id: string;
  readonly maturity: 'lab-probe' | 'product';
  readonly navigation?: boolean;
  readonly path: `/${string}`;
  readonly sourceFile: `examples/cases/${string}.tsx`;
  readonly title: string;
};

export type GltfInstancingCounters = Readonly<Record<string, number>>;

export type GltfLoadDiagnosticsAsset = {
  readonly error?: string;
  readonly imageFailures: number;
  readonly imageLoaded: number;
  readonly imageRequests: number;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: Record<string, number>;
  readonly primitiveCount: number;
  readonly sourceUri: string;
  readonly sourceVersion?: number | string;
  readonly status: string;
  readonly variantCount: number;
};

export type GltfLoadDiagnosticsSnapshot = {
  readonly assets: readonly GltfLoadDiagnosticsAsset[];
  readonly errorAssets: number;
  readonly loadingAssets: number;
  readonly sceneReadyAssets: number;
};

export type RendererLifecycleSnapshot = {
  readonly error?: string;
  readonly generation: number;
  readonly interruptions: number;
  readonly recoveries: number;
  readonly state: 'available' | 'disposed' | 'failed' | 'unavailable';
};

export type RendererBenchmarkSnapshot = {
  readonly frame: number;
  readonly gltfInstancing: GltfInstancingCounters | null;
  readonly gltfLoadDiagnostics: GltfLoadDiagnosticsSnapshot | null;
  readonly lifecycle: RendererLifecycleSnapshot | null;
  readonly planning: Record<string, number> | null;
  readonly resourceGovernor: RoyalRendererDiagnosticsSnapshot['resourceGovernor'] | null;
  readonly resourceLifetime: Record<string, number> | null;
  readonly virtualTexturing: Record<string, number> | null;
};

type ExampleContract = {
  readonly benchmark: {
    readonly bridge: {
      readonly rendererSnapshotGlobal: string;
      readonly renderNowGlobal: string;
    };
    readonly browserGlCounterFields: readonly string[];
    readonly gltfInstancingCounterFields: readonly string[];
    readonly rendererSnapshotFields: readonly (keyof RendererBenchmarkSnapshot)[];
  };
  readonly examples: readonly [ExampleContractEntry, ...ExampleContractEntry[]];
  readonly schema: 'royal-examples-contract';
  readonly version: 1;
};

export const exampleContract = contractJson as unknown as ExampleContract;
export const exampleRoutes = exampleContract.examples;

type BenchmarkBridgeTarget = Record<string, unknown>;

export const readRendererBenchmarkSnapshot = (
  target: BenchmarkBridgeTarget = globalThis as BenchmarkBridgeTarget,
): RendererBenchmarkSnapshot | null => {
  const candidate = target[exampleContract.benchmark.bridge.rendererSnapshotGlobal];
  return typeof candidate === 'function'
    ? (candidate as () => RendererBenchmarkSnapshot | null)()
    : null;
};

export const installRendererBenchmarkBridge = (
  snapshot: () => RendererBenchmarkSnapshot | null,
  renderNow: () => void,
  target: BenchmarkBridgeTarget = globalThis as BenchmarkBridgeTarget,
): (() => void) => {
  const { rendererSnapshotGlobal, renderNowGlobal } = exampleContract.benchmark.bridge;
  target[rendererSnapshotGlobal] = snapshot;
  target[renderNowGlobal] = renderNow;
  return () => {
    if (target[rendererSnapshotGlobal] === snapshot) delete target[rendererSnapshotGlobal];
    if (target[renderNowGlobal] === renderNow) delete target[renderNowGlobal];
  };
};

import contractJson from '../example-contract.json';

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
  readonly imageCandidates: number;
  readonly imageFailures: number;
  readonly imagesLoaded: number;
  readonly imageRequests: number;
  readonly lightCount: number;
  readonly nodeCount: number;
  readonly phaseMs: Record<string, number>;
  readonly primitiveCount: number;
  readonly sceneIndex?: number;
  readonly status: 'degraded' | 'error' | 'idle' | 'loading' | 'ready' | 'streaming';
  readonly src: string;
  readonly variantNames: readonly string[];
  readonly version?: number | string;
};

export type GltfLoadDiagnosticsSnapshot = {
  readonly assets: readonly GltfLoadDiagnosticsAsset[];
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
  readonly resourcePressure: Record<string, number> | null;
  readonly textureResidency: Record<string, number> | null;
  readonly virtualTexturing: Record<string, number> | null;
};

type ExampleContract = {
  readonly benchmark: {
    readonly bridge: {
      readonly rendererSnapshotGlobal: string;
      readonly renderNowGlobal: string;
    };
    readonly browserGlCounterFields: readonly string[];
    readonly gltfExampleIds: readonly string[];
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

/** True once every retained glTF has left scene preparation and settled its requested images. */
export const rendererBenchmarkSnapshotReady = (
  snapshot: RendererBenchmarkSnapshot | null,
  options: Readonly<{ requireGltfAsset?: boolean }> = {},
): boolean => {
  if (snapshot === null) return false;
  const assets = snapshot.gltfLoadDiagnostics?.assets ?? [];
  if (options.requireGltfAsset === true && assets.length === 0) return false;
  const pressure = snapshot.resourcePressure;
  const unsettled = pressure !== null && [
    'activePreparationJobs',
    'activeTextureDecodes',
    'decodeReservations',
    'deferredGeometryUploads',
    'deferredOrdinaryTextureUploads',
    'pendingOrdinaryTextureStorageRepresentations',
    'pendingSurfaceUploads',
    'queuedPreparationJobs',
  ].some((field) => (pressure[field] ?? 0) > 0);
  return !unsettled && assets.every((asset) => asset.status !== 'loading' && (
    asset.status === 'error'
    || asset.imagesLoaded + asset.imageFailures >= asset.imageRequests
  ));
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

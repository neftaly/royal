import manifestJson from './gltf-lab-manifest.json';

export type GltfLabCaseStatus =
  | 'supported-oracle'
  | 'core-fallback-oracle'
  | 'normalized-ingestion'
  | 'parsed-unsupported'
  | 'intentional-out-of-scope'
  | 'known-limitation'
  | 'expected-required-failure';

export type GltfLabCase = {
  readonly bytes: number;
  readonly extensionsRequired: readonly string[];
  readonly features: readonly string[];
  readonly name: string;
  readonly parsed: {
    readonly animations: number;
    readonly morphPrimitives: number;
    readonly skins: number;
  };
  readonly path: string;
  readonly presentation: {
    readonly position?: readonly [number, number, number];
    readonly scale: number;
  };
  readonly provenance: string;
  readonly resources?: readonly {
    readonly bytes: number;
    readonly path: string;
    readonly sha256: string;
  }[];
  readonly sha256: string;
  readonly status: GltfLabCaseStatus;
};

export type GltfLabManifest = {
  readonly cases: readonly GltfLabCase[];
  readonly schema: string;
  readonly source: {
    readonly index: string;
    readonly repository: string;
    readonly revision: string;
  };
};

export const gltfLabManifest = manifestJson as GltfLabManifest;

export const gltfLabCaseByName = new Map(
  gltfLabManifest.cases.map((entry) => [entry.name, entry]),
);

export const runnableGltfLabCases = gltfLabManifest.cases.filter(
  (entry) => entry.status === 'supported-oracle'
    || entry.status === 'core-fallback-oracle'
    || entry.status === 'normalized-ingestion',
);

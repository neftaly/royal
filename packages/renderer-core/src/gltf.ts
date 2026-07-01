import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';
import type { Vec3 } from './primitives';

export interface GltfAssetBounds {
  readonly max: Vec3;
  readonly min: Vec3;
}

export interface GltfAssetRef {
  readonly bounds?: GltfAssetBounds;
  readonly id: string;
  readonly revision?: number | string;
  readonly uri: string;
}

/** glTF asset node loaded from a src URL or explicit asset reference. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  readonly src: string;
  readonly transform?: Transform;
}

export interface GltfExplicitAssetOptions {
  readonly asset: GltfAssetRef;
  readonly assetId?: never;
  readonly bounds?: never;
  readonly id?: never;
  readonly revision?: never;
  readonly src?: never;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  readonly version?: never;
}

export interface GltfSrcOptions {
  readonly asset?: never;
  /** Preferred asset identity override for cache keys; defaults to src. */
  readonly assetId?: string;
  readonly bounds?: GltfAssetBounds;
  /** @deprecated Use assetId. */
  readonly id?: string;
  /** @deprecated Use version. */
  readonly revision?: GltfAssetRef['revision'];
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  /** Preferred asset version override for cache keys. */
  readonly version?: GltfAssetRef['revision'];
}

export type GltfOptions = GltfExplicitAssetOptions | GltfSrcOptions;

export type GltfInput = GltfOptions | GltfSrcOptions['src'];

const gltfOptions = (input: GltfInput): GltfOptions =>
  typeof input === 'string' ? { src: input } : input;

const resolveAsset = (options: GltfOptions): GltfAssetRef => {
  if (options.asset !== undefined) return options.asset;

  const revision = options.version ?? options.revision;

  return {
    ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
    id: options.assetId ?? options.id ?? options.src,
    ...(revision === undefined ? {} : { revision }),
    uri: options.src
  };
};

export function gltf(src: string): GltfNode;
export function gltf(options: GltfSrcOptions): GltfNode;
export function gltf(options: GltfExplicitAssetOptions): GltfNode;
export function gltf(input: GltfInput): GltfNode {
  const options = gltfOptions(input);
  const asset = resolveAsset(options);
  const node = {
    kind: 'gltf',
    asset,
    src: asset.uri
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
}

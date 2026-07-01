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
  readonly uri: string;
  readonly version?: number | string;
}

/** glTF asset node loaded from a source URL. */
export interface GltfNode {
  readonly kind: 'gltf';
  readonly asset: GltfAssetRef;
  readonly src: string;
  readonly transform?: Transform;
}

export interface GltfSrcOptions {
  readonly bounds?: GltfAssetBounds;
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
  /** Preferred asset version override for cache keys. */
  readonly version?: GltfAssetRef['version'];
}

export type GltfOptions = GltfSrcOptions;

export type GltfInput = GltfOptions | GltfSrcOptions['src'];

const gltfOptions = (input: GltfInput): GltfOptions =>
  typeof input === 'string' ? { src: input } : input;

const resolveAsset = (options: GltfOptions): GltfAssetRef => ({
  ...(options.bounds === undefined ? {} : { bounds: options.bounds }),
  uri: options.src,
  ...(options.version === undefined ? {} : { version: options.version })
});

export function gltf(src: string): GltfNode;
export function gltf(options: GltfSrcOptions): GltfNode;
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

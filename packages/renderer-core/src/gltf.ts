import { RenderNodeKind } from './kind';
import {
  resolveTransform,
  type Transform,
  type TransformOptions
} from './primitives';

/** glTF asset node loaded from a URL. */
export interface GltfNode {
  readonly kind: RenderNodeKind.Gltf;
  readonly src: string;
  readonly transform?: Transform;
}

export interface GltfOptions {
  /** glTF asset URL. */
  readonly src: string;
  /** Omit for an identity transform. */
  readonly transform?: TransformOptions;
}

export const gltf = (options: GltfOptions): GltfNode => {
  const node = {
    kind: RenderNodeKind.Gltf,
    src: options.src
  } satisfies Omit<GltfNode, 'transform'>;

  return options.transform === undefined
    ? node
    : { ...node, transform: resolveTransform(options.transform) };
};

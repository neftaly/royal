import type {
  EdgeMaterial,
  ScreenSpaceSegmentNode,
} from "@royal/renderer-core";

export type CanonicalScreenSpaceSegmentRun = Readonly<{
  count: number;
  first: number;
  material: EdgeMaterial;
}>;

export type CanonicalScreenSpaceSegmentScene = Readonly<{
  /** Packed start/end XYZ values, six floats per segment. */
  endpoints: Float32Array;
  runs: readonly CanonicalScreenSpaceSegmentRun[];
}>;

const sameStyle = (left: EdgeMaterial, right: EdgeMaterial): boolean =>
  left.widthCssPixels === right.widthCssPixels
  && left.color.every((value, index) => value === right.color[index])
  && (
    left.coverage === right.coverage
    || (
      left.coverage !== undefined
      && right.coverage !== undefined
      && left.coverage.cellSizeCssPixels === right.coverage.cellSizeCssPixels
      && left.coverage.count === right.coverage.count
      && left.coverage.index === right.coverage.index
    )
  );

/** Pure lowering into one retained endpoint block and consecutive style runs. */
export const prepareCanonicalScreenSpaceSegmentScene = (
  nodes: readonly ScreenSpaceSegmentNode[],
): CanonicalScreenSpaceSegmentScene => {
  const endpoints = new Float32Array(nodes.length * 6);
  const runs: CanonicalScreenSpaceSegmentRun[] = [];
  let activeFirst = 0;
  let activeMaterial: EdgeMaterial | undefined;
  const flush = (end: number): void => {
    if (activeMaterial === undefined || end === activeFirst) return;
    runs.push({ count: end - activeFirst, first: activeFirst, material: activeMaterial });
  };
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!;
    endpoints.set(node.start, index * 6);
    endpoints.set(node.end, index * 6 + 3);
    if (activeMaterial !== undefined && sameStyle(activeMaterial, node.material)) continue;
    flush(index);
    activeFirst = index;
    activeMaterial = node.material;
  }
  flush(nodes.length);
  return { endpoints, runs };
};

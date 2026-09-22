import type { StaticDracoDecodedTask } from "./draco";

export const decodedDracoTaskTransferBuffers = (
  results: readonly StaticDracoDecodedTask[],
): ArrayBuffer[] => {
  const buffers = new Set<ArrayBuffer>();
  for (const result of results) {
    if (result.indices.buffer instanceof ArrayBuffer) buffers.add(result.indices.buffer);
    for (const attribute of result.attributes) {
      if (attribute.values.buffer instanceof ArrayBuffer) buffers.add(attribute.values.buffer);
    }
  }
  return [...buffers];
};

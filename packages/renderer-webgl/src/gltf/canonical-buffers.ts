import {
  array,
  fail,
  index,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

export type CanonicalGltfBuffers = Readonly<{
  binary: Uint8Array;
  document: JsonObject;
}>;

/** Packs multi-buffer glTF data once into the renderer's single cold binary ABI. */
export const canonicalizeGltfBuffers = (
  document: JsonObject,
  sources: readonly Uint8Array[],
  label: string,
): CanonicalGltfBuffers => {
  const buffers = array(document.buffers, label, "buffers");
  if (buffers.length === 0) fail(label, "buffers", "must not be empty");
  if (sources.length !== buffers.length) fail(label, "buffers", "source count does not match");
  const lengths = buffers.map((value, bufferIndex) => {
    const path = `buffers[${bufferIndex}]`;
    const buffer = object(value, label, path);
    const byteLength = nonNegativeInteger(buffer.byteLength, label, `${path}.byteLength`);
    if (sources[bufferIndex]!.byteLength !== byteLength) {
      fail(label, `${path}.byteLength`, "does not match the loaded buffer");
    }
    return byteLength;
  });
  if (sources.length === 1) return { binary: sources[0]!, document };

  const starts = Array.from({ length: sources.length }, () => 0);
  let total = 0;
  for (let bufferIndex = 0; bufferIndex < sources.length; bufferIndex += 1) {
    const start = Math.ceil(total / 4) * 4;
    if (!Number.isSafeInteger(start + lengths[bufferIndex]!)) {
      fail(label, "buffers", "combined byte length is unsafe");
    }
    starts[bufferIndex] = start;
    total = start + lengths[bufferIndex]!;
  }
  let binary: Uint8Array;
  try {
    binary = new Uint8Array(total);
  } catch {
    return fail(label, "buffers", "combined byte length cannot be allocated");
  }
  for (let bufferIndex = 0; bufferIndex < sources.length; bufferIndex += 1) {
    binary.set(sources[bufferIndex]!, starts[bufferIndex]!);
  }

  const bufferViews = optionalArray(document.bufferViews, label, "bufferViews").map(
    (value, viewIndex) => {
      const path = `bufferViews[${viewIndex}]`;
      const view = object(value, label, path);
      const bufferIndex = index(view.buffer, buffers, label, `${path}.buffer`);
      const byteOffset = view.byteOffset === undefined
        ? 0
        : nonNegativeInteger(view.byteOffset, label, `${path}.byteOffset`);
      const byteLength = nonNegativeInteger(view.byteLength, label, `${path}.byteLength`);
      if (
        !Number.isSafeInteger(byteOffset + byteLength)
        || byteOffset + byteLength > lengths[bufferIndex]!
      ) {
        fail(label, path, "exceeds its source buffer");
      }
      return {
        ...view,
        buffer: 0,
        byteOffset: starts[bufferIndex]! + byteOffset,
      };
    },
  );
  const firstBuffer = object(buffers[0], label, "buffers[0]");
  return {
    binary,
    document: {
      ...document,
      buffers: [{ ...firstBuffer, byteLength: total }],
      bufferViews,
    },
  };
};

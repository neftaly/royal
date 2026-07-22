import {
  array,
  fail,
  index,
  nonNegativeInteger,
  object,
  optionalArray,
  type JsonObject,
} from "./gltf-values";

type MeshoptMode = "ATTRIBUTES" | "INDICES" | "TRIANGLES";
type MeshoptFilter = "EXPONENTIAL" | "NONE" | "OCTAHEDRAL" | "QUATERNION";

export type MeshoptBufferViewPlan = Readonly<{
  count: number;
  filter: MeshoptFilter;
  mode: MeshoptMode;
  path: string;
  sourceBuffer: number;
  sourceLength: number;
  sourceOffset: number;
  stride: number;
  targetBuffer: number;
  targetLength: number;
  targetOffset: number;
  viewIndex: number;
}>;

const positiveInteger = (value: unknown, label: string, path: string): number => {
  const result = nonNegativeInteger(value, label, path);
  if (result === 0) fail(label, path, "must be positive");
  return result;
};

const enumValue = <T extends string>(
  value: unknown,
  values: readonly T[],
  label: string,
  path: string,
): T => typeof value === "string" && values.includes(value as T)
  ? value as T
  : fail(label, path, `must be one of ${values.join(", ")}`);

const rangeEnd = (
  offset: number,
  length: number,
  limit: number,
  label: string,
  path: string,
): number => {
  const end = offset + length;
  if (!Number.isSafeInteger(end) || end > limit) fail(label, path, "exceeds its buffer");
  return end;
};

/** Pure validation and decode planning for every meshopt-compressed buffer view. */
export const planMeshoptBufferViews = (
  document: JsonObject,
  label: string,
): readonly MeshoptBufferViewPlan[] => {
  const buffers = array(document.buffers, label, "buffers");
  const bufferViews = optionalArray(document.bufferViews, label, "bufferViews");
  const bufferLengths = buffers.map((value, bufferIndex) => nonNegativeInteger(
    object(value, label, `buffers[${bufferIndex}]`).byteLength,
    label,
    `buffers[${bufferIndex}].byteLength`,
  ));
  const plans: MeshoptBufferViewPlan[] = [];

  for (let viewIndex = 0; viewIndex < bufferViews.length; viewIndex += 1) {
    const path = `bufferViews[${viewIndex}]`;
    const view = object(bufferViews[viewIndex], label, path);
    const extensions = view.extensions === undefined
      ? undefined
      : object(view.extensions, label, `${path}.extensions`);
    if (extensions?.EXT_meshopt_compression === undefined) continue;
    const extensionPath = `${path}.extensions.EXT_meshopt_compression`;
    const extension = object(
      extensions.EXT_meshopt_compression,
      label,
      extensionPath,
    );
    const targetBuffer = index(view.buffer, buffers, label, `${path}.buffer`);
    const targetOffset = view.byteOffset === undefined
      ? 0
      : nonNegativeInteger(view.byteOffset, label, `${path}.byteOffset`);
    const targetLength = nonNegativeInteger(view.byteLength, label, `${path}.byteLength`);
    rangeEnd(targetOffset, targetLength, bufferLengths[targetBuffer]!, label, path);
    const sourceBuffer = index(
      extension.buffer,
      buffers,
      label,
      `${extensionPath}.buffer`,
    );
    const sourceOffset = extension.byteOffset === undefined
      ? 0
      : nonNegativeInteger(extension.byteOffset, label, `${extensionPath}.byteOffset`);
    const sourceLength = positiveInteger(
      extension.byteLength,
      label,
      `${extensionPath}.byteLength`,
    );
    rangeEnd(
      sourceOffset,
      sourceLength,
      bufferLengths[sourceBuffer]!,
      label,
      extensionPath,
    );
    const stride = positiveInteger(
      extension.byteStride,
      label,
      `${extensionPath}.byteStride`,
    );
    const count = positiveInteger(extension.count, label, `${extensionPath}.count`);
    const mode = enumValue(
      extension.mode,
      ["ATTRIBUTES", "TRIANGLES", "INDICES"] as const,
      label,
      `${extensionPath}.mode`,
    );
    const filter = extension.filter === undefined
      ? "NONE"
      : enumValue(
        extension.filter,
        ["NONE", "OCTAHEDRAL", "QUATERNION", "EXPONENTIAL"] as const,
        label,
        `${extensionPath}.filter`,
      );
    const decodedLength = count * stride;
    if (!Number.isSafeInteger(decodedLength) || decodedLength !== targetLength) {
      fail(label, `${path}.byteLength`, "must equal meshopt count times byteStride");
    }
    if (view.byteStride !== undefined) {
      const parentStride = positiveInteger(view.byteStride, label, `${path}.byteStride`);
      if (parentStride !== stride) {
        fail(label, `${path}.byteStride`, "must match meshopt byteStride");
      }
    }
    if (mode === "ATTRIBUTES") {
      if (stride % 4 !== 0 || stride > 256) {
        fail(label, `${extensionPath}.byteStride`, "must be divisible by 4 and at most 256 for ATTRIBUTES");
      }
    } else {
      if (stride !== 2 && stride !== 4) {
        fail(label, `${extensionPath}.byteStride`, "must be 2 or 4 for index data");
      }
      if (filter !== "NONE") {
        fail(label, `${extensionPath}.filter`, "must be NONE for index data");
      }
      if (mode === "TRIANGLES" && count % 3 !== 0) {
        fail(label, `${extensionPath}.count`, "must be divisible by 3 for TRIANGLES");
      }
    }
    if (filter === "OCTAHEDRAL" && stride !== 4 && stride !== 8) {
      fail(label, `${extensionPath}.byteStride`, "must be 4 or 8 for OCTAHEDRAL");
    }
    if (filter === "QUATERNION" && stride !== 8) {
      fail(label, `${extensionPath}.byteStride`, "must be 8 for QUATERNION");
    }
    if (filter === "EXPONENTIAL" && stride % 4 !== 0) {
      fail(label, `${extensionPath}.byteStride`, "must be divisible by 4 for EXPONENTIAL");
    }
    plans.push({
      count,
      filter,
      mode,
      path: extensionPath,
      sourceBuffer,
      sourceLength,
      sourceOffset,
      stride,
      targetBuffer,
      targetLength,
      targetOffset,
      viewIndex,
    });
  }
  return plans;
};

/** Validates and identifies placeholder fallback buffers that need no resource read. */
export const meshoptFallbackBufferIndices = (
  document: JsonObject,
  label: string,
  glbBinaryBufferIndex?: number,
): ReadonlySet<number> => {
  const buffers = array(document.buffers, label, "buffers");
  const views = optionalArray(document.bufferViews, label, "bufferViews");
  const plans = planMeshoptBufferViews(document, label);
  const sourceBuffers = new Set(plans.map((plan) => plan.sourceBuffer));
  const targetBuffers = new Set(plans.map((plan) => plan.targetBuffer));
  const fallback = new Set<number>();
  for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
    const path = `buffers[${bufferIndex}]`;
    const buffer = object(buffers[bufferIndex], label, path);
    const extensions = buffer.extensions === undefined
      ? undefined
      : object(buffer.extensions, label, `${path}.extensions`);
    const marker = extensions?.EXT_meshopt_compression;
    if (marker !== undefined) {
      const extension = object(marker, label, `${path}.extensions.EXT_meshopt_compression`);
      if (extension.fallback !== true) {
        fail(label, `${path}.extensions.EXT_meshopt_compression.fallback`, "must be true");
      }
      fallback.add(bufferIndex);
    } else if (
      bufferIndex !== glbBinaryBufferIndex
      && buffer.uri === undefined
      && targetBuffers.has(bufferIndex)
    ) {
      // The marker is recommended but optional in the ratified extension.
      fallback.add(bufferIndex);
    }
    if (!fallback.has(bufferIndex)) continue;
    if (sourceBuffers.has(bufferIndex)) {
      fail(label, path, "meshopt compressed data cannot source a fallback buffer");
    }
  }
  for (let viewIndex = 0; viewIndex < views.length; viewIndex += 1) {
    const path = `bufferViews[${viewIndex}]`;
    const view = object(views[viewIndex], label, path);
    const bufferIndex = index(view.buffer, buffers, label, `${path}.buffer`);
    if (!fallback.has(bufferIndex)) continue;
    const extensions = view.extensions === undefined
      ? undefined
      : object(view.extensions, label, `${path}.extensions`);
    if (extensions?.EXT_meshopt_compression === undefined) {
      fail(label, `${path}.buffer`, "fallback buffers may only be referenced by meshopt bufferViews");
    }
  }
  return fallback;
};

const rangesOverlap = (leftOffset: number, leftLength: number, rightOffset: number, rightLength: number): boolean =>
  leftOffset < rightOffset + rightLength && rightOffset < leftOffset + leftLength;

/** Effect shell: lazily loads one decoder and fills only selected canonical inputs. */
export const decodeSelectedMeshoptBufferViews = async (
  document: JsonObject,
  sources: readonly Uint8Array[],
  selectedViews: ReadonlySet<number>,
  label: string,
): Promise<void> => {
  const plans = planMeshoptBufferViews(document, label)
    .filter((plan) => selectedViews.has(plan.viewIndex));
  if (plans.length === 0) return;
  const buffers = array(document.buffers, label, "buffers");
  if (sources.length !== buffers.length) fail(label, "buffers", "source count does not match");
  for (let bufferIndex = 0; bufferIndex < buffers.length; bufferIndex += 1) {
    const path = `buffers[${bufferIndex}]`;
    const byteLength = nonNegativeInteger(
      object(buffers[bufferIndex], label, path).byteLength,
      label,
      `${path}.byteLength`,
    );
    if (sources[bufferIndex]!.byteLength !== byteLength) {
      fail(label, `${path}.byteLength`, "does not match the loaded buffer");
    }
  }
  const { MeshoptDecoder } = await import("meshoptimizer/decoder");
  await MeshoptDecoder.ready;
  if (!MeshoptDecoder.supported) {
    fail(label, "extensions.EXT_meshopt_compression", "decoder is unavailable");
  }
  for (const plan of plans) {
    const targetSource = sources[plan.targetBuffer]
      ?? fail(label, plan.path, "target buffer was not loaded");
    const compressedSource = sources[plan.sourceBuffer]
      ?? fail(label, plan.path, "source buffer was not loaded");
    const target = targetSource.subarray(
      plan.targetOffset,
      plan.targetOffset + plan.targetLength,
    );
    const compressedView = compressedSource.subarray(
      plan.sourceOffset,
      plan.sourceOffset + plan.sourceLength,
    );
    const source = targetSource.buffer === compressedSource.buffer
      && rangesOverlap(
        targetSource.byteOffset + plan.targetOffset,
        plan.targetLength,
        compressedSource.byteOffset + plan.sourceOffset,
        plan.sourceLength,
      )
      ? compressedView.slice()
      : compressedView;
    try {
      MeshoptDecoder.decodeGltfBuffer(
        target,
        plan.count,
        plan.stride,
        source,
        plan.mode,
        plan.filter,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      fail(
        label,
        plan.path,
        `compressed payload is invalid (${source.byteLength} bytes, header ${source[0]}): ${detail}`,
      );
    }
  }
};

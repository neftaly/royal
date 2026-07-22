import type { StaticGltfResourceRequest } from "./static-buffer-demand";

const readCompleteResource = async (
  uri: string,
  signal: AbortSignal,
): Promise<Uint8Array> => {
  const response = await fetch(uri, { signal });
  if (!response.ok) {
    throw new Error(`glTF resource ${JSON.stringify(uri)} failed with HTTP ${response.status}`);
  }
  return new Uint8Array(await response.arrayBuffer());
};

/** Browser transport shell for a pure selected-scene byte-demand plan. */
export const readGltfResourceRangesWithFetch = async (
  uri: string,
  signal: AbortSignal,
  request: StaticGltfResourceRequest,
): Promise<Uint8Array> => {
  if (request.ranges.length === 0) return new Uint8Array(request.byteLength);

  const output = new Uint8Array(request.byteLength);
  const readRange = async (
    range: StaticGltfResourceRequest["ranges"][number],
  ): Promise<"complete" | "partial"> => {
    const lastByte = range.byteOffset + range.byteLength - 1;
    const response = await fetch(uri, {
      headers: { Range: `bytes=${range.byteOffset}-${lastByte}` },
      signal,
    });
    if (response.status === 200) {
      const complete = new Uint8Array(await response.arrayBuffer());
      if (complete.byteLength !== request.byteLength) {
        throw new Error(
          `glTF resource ${JSON.stringify(uri)} ignored a byte range but returned ${complete.byteLength} of ${request.byteLength} bytes`,
        );
      }
      output.set(complete);
      return "complete";
    }
    if (response.status !== 206) {
      throw new Error(
        `glTF resource ${JSON.stringify(uri)} range fetch failed with HTTP ${response.status}`,
      );
    }
    const expectedContentRange = `bytes ${range.byteOffset}-${lastByte}/${request.byteLength}`;
    if (response.headers.get("Content-Range") !== expectedContentRange) {
      throw new Error(
        `glTF resource ${JSON.stringify(uri)} returned an invalid Content-Range`,
      );
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength !== range.byteLength) {
      throw new Error(
        `glTF resource ${JSON.stringify(uri)} range returned ${bytes.byteLength} bytes; expected ${range.byteLength}`,
      );
    }
    output.set(bytes, range.byteOffset);
    return "partial";
  };

  try {
    const [first, ...remaining] = request.ranges;
    if (await readRange(first!) === "complete") return output;
    await Promise.all(remaining.map(readRange));
    return output;
  } catch (error) {
    if (signal.aborted) throw error;
    return readCompleteResource(uri, signal);
  }
};

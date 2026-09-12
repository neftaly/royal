/** Check the browser's origin flag without synchronously reading GPU pixels.
 * A one-pixel bitmap inherits the source flag; transferring it rejects tainted
 * images. Only our temporary bitmap is detached, never the caller's source.
 */
export const proveOriginClean = async (source: CanvasImageSource): Promise<void> => {
  const probe = await createImageBitmap(source, 0, 0, 1, 1);
  try {
    structuredClone(probe, { transfer: [probe] }).close();
  } finally {
    probe.close();
  }
};

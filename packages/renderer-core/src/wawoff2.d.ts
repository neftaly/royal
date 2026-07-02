declare module 'wawoff2/decompress' {
  const decompress: (buffer: Uint8Array) => Promise<Uint8Array>;
  export default decompress;
}

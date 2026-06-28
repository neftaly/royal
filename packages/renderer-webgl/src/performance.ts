const gltfMark = (name: string): string => `royal:renderer:gltf:${name}`;

export const markGltf = (name: string): void => {
  globalThis.performance?.mark(gltfMark(name));
};

export const measureGltf = (
  name: string,
  startMark: string,
  endMark: string,
): void => {
  globalThis.performance?.measure(
    gltfMark(name),
    gltfMark(startMark),
    gltfMark(endMark),
  );
};

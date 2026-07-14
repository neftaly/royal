import { describe, expect, it } from "vitest";
import { resolveResourceUri } from "../packages/renderer-webgl/src/resource-io";

describe("renderer resource URI resolution", () => {
  it.each([
    ["https://example.test/models/ship.gltf", "../textures/hull.png", "https://example.test/textures/hull.png"],
    ["https://example.test/models/ship.gltf?version=1", "?version=2", "https://example.test/models/ship.gltf?version=2"],
    ["https://example.test/models/ship.gltf?version=1", "#mesh", "https://example.test/models/ship.gltf?version=1#mesh"],
    ["//cdn.example.test/models/ship.gltf", "../hull.ktx2", "//cdn.example.test/hull.ktx2"],
    ["assets/models/ship.gltf", "../hull.png", "assets/models/../hull.png"],
    ["assets/models/ship.gltf?version=1", "?version=2", "assets/models/ship.gltf?version=2"],
    ["assets/models/ship.gltf?version=1", "#mesh", "assets/models/ship.gltf?version=1#mesh"],
    ["/models/ship.gltf", "/shared/hull.png", "/shared/hull.png"],
    ["/models/ship.gltf", "data:image/png;base64,AA==", "data:image/png;base64,AA=="],
  ])("resolves %s plus %s", (base, relative, expected) => {
    expect(resolveResourceUri(base, relative)).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import { selectBenchmarkRouteFilter } from "../../apps/examples-react/scripts/benchmark-route-selection.mjs";

const routes = [
  { id: "gltf-scenes", path: "/gltf-scenes" },
  { id: "gltf-scenes-beautiful-game", path: "/gltf-scenes?scene=a-beautiful-game" },
  { id: "gltf-scenes-virtual-city", path: "/gltf-scenes?scene=virtual-city" },
] as const;

describe("examples benchmark route selection", () => {
  it("prefers an exact ID or path over its prefixed route family", () => {
    expect(selectBenchmarkRouteFilter(routes, "gltf-scenes")).toEqual([routes[0]]);
    expect(selectBenchmarkRouteFilter(routes, "/gltf-scenes")).toEqual([routes[0]]);
  });

  it("retains prefix selection when no exact route exists", () => {
    expect(selectBenchmarkRouteFilter(routes, "gltf-scenes-missing")).toEqual([]);
    expect(selectBenchmarkRouteFilter(routes, "gltf")).toEqual(routes);
  });
});

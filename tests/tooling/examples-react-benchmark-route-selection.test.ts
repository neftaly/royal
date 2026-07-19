import { describe, expect, it } from "vitest";
import {
  mergeBenchmarkRouteSearch,
  selectBenchmarkRouteFilter,
} from "../../apps/examples-react/scripts/benchmark-route-selection.mjs";

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

describe("examples benchmark route search", () => {
  it("overrides scenario fields while preserving unrelated route search", () => {
    expect(mergeBenchmarkRouteSearch(
      "/gltf-scenes?quality=web&scene=sponza",
      "scene=a-beautiful-game&camera=close",
    )).toBe("/gltf-scenes?quality=web&scene=a-beautiful-game&camera=close");
  });

  it("reserves benchmark run identity for the harness", () => {
    expect(() => mergeBenchmarkRouteSearch(
      "/cube",
      "__royalBenchRun=caller",
    )).toThrow("EXAMPLES_BENCH_ROUTE_SEARCH must not set __royalBenchRun");
  });
});

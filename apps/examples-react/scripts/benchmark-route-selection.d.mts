export type BenchmarkRoute = Readonly<{
  id: string;
  path: string;
}>;

export function selectBenchmarkRouteFilter<Route extends BenchmarkRoute>(
  routes: readonly Route[],
  filter: string,
): Route[];

export function mergeBenchmarkRouteSearch(path: string, configuredSearch: string): string;

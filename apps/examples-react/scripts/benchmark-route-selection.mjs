const exactRouteMatch = (route, filter) => (
  route.id === filter
  || route.path === filter
  || route.path === `/${filter}`
);

/** Pure route-filter projection; exact IDs and paths take precedence over ID families. */
export const selectBenchmarkRouteFilter = (routes, filter) => {
  const exact = routes.filter((route) => exactRouteMatch(route, filter));
  if (exact.length > 0) return exact;
  return routes.filter((route) => route.id.startsWith(`${filter}-`));
};

/** Adds an opt-in scenario query without allowing callers to replace run identity. */
export const mergeBenchmarkRouteSearch = (path, configuredSearch) => {
  const configured = new URLSearchParams(configuredSearch);
  if (configured.has('__royalBenchRun')) {
    throw new Error('EXAMPLES_BENCH_ROUTE_SEARCH must not set __royalBenchRun');
  }
  const url = new URL(path, 'https://royal.invalid');
  for (const [name, value] of configured) url.searchParams.set(name, value);
  return `${url.pathname}${url.search}${url.hash}`;
};

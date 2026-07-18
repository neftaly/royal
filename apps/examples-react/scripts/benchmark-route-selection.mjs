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

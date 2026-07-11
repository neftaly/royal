const basePath = import.meta.env.BASE_URL === '/'
  ? ''
  : import.meta.env.BASE_URL.replace(/\/$/, '');

export const exampleHref = (path: string): string => `${basePath}${path}` || '/';

export const pathWithinExamplesBase = (pathname: string): string | undefined => {
  if (basePath === '') return pathname;
  if (pathname === basePath || pathname === `${basePath}/`) return '/';
  return pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length) : undefined;
};

export const abortError = (): DOMException =>
  new DOMException("The operation was aborted", "AbortError");

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw abortError();
};

export const resolveResourceUri = (base: string, relative: string): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(relative)) return relative;
  const index = base.lastIndexOf("/");
  return `${index < 0 ? "" : base.slice(0, index + 1)}${relative}`;
};

export const abortError = (): DOMException =>
  new DOMException("The operation was aborted", "AbortError");

export const throwIfAborted = (signal: AbortSignal | undefined): void => {
  if (signal?.aborted === true) throw abortError();
};

export const resolveResourceUri = (base: string, relative: string): string => {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/iu.test(relative)) return relative;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(base)) {
    try {
      return new URL(relative, base).href;
    } catch {
      // Opaque schemes such as data: cannot resolve a relative reference.
    }
  } else if (base.startsWith("//")) {
    return new URL(relative, `https:${base}`).href.slice("https:".length);
  }

  const baseWithoutFragment = base.split("#", 1)[0]!;
  if (relative.startsWith("#")) return `${baseWithoutFragment}${relative}`;
  const basePath = baseWithoutFragment.split("?", 1)[0]!;
  if (relative.startsWith("?")) return `${basePath}${relative}`;
  const index = basePath.lastIndexOf("/");
  return `${index < 0 ? "" : basePath.slice(0, index + 1)}${relative}`;
};

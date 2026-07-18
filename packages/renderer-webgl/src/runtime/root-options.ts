export type CanvasRootOptions = Readonly<{
  /** Requests an alpha channel when creating the WebGL2 context. @defaultValue `true` */
  alpha?: boolean;
  /** Requests browser antialiasing when creating the WebGL2 context. @defaultValue `true` */
  antialias?: boolean;
}>;

/** Validates immutable root options and returns their stable semantic identity. */
export const rendererRootOptionsSemanticKey = (options: CanvasRootOptions = {}): string => {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new TypeError("Royal renderer options must be an object");
  }
  for (const key of Reflect.ownKeys(options)) {
    if (key !== "alpha" && key !== "antialias") {
      throw new TypeError(`Royal renderer options contain unsupported field ${String(key)}`);
    }
  }
  if (options.alpha !== undefined && typeof options.alpha !== "boolean") {
    throw new TypeError("Royal renderer option alpha must be a boolean");
  }
  if (options.antialias !== undefined && typeof options.antialias !== "boolean") {
    throw new TypeError("Royal renderer option antialias must be a boolean");
  }
  return `${options.alpha === false ? 0 : 1}${options.antialias === false ? 0 : 1}`;
};

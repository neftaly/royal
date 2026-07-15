import { objectWithAllowedFields } from "./option-values";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const RENDER_VIEW_FIELDS = ["projectionMatrix", "viewMatrix", "viewport"] as const;
const RENDER_VIEWPORT_FIELDS = ["height", "width", "x", "y"] as const;

const isFiniteMat4 = (value: unknown): value is ArrayLike<number> => {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  const matrix = value as ArrayLike<unknown>;
  if (matrix.length !== 16) return false;
  for (let index = 0; index < 16; index += 1) {
    if (typeof matrix[index] !== "number" || !Number.isFinite(matrix[index])) return false;
  }
  return true;
};

const isViewportInteger = (value: unknown, minimum: number): value is number =>
  typeof value === "number"
  && Number.isInteger(value)
  && value >= minimum
  && value <= 0x7fff_ffff;

/** Pure strict preflight used before renderViews mutates retained scene state. */
export const validateWebGlRenderViewsOptions = (value: unknown): void => {
  const options = objectWithAllowedFields(
    value,
    ["framebuffer", "views"],
    "Royal renderViews options",
  );
  const { framebuffer, views } = options;
  if (!Array.isArray(views) || views.length === 0) {
    throw new RangeError("Royal renderViews views must be a non-empty array");
  }
  if (
    framebuffer !== undefined
    && framebuffer !== null
    && (!isRecord(framebuffer))
  ) throw new TypeError("Royal renderViews framebuffer must be a WebGLFramebuffer or null");

  for (let index = 0; index < views.length; index += 1) {
    const view = objectWithAllowedFields(
      views[index],
      RENDER_VIEW_FIELDS,
      `Royal renderViews view ${index}`,
      "field",
    );
    if (!isFiniteMat4(view.projectionMatrix) || !isFiniteMat4(view.viewMatrix)) {
      throw new TypeError(`Royal renderViews view ${index} matrices must be finite 4x4 arrays`);
    }
    const viewport = objectWithAllowedFields(
      view.viewport,
      RENDER_VIEWPORT_FIELDS,
      `Royal renderViews view ${index} viewport`,
      "field",
    );
    if (
      !isViewportInteger(viewport.x, -0x8000_0000)
      || !isViewportInteger(viewport.y, -0x8000_0000)
      || !isViewportInteger(viewport.width, 1)
      || !isViewportInteger(viewport.height, 1)
    ) throw new RangeError(`Royal renderViews view ${index} viewport must use signed 32-bit pixels and positive size`);
  }
};

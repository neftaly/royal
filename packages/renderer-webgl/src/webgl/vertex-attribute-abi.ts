/**
 * Private vertex-input ABI shared by every Royal draw program.
 *
 * WebGL2 guarantees at least 16 vertex attributes. Royal requires WebGL2 and
 * deliberately occupies locations 0 through 12, so there is no reduced-layout
 * fallback. Keep the GLSL `layout(location = ...)` declarations in sync with
 * this table.
 */
export const VERTEX_ATTRIBUTE = Object.freeze({
  position: 0,
  normal: 1,
  tangent: 2,
  instanceLocalModelFirstColumn: 3,
  instancePosition: 7,
  instanceRotation: 8,
  instanceScale: 9,
  texCoord0: 10,
  texCoord1: 11,
  color: 12,
} as const);

export const VERTEX_ATTRIBUTE_COUNT = 13;

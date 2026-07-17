/**
 * Private vertex-input ABI shared by every Royal draw program.
 *
 * WebGL2 guarantees at least 16 vertex attributes. Royal requires WebGL2 and
 * occupies locations 0 through 9, so there is no reduced-layout
 * fallback. Keep the GLSL `layout(location = ...)` declarations in sync with
 * this table.
 */
export const VERTEX_ATTRIBUTE = Object.freeze({
  position: 0,
  normal: 1,
  tangent: 2,
  instanceModelFirstColumn: 3,
  texCoord0: 7,
  texCoord1: 8,
  color: 9,
} as const);

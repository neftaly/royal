import { describe, expect, it } from "vitest";

import { orthographic } from "../src/matrix";

describe("matrix helpers", () => {
  it("builds an orthographic projection matrix", () => {
    const matrix = orthographic(-2, 2, -1, 1, 0.1, 10);

    expect(matrix[0]).toBeCloseTo(0.5);
    expect(matrix[5]).toBeCloseTo(1);
    expect(matrix[10]).toBeCloseTo(-2 / 9.9);
    expect(matrix[12]).toBeCloseTo(0);
    expect(matrix[13]).toBeCloseTo(0);
    expect(matrix[14]).toBeCloseTo(-10.1 / 9.9);
  });
});

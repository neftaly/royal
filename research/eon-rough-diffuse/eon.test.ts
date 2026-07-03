import { describe, expect, it } from "vitest";
import {
  eonBrdf,
  eonDirectionalAlbedo,
  fonAverageAlbedo,
  fonDirectionalAlbedoApprox,
  fonDirectionalAlbedoExact,
  integrateDirectionalAlbedo,
  lambertBrdf,
  localDirectionFromCosTheta,
  type Rgb,
  type Vec3,
} from "./eon";

const expectClose = (actual: number, expected: number, tolerance = 1e-6): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
};

const expectRgbClose = (actual: Rgb, expected: Rgb, tolerance = 1e-6): void => {
  expectClose(actual[0], expected[0], tolerance);
  expectClose(actual[1], expected[1], tolerance);
  expectClose(actual[2], expected[2], tolerance);
};

describe("EON rough diffuse research prototype", () => {
  it("matches Lambert in the smooth limit", () => {
    const rho: Rgb = [0.8, 0.5, 0.2];
    const wi: Vec3 = localDirectionFromCosTheta(0.35, 0.4);
    const wo: Vec3 = localDirectionFromCosTheta(0.72, 1.9);

    expectRgbClose(eonBrdf(rho, 0, wi, wo, { exact: true }), lambertBrdf(rho));
    expectRgbClose(eonDirectionalAlbedo(rho, 0, wi, { exact: true }), rho);
  });

  it("keeps white directional albedo energy preserving over roughness and angles", () => {
    const white: Rgb = [1, 1, 1];

    for (const roughness of [0, 0.1, 0.35, 0.7, 1]) {
      for (const mu of [0.02, 0.12, 0.35, 0.7, 1]) {
        const albedo = eonDirectionalAlbedo(white, roughness, localDirectionFromCosTheta(mu, 0.3), {
          exact: true,
        });

        expectRgbClose(albedo, white, 1e-6);
      }
    }
  });

  it("numerically integrates close to the analytic directional albedo", () => {
    const rho: Rgb = [0.85, 0.55, 0.2];
    const roughness = 0.9;
    const wo = localDirectionFromCosTheta(0.28, 0.15);
    const integrated = integrateDirectionalAlbedo((wi) => eonBrdf(rho, roughness, wi, wo, { exact: true }));
    const analytic = eonDirectionalAlbedo(rho, roughness, wo, { exact: true });

    expectRgbClose(integrated, analytic, 7e-4);
  });

  it("has sane monotonic energy compensation as roughness increases", () => {
    let previousFonAverage = 1;
    const white: Rgb = [1, 1, 1];
    const wo = localDirectionFromCosTheta(0.45, 1.3);

    for (const roughness of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const average = fonAverageAlbedo(roughness);
      expect(average).toBeLessThanOrEqual(previousFonAverage + 1e-12);
      previousFonAverage = average;

      const albedo = eonDirectionalAlbedo(white, roughness, wo, { exact: true });
      expectClose(albedo[0], 1);
    }
  });

  it("raises the rough backscatter lobe while preserving reciprocity", () => {
    const rho: Rgb = [1, 1, 1];
    const wi = localDirectionFromCosTheta(0.18, 0);
    const wo = localDirectionFromCosTheta(0.18, 0);
    const smooth = eonBrdf(rho, 0, wi, wo, { exact: true })[0];
    const rough = eonBrdf(rho, 1, wi, wo, { exact: true })[0];
    const reversed = eonBrdf(rho, 1, wo, wi, { exact: true })[0];

    expect(rough).toBeGreaterThan(smooth);
    expectClose(rough, reversed);
  });

  it("keeps the approximate FON albedo within the paper's stated fitting error", () => {
    for (const roughness of [0, 0.25, 0.5, 0.75, 1]) {
      for (const mu of [0, 0.03, 0.1, 0.25, 0.5, 0.75, 1]) {
        const exact = fonDirectionalAlbedoExact(mu, roughness);
        const approx = fonDirectionalAlbedoApprox(mu, roughness);

        expect(Math.abs(exact - approx)).toBeLessThan(0.0015);
      }
    }
  });
});

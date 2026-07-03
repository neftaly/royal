export type Vec3 = readonly [number, number, number];
export type Rgb = readonly [number, number, number];

export const PI = Math.PI;
export const INV_PI = 1 / Math.PI;

export const FON_CONSTANT_1 = 0.5 - 2 / (3 * Math.PI);
export const FON_CONSTANT_2 = 2 / 3 - 28 / (15 * Math.PI);

const FON_G_APPROX = {
  g1: 0.0571085289,
  g2: 0.491881867,
  g3: -0.332181442,
  g4: 0.0714429953,
} as const;

const EPSILON = 1e-7;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const square = (value: number): number => value * value;

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const lambertBrdf = (rho: Rgb): Rgb => [
  rho[0] * INV_PI,
  rho[1] * INV_PI,
  rho[2] * INV_PI,
];

export const fonCoefficients = (roughness: number): { AF: number; BF: number } => {
  const r = clamp01(roughness);
  const AF = 1 / (1 + FON_CONSTANT_1 * r);

  return { AF, BF: r * AF };
};

export const fonDirectionalAlbedoExact = (mu: number, roughness: number): number => {
  const r = clamp01(roughness);
  const { AF, BF } = fonCoefficients(r);
  const clampedMu = clamp01(mu);

  if (clampedMu <= EPSILON) {
    return AF + BF * INV_PI * (PI / 2 - 2 / 3);
  }

  const sinTheta = Math.sqrt(Math.max(0, 1 - clampedMu * clampedMu));
  const g =
    sinTheta * (Math.acos(clampedMu) - sinTheta * clampedMu) +
    (2 / 3) * ((sinTheta / clampedMu) * (1 - sinTheta * sinTheta * sinTheta) - sinTheta);

  return AF + BF * INV_PI * g;
};

export const fonDirectionalAlbedoApprox = (mu: number, roughness: number): number => {
  const r = clamp01(roughness);
  const muComp = 1 - clamp01(mu);
  const { g1, g2, g3, g4 } = FON_G_APPROX;
  const gOverPi = muComp * (g1 + muComp * (g2 + muComp * (g3 + muComp * g4)));

  return (1 + r * gOverPi) / (1 + FON_CONSTANT_1 * r);
};

export const fonAverageAlbedo = (roughness: number): number => {
  const r = clamp01(roughness);
  const { AF } = fonCoefficients(r);

  return AF * (1 + FON_CONSTANT_2 * r);
};

export const eonBrdf = (
  rho: Rgb,
  roughness: number,
  wiLocal: Vec3,
  woLocal: Vec3,
  options: { exact?: boolean } = {},
): Rgb => {
  const muI = wiLocal[2];
  const muO = woLocal[2];

  if (muI <= 0 || muO <= 0) {
    return [0, 0, 0];
  }

  const r = clamp01(roughness);
  const { AF } = fonCoefficients(r);
  const s = dot(wiLocal, woLocal) - muI * muO;
  const sOverTF = s > 0 ? s / Math.max(muI, muO) : s;
  const singleScatterScale = INV_PI * AF * (1 + r * sOverTF);
  const albedo = options.exact === true ? fonDirectionalAlbedoExact : fonDirectionalAlbedoApprox;
  const EFo = albedo(muO, r);
  const EFi = albedo(muI, r);
  const averageEF = fonAverageAlbedo(r);
  const multipleScatterShape =
    (Math.max(EPSILON, 1 - EFo) * Math.max(EPSILON, 1 - EFi)) /
    Math.max(EPSILON, 1 - averageEF);

  return [
    eonChannel(rho[0], averageEF, singleScatterScale, multipleScatterShape),
    eonChannel(rho[1], averageEF, singleScatterScale, multipleScatterShape),
    eonChannel(rho[2], averageEF, singleScatterScale, multipleScatterShape),
  ];
};

export const eonDirectionalAlbedo = (
  rho: Rgb,
  roughness: number,
  wiLocal: Vec3,
  options: { exact?: boolean } = {},
): Rgb => {
  const muI = clamp01(wiLocal[2]);
  const r = clamp01(roughness);
  const EF = options.exact === true ? fonDirectionalAlbedoExact(muI, r) : fonDirectionalAlbedoApprox(muI, r);
  const averageEF = fonAverageAlbedo(r);

  return [
    eonAlbedoChannel(rho[0], EF, averageEF),
    eonAlbedoChannel(rho[1], EF, averageEF),
    eonAlbedoChannel(rho[2], EF, averageEF),
  ];
};

const eonChannel = (
  rho: number,
  averageEF: number,
  singleScatterScale: number,
  multipleScatterShape: number,
): number => {
  const rhoMs = multipleScatterAlbedo(rho, averageEF);

  return rho * singleScatterScale + rhoMs * INV_PI * multipleScatterShape;
};

const eonAlbedoChannel = (rho: number, EF: number, averageEF: number): number => {
  const rhoMs = multipleScatterAlbedo(rho, averageEF);

  return rho * EF + rhoMs * (1 - EF);
};

const multipleScatterAlbedo = (rho: number, averageEF: number): number => {
  const clampedRho = clamp01(rho);

  return (square(clampedRho) * averageEF) / Math.max(EPSILON, 1 - clampedRho * (1 - averageEF));
};

export const localDirectionFromCosTheta = (mu: number, phi: number): Vec3 => {
  const z = clamp01(mu);
  const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));

  return [sinTheta * Math.cos(phi), sinTheta * Math.sin(phi), z];
};

export const integrateDirectionalAlbedo = (
  brdf: (wiLocal: Vec3) => Rgb,
  sampleCountTheta = 96,
  sampleCountPhi = 192,
): Rgb => {
  let r = 0;
  let g = 0;
  let b = 0;
  const deltaMu = 1 / sampleCountTheta;
  const deltaPhi = (2 * PI) / sampleCountPhi;

  for (let thetaIndex = 0; thetaIndex < sampleCountTheta; thetaIndex += 1) {
    const mu = (thetaIndex + 0.5) * deltaMu;

    for (let phiIndex = 0; phiIndex < sampleCountPhi; phiIndex += 1) {
      const wi = localDirectionFromCosTheta(mu, (phiIndex + 0.5) * deltaPhi);
      const value = brdf(wi);
      const projectedSolidAngle = mu * deltaMu * deltaPhi;
      r += value[0] * projectedSolidAngle;
      g += value[1] * projectedSolidAngle;
      b += value[2] * projectedSolidAngle;
    }
  }

  return [r, g, b];
};

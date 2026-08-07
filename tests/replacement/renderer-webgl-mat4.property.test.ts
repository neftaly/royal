import { orbitCameraTransform, perspectiveCamera } from "@royal/renderer-core";
import { Euler, Matrix4 } from "three";
import { describe, expect, it } from "vitest";
import {
  identityMat4,
  inverseMat4Into,
  multiplyMat4Into,
  quaternionMat4,
  rotationXMat4,
  transformMat4,
  transformPointInto,
  viewMat4,
  viewMat4Into,
} from "../../packages/renderer-webgl/src/math/mat4";
import { forEachFuzzCase } from "../fuzz";

const expectIdentity = (matrix: readonly number[]): void => {
  for (let index = 0; index < 16; index += 1) {
    expect(matrix[index]).toBeCloseTo(index % 5 === 0 ? 1 : 0, 9);
  }
};

describe("retained matrix core", () => {
  it("matches Three.js default XYZ Euler matrices", () => {
    const cases = [
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
      [0, -Math.PI / 2, 0],
      [0, 0, Math.PI / 2],
      [Math.PI / 2, 0, Math.PI / 2],
      [0.31, -0.72, 1.13],
      [-0.4, 0.7, -1.2],
      [Math.PI / 2, -Math.PI / 2, Math.PI],
    ] as const;
    const threeMatrix = new Matrix4();
    for (const rotation of cases) {
      const actual = transformMat4({
        position: [0, 0, 0],
        rotation,
        scale: [1, 1, 1],
      });
      const expected = threeMatrix.makeRotationFromEuler(
        new Euler(rotation[0], rotation[1], rotation[2]),
      ).elements;
      for (let index = 0; index < 16; index += 1) {
        expect(actual[index], `${rotation.join(",")} matrix[${index}]`)
          .toBeCloseTo(expected[index]!, 14);
      }
    }
  });

  it("matches Three.js XYZ for deterministic generated finite triples", () => {
    const threeMatrix = new Matrix4();
    forEachFuzzCase({ cases: 128, seed: 0x3e_ee_12_34 }, ({ label, random }) => {
      const rotation = [
        random.number(-Math.PI * 2, Math.PI * 2),
        random.number(-Math.PI * 2, Math.PI * 2),
        random.number(-Math.PI * 2, Math.PI * 2),
      ] as const;
      const position = [
        random.number(-10, 10),
        random.number(-10, 10),
        random.number(-10, 10),
      ] as const;
      const scale = [
        random.number(-3, 3),
        random.number(-3, 3),
        random.number(-3, 3),
      ] as const;
      const actual = transformMat4({
        position,
        rotation,
        scale,
      });
      const expected = threeMatrix.makeRotationFromEuler(
        new Euler(rotation[0], rotation[1], rotation[2]),
      ).elements;
      for (let column = 0; column < 3; column += 1) {
        for (let row = 0; row < 3; row += 1) {
          const index = column * 4 + row;
          expect(actual[index], `${label} matrix[${index}]`)
            .toBeCloseTo(expected[index]! * scale[column]!, 13);
        }
      }
      expect(actual.slice(12, 15)).toEqual(position);
    });
  });

  it("keeps glTF quaternion composition independent of public Euler order", () => {
    const halfAngle = Math.PI / 4;
    const quaternion = [Math.sin(halfAngle), 0, 0, Math.cos(halfAngle)] as const;
    const actual = quaternionMat4(quaternion);
    const expected = rotationXMat4(Math.PI / 2);
    for (let index = 0; index < 16; index += 1) {
      expect(actual[index]).toBeCloseTo(expected[index]!, 14);
    }
  });

  it("inverts varied affine transforms into caller storage", () => {
    const inverse = identityMat4();
    const product = identityMat4();
    forEachFuzzCase({ cases: 128, seed: 0x5e_ed_12_34 }, ({ random }) => {
      const matrix = transformMat4({
        position: [random.number(-10, 10), random.number(-10, 10), random.number(-10, 10)],
        rotation: [random.number(-3, 3), random.number(-3, 3), random.number(-3, 3)],
        scale: [random.number(0.1, 3.1), random.number(0.1, 3.1), random.number(0.1, 3.1)],
      });
      expect(inverseMat4Into(inverse, matrix)).toBe(inverse);
      multiplyMat4Into(product, matrix, inverse);
      expectIdentity(product);
    });
  });

  it("maps an arbitrarily rotated camera position to view-space origin", () => {
    const camera = perspectiveCamera({
      position: [4, -2, 7],
      rotation: [0.31, -0.72, 1.13],
    });
    const view = viewMat4Into(identityMat4(), camera);
    const origin = transformPointInto([0, 0, 0], view, camera.position);
    expect(origin[0]).toBeCloseTo(0, 12);
    expect(origin[1]).toBeCloseTo(0, 12);
    expect(origin[2]).toBeCloseTo(0, 12);
  });

  it("keeps camera views inverse to the same Three-compatible object transform", () => {
    const camera = perspectiveCamera({
      position: [4, -2, 7],
      rotation: [0.31, -0.72, 1.13],
    });
    const model = transformMat4({
      position: camera.position,
      rotation: camera.rotation,
      scale: [1, 1, 1],
    });
    const product = multiplyMat4Into(identityMat4(), viewMat4(camera), model);
    expectIdentity(product);
  });

  it("keeps generated camera views inverse to generated XYZ poses", () => {
    forEachFuzzCase({ cases: 128, seed: 0xca_3e_12_34 }, ({ label, random }) => {
      const camera = perspectiveCamera({
        position: [random.number(-10, 10), random.number(-10, 10), random.number(-10, 10)],
        rotation: [
          random.number(-Math.PI * 2, Math.PI * 2),
          random.number(-Math.PI * 2, Math.PI * 2),
          random.number(-Math.PI * 2, Math.PI * 2),
        ],
      });
      const model = transformMat4({
        position: camera.position,
        rotation: camera.rotation,
        scale: [1, 1, 1],
      });
      const product = multiplyMat4Into(identityMat4(), viewMat4(camera), model);
      for (let index = 0; index < 16; index += 1) {
        expect(product[index], `${label} matrix[${index}]`)
          .toBeCloseTo(index % 5 === 0 ? 1 : 0, 9);
      }
    });
  });

  it("keeps an XYZ orbit camera aimed at its target", () => {
    const target = [1, -2, 3] as const;
    const transform = orbitCameraTransform({
      distance: 5,
      pitch: 0.43,
      target,
      yaw: -1.17,
    });
    const camera = perspectiveCamera({
      position: transform.position,
      rotation: transform.rotation,
    });
    const targetInView = transformPointInto([0, 0, 0], viewMat4(camera), target);
    expect(targetInView[0]).toBeCloseTo(0, 12);
    expect(targetInView[1]).toBeCloseTo(0, 12);
    expect(targetInView[2]).toBeCloseTo(-5, 12);
  });

  it("keeps generated and gimbal-boundary orbit cameras aimed at their targets", () => {
    const angleCases: Array<readonly [number, number]> = [
      [0, Math.PI / 2],
      [0, -Math.PI / 2],
      [Math.PI / 2, Math.PI / 2],
      [-Math.PI / 2, -Math.PI / 2],
    ];
    forEachFuzzCase({ cases: 128, seed: 0x0b_17_12_34 }, ({ random }) => {
      angleCases.push([
        random.number(-Math.PI, Math.PI),
        random.number(-Math.PI * 2, Math.PI * 2),
      ]);
    });
    for (const [pitch, yaw] of angleCases) {
      const target = [1, -2, 3] as const;
      const distance = 5;
      const transform = orbitCameraTransform({ distance, pitch, target, yaw });
      const camera = perspectiveCamera({
        position: transform.position,
        rotation: transform.rotation,
      });
      const targetInView = transformPointInto([0, 0, 0], viewMat4(camera), target);
      expect(targetInView[0], `${pitch},${yaw} target x`).toBeCloseTo(0, 9);
      expect(targetInView[1], `${pitch},${yaw} target y`).toBeCloseTo(0, 9);
      expect(targetInView[2], `${pitch},${yaw} target z`).toBeCloseTo(-distance, 9);
    }
  });
});

import { describe, expect, it, vi } from "vitest";
import {
  createCameraViewResource,
  orthographicCamera,
  perspectiveCamera,
  type CameraViewReadTarget,
} from "@royal/renderer-core";
import { forEachFuzzCase } from "./fuzz";

const readTarget = (): CameraViewReadTarget => ({
  kind: "perspective-camera",
  position: new Float64Array(3),
  rotation: new Float64Array(3),
  fovY: 0,
  left: 0,
  right: 0,
  bottom: 0,
  top: 0,
  near: 0,
  far: 0,
});

describe("camera view resource properties", () => {
  it("publishes only committed finite perspective views with silent equal commits", () => {
    forEachFuzzCase({ cases: 48, seed: 0x31a9d4c2 }, ({ random, label }) => {
      const camera = perspectiveCamera({
        position: [random.number(-1e7, 1e7), random.number(-1e7, 1e7), random.number(-1e7, 1e7)],
        rotation: [random.number(-3, 3), random.number(-3, 3), random.number(-3, 3)],
        fovY: random.number(0.1, 2.8),
        near: random.number(0.01, 10),
        far: random.number(20, 20_000),
      });
      const resource = createCameraViewResource(camera);
      const versions: number[] = [];
      const unsubscribe = resource.subscribe((version) => versions.push(version));
      const before = readTarget();
      resource.read(before);
      const nextX = before.position[0]! + random.number(0.01, 10);
      resource.position[0] = nextX;
      const staged = readTarget();
      resource.read(staged);
      expect(staged.position[0], `${label} staged value is private until commit`).toBe(before.position[0]);

      resource.commit();
      const committed = readTarget();
      resource.read(committed);
      expect(committed.position[0], `${label} committed position`).toBe(nextX);
      expect(resource.version, `${label} version`).toBe(2);
      expect(versions, `${label} notification`).toEqual([2]);
      resource.commit();
      expect(resource.version, `${label} equal commit`).toBe(2);
      expect(versions).toEqual([2]);
      unsubscribe();
      resource.position[1] = resource.position[1]! + 1;
      resource.commit();
      expect(versions).toEqual([2]);
    });
  });

  it("notifies every active listener even when an earlier listener throws", () => {
    const resource = createCameraViewResource(perspectiveCamera({
      position: [0, 0, 5], rotation: [0, 0, 0], fovY: 1, near: 0.1, far: 100,
    }));
    const later = vi.fn();
    resource.subscribe(() => { throw new Error("listener failed"); });
    resource.subscribe(later);
    resource.position[0] = 1;

    expect(() => resource.commit()).toThrow(/listener failed/);
    expect(later).toHaveBeenCalledWith(2);
    expect(resource.version).toBe(2);
  });

  it("rejects reentrant commits before they can invert subscriber version order", () => {
    const resource = createCameraViewResource(perspectiveCamera({
      position: [0, 0, 5], rotation: [0, 0, 0], fovY: 1, near: 0.1, far: 100,
    }));
    const observed: number[] = [];
    resource.subscribe((version) => {
      observed.push(version);
      if (version !== 2) return;
      resource.position[1] = 2;
      resource.commit();
    });
    resource.subscribe((version) => observed.push(version));
    resource.position[0] = 1;

    expect(() => resource.commit()).toThrow(/cannot run from.*subscriber/);
    expect(observed).toEqual([2, 2]);
    expect(resource.version).toBe(2);
    resource.commit();
    expect(observed).toEqual([2, 2, 3, 3]);
  });

  it("supports orthographic set and rejects invalid committed projection state", () => {
    const resource = createCameraViewResource(orthographicCamera({
      left: -2, right: 2, bottom: -1, top: 1,
    }));
    resource.set(orthographicCamera({
      left: -4, right: 4, bottom: -3, top: 3, near: -50, far: 50,
      position: [1, 2, 3], rotation: [0.1, 0.2, 0.3],
    }));
    const out = readTarget();
    resource.read(out);
    expect(out).toMatchObject({ kind: "orthographic-camera", left: -4, right: 4, bottom: -3, top: 3 });
    expect([...out.position]).toEqual([1, 2, 3]);

    resource.right = resource.left;
    expect(() => resource.commit()).toThrow(/non-zero width/);
  });

  it("copies and freezes static camera tuple inputs", () => {
    const position: [number, number, number] = [1, 2, 3];
    const rotation: [number, number, number] = [0.1, 0.2, 0.3];
    const camera = perspectiveCamera({ position, rotation, fovY: 1, near: 0.1, far: 10 });
    position[0] = 9;
    rotation[0] = 9;
    expect(camera.position).toEqual([1, 2, 3]);
    expect(camera.rotation).toEqual([0.1, 0.2, 0.3]);
    expect(Object.isFrozen(camera)).toBe(true);
    expect(Object.isFrozen(camera.position)).toBe(true);
  });
});

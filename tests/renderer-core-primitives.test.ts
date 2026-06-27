import { describe, expect, it } from 'vitest';
import {
  defineCoordinateSystem,
  sceneSource,
  yUpRightHanded,
  zUpLeftHanded
} from '@royal/renderer-core';

describe('renderer-core primitives', () => {
  it('declares coordinate systems explicitly', () => {
    expect(zUpLeftHanded).toEqual({
      forward: { axis: 'y', sign: 1 },
      handedness: 'left',
      unit: 'meter',
      up: { axis: 'z', sign: 1 }
    });

    expect(yUpRightHanded).toEqual({
      forward: { axis: 'z', sign: -1 },
      handedness: 'right',
      unit: 'meter',
      up: { axis: 'y', sign: 1 }
    });
  });

  it('rejects coordinate systems with ambiguous up and forward axes', () => {
    expect(() =>
      defineCoordinateSystem({
        forward: { axis: 'z', sign: 1 },
        handedness: 'right',
        unit: 'meter',
        up: { axis: 'z', sign: 1 }
      })
    ).toThrow('Coordinate system up and forward axes must differ');
  });

  it('requires scene sources to carry coordinate assumptions', () => {
    expect(sceneSource({
      coordinateSystem: yUpRightHanded,
      id: 'infinigen-stream'
    })).toEqual({
      coordinateSystem: yUpRightHanded,
      id: 'infinigen-stream'
    });
  });
});

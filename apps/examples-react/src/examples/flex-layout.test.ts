import { describe, expect, it } from 'vitest';
import {
  Box,
  Container,
  type FlexLayoutBox,
  layoutFlex,
} from './flex-layout';

const expectBox = (box: FlexLayoutBox, expected: FlexLayoutBox): void => {
  expect(box.left).toBeCloseTo(expected.left);
  expect(box.top).toBeCloseTo(expected.top);
  expect(box.right).toBeCloseTo(expected.right);
  expect(box.bottom).toBeCloseTo(expected.bottom);
  expect(box.width).toBeCloseTo(expected.width);
  expect(box.height).toBeCloseTo(expected.height);
};

describe('layoutFlex', () => {
  it('applies item width defaults to direct children', () => {
    const boxes = layoutFlex<'defaulted' | 'override'>(Container({
      height: 10,
      itemWidth: 4,
      width: 10,
    },
      Box('defaulted', { height: 1 }),
      Box('override', {
        height: 1,
        width: 2,
      }),
    ));

    expectBox(boxes.defaulted, {
      bottom: 1,
      height: 1,
      left: 0,
      right: 4,
      top: 0,
      width: 4,
    });
    expectBox(boxes.override, {
      bottom: 2,
      height: 1,
      left: 0,
      right: 2,
      top: 1,
      width: 2,
    });
  });

  it('lays out keyed direct children with padding, gap, and margins', () => {
    const boxes = layoutFlex<'one' | 'two'>(Container({
      gap: 0.5,
      padding: { left: 1, top: 2 },
      size: { height: 10, width: 10 },
    },
      Box('one', {
        height: 1,
        margin: { bottom: 0.25 },
        width: 4,
      }),
      Box('two', {
        height: 2,
        width: 5,
      }),
    ));

    expectBox(boxes.one, {
      bottom: 3,
      height: 1,
      left: 1,
      right: 5,
      top: 2,
      width: 4,
    });
    expectBox(boxes.two, {
      bottom: 5.75,
      height: 2,
      left: 1,
      right: 6,
      top: 3.75,
      width: 5,
    });
  });

  it('returns nested boxes in root coordinates', () => {
    const boxes = layoutFlex<'inner' | 'outer'>(Container({
      height: 10,
      padding: { left: 1, top: 2 },
      width: 10,
    },
      Container({
        height: 4,
        id: 'outer',
        padding: { left: 0.5, top: 0.75 },
        width: 6,
      },
        Box('inner', {
          height: 1,
          width: 2,
        }),
      ),
    ));

    expectBox(boxes.outer, {
      bottom: 6,
      height: 4,
      left: 1,
      right: 7,
      top: 2,
      width: 6,
    });
    expectBox(boxes.inner, {
      bottom: 3.75,
      height: 1,
      left: 1.5,
      right: 3.5,
      top: 2.75,
      width: 2,
    });
  });
});

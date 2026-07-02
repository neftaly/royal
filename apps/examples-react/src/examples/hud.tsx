/** @jsxImportSource @royal/react */
import { type Rgba, type Vec3 } from '@royal/renderer-core';
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { type ReactNode } from 'react';
import { type FlexLayoutBox } from './flex-layout';

const defaultHudSize = {
  height: 9,
  width: 16,
} as const;

export const hudBoxWithWidth = (
  box: FlexLayoutBox,
  width: number,
): FlexLayoutBox => ({
  ...box,
  right: box.left + width,
  width,
});

const hudBounds = (width: number, height: number) => ({
  bottom: -height,
  left: 0,
  right: width,
  top: 0,
});

const hudBoxCenter = (box: FlexLayoutBox, z: number): Vec3 => [
  box.left + box.width / 2,
  -box.top - box.height / 2,
  z,
];

const hudTextOrigin = (
  box: FlexLayoutBox,
  fontSize: number,
  insetX: number,
  insetY: number,
  z: number,
): Vec3 => [
  box.left + insetX,
  -box.top - insetY - fontSize * 0.82,
  z,
];

export const HudPass = ({
  children,
  height = defaultHudSize.height,
  width = defaultHudSize.width,
}: {
  readonly children?: ReactNode;
  readonly height?: number;
  readonly width?: number;
}): ReactNode => (
  <pass clear="none" depthTest={false}>
    <orthographicCamera {...hudBounds(width, height)} />
    {children}
  </pass>
);

export const HudRect = ({
  box,
  color,
  z = 0,
}: {
  readonly box: FlexLayoutBox;
  readonly color: Rgba;
  readonly z?: number;
}): ReactNode => (
  <mesh transform={{ position: hudBoxCenter(box, z), rotation: [0, 0, 0] }}>
    <planeGeometry size={[box.width, box.height]} />
    <unlitMaterial color={color} />
  </mesh>
);

export const HudText = ({
  box,
  children,
  color,
  font,
  fontSize,
  insetX = 0,
  insetY = 0,
  lineHeight = fontSize * 1.25,
  z = 0,
}: {
  readonly box: FlexLayoutBox;
  readonly children: ReactNode;
  readonly color: Rgba;
  readonly font: TextFontFace;
  readonly fontSize: number;
  readonly insetX?: number;
  readonly insetY?: number;
  readonly lineHeight?: number;
  readonly z?: number;
}): ReactNode => (
  <text
    color={color}
    font={font}
    fontSize={fontSize}
    lineHeight={lineHeight}
    origin={hudTextOrigin(box, fontSize, insetX, insetY, z)}
  >
    {children}
  </text>
);

/** @jsxImportSource @royal/react */
import {
  boxGeometry,
  createEditableTextFragment,
  solidTexture,
  type RenderNode,
  type RenderRoot,
  type Rgba,
  type TextFontFace,
  type Vec3,
  unlitMaterial,
} from '@royal/renderer-core';
import {
  formControlsModel,
  type ButtonControlModel,
  type ColorSwatchControlModel,
  type EditableTextControlModel,
  type FileCommandControlModel,
  type ListboxControlModel,
  type RadioGroupControlModel,
  type RangeControlModel,
  type ToggleControlModel,
} from './FormControls.model';

type BoxStyle = {
  readonly fill: Rgba;
  readonly height: number;
  readonly width: number;
};

const cameraBounds = {
  bottom: -4.5,
  left: -7,
  right: 7,
  top: 4.5,
} as const;

const palette = {
  accent: [0.3, 0.75, 0.62, 1],
  amber: [0.96, 0.68, 0.25, 1],
  bg: [0.045, 0.055, 0.06, 1],
  border: [0.27, 0.31, 0.33, 1],
  field: [0.1, 0.12, 0.125, 1],
  fieldStrong: [0.13, 0.16, 0.17, 1],
  ink: [0.88, 0.91, 0.88, 1],
  muted: [0.55, 0.62, 0.62, 1],
  primary: [0.24, 0.48, 0.86, 1],
  selection: [0.14, 0.32, 0.48, 1],
  stroke: [0.18, 0.2, 0.21, 1],
} as const satisfies Readonly<Record<string, Rgba>>;

const rect = ({ fill, height, width }: BoxStyle, position: Vec3): RenderNode =>
  (
    <mesh
      geometry={boxGeometry({ size: [width, height, 0.02] })}
      material={unlitMaterial({ baseColor: solidTexture({ color: fill }) })}
      transform={{ position, rotation: [0, 0, 0] }}
    />
  ) as RenderNode;

const textNode = (
  text: string,
  origin: Vec3,
  color: Rgba = palette.ink,
  fontSize = 0.2,
  lineHeight = 0.28,
): RenderNode =>
  (
    <text
      color={color}
      fontSize={fontSize}
      lineHeight={lineHeight}
      origin={origin}
      text={text}
    />
  ) as RenderNode;

const hexToRgba = (hex: string): Rgba => {
  const packed = Number.parseInt(hex.slice(1), 16);
  const r = ((packed >> 16) & 0xff) / 255;
  const g = ((packed >> 8) & 0xff) / 255;
  const b = (packed & 0xff) / 255;

  return [r, g, b, 1];
};

const editableTextField = (
  control: EditableTextControlModel,
  font: TextFontFace | undefined,
  x: number,
  y: number,
  width: number,
): readonly RenderNode[] => {
  const multiline = control.mode === 'multiline';
  const height = multiline ? 1.34 : 0.74;
  const textOrigin: Vec3 = [x + 0.18, y - 0.23, 0.11];
  const fragment = createEditableTextFragment({
    color: palette.ink,
    ...(font === undefined ? {} : { font }),
    fontSize: 0.22,
    lineHeight: 0.31,
    maxWidth: width - 0.36,
    mode: control.mode,
    origin: textOrigin,
    placeholder: control.placeholder,
    placeholderColor: palette.muted,
    selection: control.selection,
    selectionColor: palette.selection,
    text: control.value,
  });

  return [
    textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
    rect({ fill: palette.stroke, height: height + 0.05, width: width + 0.05 }, [x + width / 2, y - 0.42, 0]),
    rect({ fill: palette.field, height, width }, [x + width / 2, y - 0.42, 0.02]),
    ...fragment.nodes,
    textNode(`${control.value.length}/${control.maxLength}`, [x + width - 0.86, y - height + 0.04, 0.11], palette.muted, 0.14, 0.2),
  ];
};

const checkboxControl = (
  control: ToggleControlModel,
  x: number,
  y: number,
): readonly RenderNode[] => [
  rect({ fill: palette.stroke, height: 0.45, width: 0.45 }, [x + 0.22, y - 0.18, 0]),
  rect({ fill: control.checked ? palette.accent : palette.field, height: 0.32, width: 0.32 }, [x + 0.22, y - 0.18, 0.04]),
  textNode(control.checked ? 'x' : '', [x + 0.14, y - 0.29, 0.12], palette.bg, 0.28, 0.28),
  textNode(control.label, [x + 0.58, y - 0.28, 0.12], palette.ink, 0.2, 0.28),
];

const radioGroup = (
  control: RadioGroupControlModel,
  x: number,
  y: number,
): readonly RenderNode[] => [
  textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
  ...control.options.flatMap((option, index) => {
    const itemX = x + index * 1.35;
    const selected = option.id === control.value;

    return [
      rect({ fill: palette.stroke, height: 0.34, width: 0.34 }, [itemX + 0.17, y - 0.44, 0]),
      rect({ fill: selected ? palette.amber : palette.field, height: 0.2, width: 0.2 }, [itemX + 0.17, y - 0.44, 0.04]),
      textNode(option.label, [itemX + 0.42, y - 0.54, 0.12], palette.ink, 0.17, 0.24),
    ];
  }),
];

const listboxControl = (
  control: ListboxControlModel,
  x: number,
  y: number,
  width: number,
): readonly RenderNode[] => [
  textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
  rect({ fill: palette.stroke, height: 1.04, width: width + 0.05 }, [x + width / 2, y - 0.64, 0]),
  rect({ fill: palette.field, height: 0.99, width }, [x + width / 2, y - 0.64, 0.02]),
  ...control.options.flatMap((option, index) => {
    const selected = option.id === control.value;
    const rowY = y - 0.28 - index * 0.31;

    return [
      selected
        ? rect({ fill: palette.primary, height: 0.27, width: width - 0.18 }, [x + width / 2, rowY - 0.07, 0.05])
        : null,
      textNode(option.label, [x + 0.18, rowY - 0.16, 0.12], selected ? [1, 1, 1, 1] : palette.ink, 0.17, 0.23),
    ];
  }).filter((node): node is RenderNode => node !== null),
];

const rangeControl = (
  control: RangeControlModel,
  x: number,
  y: number,
  width: number,
): readonly RenderNode[] => {
  const ratio = (control.value - control.min) / (control.max - control.min);
  const knobX = x + 0.22 + (width - 0.44) * ratio;

  return [
    textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
    rect({ fill: palette.stroke, height: 0.12, width: width }, [x + width / 2, y - 0.43, 0]),
    rect({ fill: palette.accent, height: 0.12, width: width * ratio }, [x + (width * ratio) / 2, y - 0.43, 0.04]),
    rect({ fill: palette.ink, height: 0.34, width: 0.18 }, [knobX, y - 0.43, 0.08]),
    textNode(`${control.value}`, [x + width + 0.22, y - 0.51, 0.12], palette.ink, 0.2, 0.28),
  ];
};

const colorSwatches = (
  control: ColorSwatchControlModel,
  x: number,
  y: number,
): readonly RenderNode[] => [
  textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
  ...control.palette.flatMap((hex, index) => {
    const selected = hex === control.value;
    const swatchX = x + index * 0.48;

    return [
      rect({ fill: selected ? palette.ink : palette.stroke, height: 0.39, width: 0.39 }, [swatchX + 0.2, y - 0.43, 0]),
      rect({ fill: hexToRgba(hex), height: 0.28, width: 0.28 }, [swatchX + 0.2, y - 0.43, 0.05]),
    ];
  }),
];

const fileCommand = (
  control: FileCommandControlModel,
  x: number,
  y: number,
  width: number,
): readonly RenderNode[] => [
  textNode(control.label, [x, y, 0.12], palette.muted, 0.17, 0.24),
  rect({ fill: palette.stroke, height: 0.55, width: width }, [x + width / 2, y - 0.39, 0]),
  rect({ fill: palette.fieldStrong, height: 0.5, width: width - 0.05 }, [x + width / 2, y - 0.39, 0.03]),
  textNode('Choose file', [x + 0.18, y - 0.48, 0.12], palette.ink, 0.18, 0.26),
  textNode(control.value, [x + 1.48, y - 0.48, 0.12], palette.muted, 0.16, 0.24),
];

const buttons = (
  controls: readonly ButtonControlModel[],
  x: number,
  y: number,
): readonly RenderNode[] =>
  controls.flatMap((control, index) => {
    const width = control.tone === 'primary' ? 1.05 : 0.92;
    const buttonX = x + index * 1.18;

    return [
      rect(
        { fill: control.tone === 'primary' ? palette.primary : palette.stroke, height: 0.5, width },
        [buttonX + width / 2, y - 0.24, 0.02],
      ),
      textNode(control.label, [buttonX + 0.18, y - 0.34, 0.12], [1, 1, 1, 1], 0.18, 0.25),
    ];
  });

export const formControlsScene = (font?: TextFontFace): RenderRoot => (
  <scene>
    <pass clearColor={palette.bg}>
      <orthographicCamera
        bottom={cameraBounds.bottom}
        far={100}
        left={cameraBounds.left}
        near={0.1}
        position={[0, 0, 10]}
        right={cameraBounds.right}
        rotation={[0, 0, 0]}
        top={cameraBounds.top}
      />
      {textNode('Form Controls', [-6.28, 3.78, 0.12], palette.ink, 0.44, 0.54)}
      {textNode('Checkout', [-6.26, 3.28, 0.12], palette.muted, 0.2, 0.28)}
      {editableTextField(formControlsModel.textControls[0], font, -6.25, 2.62, 5.65)}
      {editableTextField(formControlsModel.textControls[1], font, -6.25, 1.42, 5.65)}
      {editableTextField(formControlsModel.date, font, -6.25, -0.68, 2.7)}
      {editableTextField(formControlsModel.time, font, -3.25, -0.68, 2.12)}
      {checkboxControl(formControlsModel.checkbox, -6.25, -1.82)}
      {radioGroup(formControlsModel.radio, -6.25, -2.52)}
      {listboxControl(formControlsModel.listbox, 0.35, 2.62, 3.1)}
      {rangeControl(formControlsModel.range, 0.35, 1.16, 3.2)}
      {colorSwatches(formControlsModel.color, 0.35, 0.28)}
      {fileCommand(formControlsModel.file, 0.35, -0.72, 4.62)}
      {buttons(formControlsModel.buttons, 0.35, -2.26)}
    </pass>
  </scene>
) as RenderRoot;

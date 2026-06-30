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
  formControlsCameraBounds,
  formControlsLayout,
  formControlsTextMetrics,
  type CanvasFormModel,
  type EditableTextControlModel,
} from './FormControls.model';

type BoxStyle = {
  readonly fill: Rgba;
  readonly height: number;
  readonly width: number;
};

const palette = {
  accent: [0.24, 0.72, 0.62, 1],
  accentStrong: [0.18, 0.55, 0.48, 1],
  bg: [0.045, 0.052, 0.055, 1],
  border: [0.24, 0.28, 0.29, 1],
  button: [0.2, 0.42, 0.78, 1],
  field: [0.1, 0.12, 0.12, 1],
  fieldActive: [0.12, 0.145, 0.15, 1],
  ink: [0.9, 0.93, 0.9, 1],
  muted: [0.57, 0.63, 0.62, 1],
  selection: [0.12, 0.32, 0.42, 1],
  shadow: [0.02, 0.025, 0.028, 1],
  surface: [0.075, 0.088, 0.09, 1],
} as const satisfies Readonly<Record<string, Rgba>>;

const rect = ({ fill, height, width }: BoxStyle, position: Vec3): RenderNode =>
  (
    <mesh
      geometry={boxGeometry({ size: [width, height, 0.02] })}
      material={unlitMaterial({ baseColor: solidTexture({ color: fill }) })}
      transform={{ position, rotation: [0, 0, 0] }}
    />
  ) as RenderNode;

const rectFromTopLeft = (
  style: BoxStyle,
  x: number,
  y: number,
  z = 0,
): RenderNode =>
  rect(style, [x + style.width / 2, y - style.height / 2, z]);

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

const editableTextField = (
  control: EditableTextControlModel,
  active: boolean,
  font: TextFontFace | undefined,
): readonly RenderNode[] => {
  const field = formControlsLayout.fields[control.id];
  const fragment = createEditableTextFragment({
    color: palette.ink,
    ...(font === undefined ? {} : { font }),
    fontSize: formControlsTextMetrics.fontSize,
    lineHeight: formControlsTextMetrics.lineHeight,
    maxWidth: field.textMaxWidth,
    mode: control.mode,
    origin: field.textOrigin,
    placeholder: control.placeholder,
    placeholderColor: palette.muted,
    selection: control.selection,
    selectionColor: palette.selection,
    showCaret: active,
    text: control.value,
  });
  const border = active ? palette.accent : palette.border;

  return [
    textNode(control.label, [field.x, field.y + 0.24, 0.12], palette.muted, 0.17, 0.24),
    rectFromTopLeft({ fill: palette.shadow, height: field.height + 0.08, width: field.width + 0.08 }, field.x - 0.04, field.y + 0.02),
    rectFromTopLeft({ fill: border, height: field.height + 0.04, width: field.width + 0.04 }, field.x - 0.02, field.y + 0.02, 0.02),
    rectFromTopLeft({ fill: active ? palette.fieldActive : palette.field, height: field.height, width: field.width }, field.x, field.y, 0.04),
    ...fragment.nodes,
  ];
};

const checkboxControl = (
  model: CanvasFormModel,
): readonly RenderNode[] => {
  const control = model.checkbox;
  const bounds = formControlsLayout.checkbox;
  const active = model.focusedId === control.id;
  const boxX = bounds.x;
  const boxY = bounds.y;
  const fill = control.checked ? palette.accent : palette.field;

  return [
    rectFromTopLeft({ fill: active ? palette.accentStrong : palette.border, height: 0.4, width: 0.4 }, boxX, boxY, 0.02),
    rectFromTopLeft({ fill, height: 0.28, width: 0.28 }, boxX + 0.06, boxY - 0.06, 0.06),
    textNode(control.checked ? 'x' : '', [boxX + 0.13, boxY - 0.29, 0.12], palette.bg, 0.25, 0.25),
    textNode(control.label, [boxX + 0.56, boxY - 0.28, 0.12], palette.ink, 0.2, 0.28),
  ];
};

const actionButton = (
  model: CanvasFormModel,
): readonly RenderNode[] => {
  const bounds = formControlsLayout.button;
  const active = model.focusedId === model.button.id;
  const label = model.button.pressCount === 0 ? model.button.label : `Sent ${model.button.pressCount}`;

  return [
    rectFromTopLeft({ fill: active ? palette.accentStrong : palette.button, height: bounds.height, width: bounds.width }, bounds.x, bounds.y, 0.04),
    textNode(label, [bounds.x + 0.28, bounds.y - 0.36, 0.12], [1, 1, 1, 1], 0.2, 0.27),
  ];
};

export const formControlsScene = (
  model: CanvasFormModel,
  font?: TextFontFace,
): RenderRoot => (
  <scene>
    <pass clearColor={palette.bg}>
      <orthographicCamera
        bottom={formControlsCameraBounds.bottom}
        far={100}
        left={formControlsCameraBounds.left}
        near={0.1}
        position={[0, 0, 10]}
        right={formControlsCameraBounds.right}
        rotation={[0, 0, 0]}
        top={formControlsCameraBounds.top}
      />
      {rect({ fill: palette.surface, height: 5.6, width: 8.1 }, [0, 0.1, -0.02])}
      {textNode('Form Controls', [-3.84, 3.0, 0.12], palette.ink, 0.42, 0.52)}
      {textNode('Canvas-native editable fields', [-3.82, 2.58, 0.12], palette.muted, 0.18, 0.25)}
      {model.textControls.flatMap((control) =>
        editableTextField(control, model.activeTextId === control.id, font)
      )}
      {checkboxControl(model)}
      {actionButton(model)}
    </pass>
  </scene>
) as RenderRoot;

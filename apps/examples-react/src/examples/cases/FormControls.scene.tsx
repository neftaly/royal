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
  type EditableTextControlId,
  type EditableTextControlModel,
} from './FormControls.model';

type BoxStyle = {
  readonly fill: Rgba;
  readonly height: number;
  readonly width: number;
};

type RectBounds = {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
};

type TextFieldBounds = RectBounds & {
  readonly textMaxWidth: number;
  readonly textOrigin: Vec3;
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

const layout = formControlsLayout;

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

const isRenderNode = (value: unknown): value is RenderNode =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (
    value.kind === 'mesh' ||
    value.kind === 'gltf' ||
    value.kind === 'directional-light' ||
    value.kind === 'text'
  );

const renderNodesFromChildren = (children: unknown): readonly RenderNode[] => {
  if (Array.isArray(children)) return children.flatMap(renderNodesFromChildren);
  if (children === false || children === null || children === undefined) return [];
  if (typeof children === 'string' && children.trim() === '') return [];
  if (isRenderNode(children)) return [children];
  throw new Error('Expected Royal render node child');
};

const textFromChildren = (children: unknown): string => {
  if (Array.isArray(children)) return children.map(textFromChildren).join('');
  if (typeof children === 'number' || typeof children === 'string') return String(children);
  if (children === false || children === null || children === undefined) return '';
  throw new Error('Expected text child');
};

const labelFromChildren = (children: unknown): string =>
  textFromChildren(children).trim();

type FormProps = {
  readonly bounds: RectBounds;
  readonly children?: unknown;
  readonly id: string;
};

const Form = ({ bounds, children }: FormProps) => (
  <>
    {rectFromTopLeft({ fill: palette.surface, height: bounds.height, width: bounds.width }, bounds.x, bounds.y, -0.02)}
    {renderNodesFromChildren(children)}
  </>
);

type HeadingProps = {
  readonly bounds: RectBounds;
  readonly children?: unknown;
  readonly level: 1;
};

const Heading = ({ bounds, children }: HeadingProps) => (
  <>
    {textNode(labelFromChildren(children), [bounds.x, bounds.y, 0.12], palette.ink, 0.38, 0.48)}
  </>
);

type FieldChromeOptions = {
  readonly active: boolean;
  readonly bounds: TextFieldBounds;
  readonly label: string;
};

const fieldChromeNodes = ({
  active,
  bounds,
  label,
}: FieldChromeOptions): readonly RenderNode[] => {
  const border = active ? palette.accent : palette.border;

  return [
    textNode(label, [bounds.x, bounds.y + 0.24, 0.12], palette.muted, 0.17, 0.24),
    rectFromTopLeft({ fill: palette.shadow, height: bounds.height + 0.08, width: bounds.width + 0.08 }, bounds.x - 0.04, bounds.y + 0.02),
    rectFromTopLeft({ fill: border, height: bounds.height + 0.04, width: bounds.width + 0.04 }, bounds.x - 0.02, bounds.y + 0.02, 0.02),
    rectFromTopLeft({ fill: active ? palette.fieldActive : palette.field, height: bounds.height, width: bounds.width }, bounds.x, bounds.y, 0.04),
  ];
};

type FieldProps = FieldChromeOptions & {
  readonly children?: unknown;
  readonly id: string;
};

const Field = ({ active, bounds, children, label }: FieldProps) => (
  <>
    {fieldChromeNodes({ active, bounds, label })}
    {renderNodesFromChildren(children)}
  </>
);

type EditableTextInputProps = {
  readonly active: boolean;
  readonly control: EditableTextControlModel;
  readonly font: TextFontFace | undefined;
  readonly id: EditableTextControlId;
};

const editableTextNodes = ({
  active,
  control,
  font,
  id,
}: EditableTextInputProps): readonly RenderNode[] => {
  if (id !== control.id) throw new Error(`Mismatched text input id: ${id}`);

  const field = layout.fields[id];

  return createEditableTextFragment({
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
  }).nodes;
};

type TextInputProps = EditableTextInputProps;

const TextInput = (props: TextInputProps) => (
  <>
    {editableTextNodes(props)}
  </>
);

type TextAreaProps = EditableTextInputProps & FieldChromeOptions;

const TextArea = ({
  active,
  bounds,
  control,
  font,
  id,
  label,
}: TextAreaProps) => (
  <>
    {fieldChromeNodes({ active, bounds, label })}
    {editableTextNodes({ active, control, font, id })}
  </>
);

type CheckboxProps = {
  readonly bounds: RectBounds;
  readonly checked: boolean;
  readonly children?: unknown;
  readonly focused: boolean;
  readonly id: 'updates';
};

const Checkbox = ({
  bounds,
  checked,
  children,
  focused,
}: CheckboxProps) => {
  const boxX = bounds.x;
  const boxY = bounds.y;
  const fill = checked ? palette.accent : palette.field;

  return (
    <>
      {rectFromTopLeft({ fill: focused ? palette.accentStrong : palette.border, height: 0.4, width: 0.4 }, boxX, boxY, 0.02)}
      {rectFromTopLeft({ fill, height: 0.28, width: 0.28 }, boxX + 0.06, boxY - 0.06, 0.06)}
      {textNode(checked ? 'x' : '', [boxX + 0.13, boxY - 0.29, 0.12], palette.bg, 0.25, 0.25)}
      {textNode(labelFromChildren(children), [boxX + 0.56, boxY - 0.28, 0.12], palette.ink, 0.2, 0.28)}
    </>
  );
};

type ButtonProps = {
  readonly bounds: RectBounds;
  readonly children?: unknown;
  readonly focused: boolean;
  readonly id: 'send';
};

const Button = ({
  bounds,
  children,
  focused,
}: ButtonProps) => (
  <>
    {rectFromTopLeft({ fill: focused ? palette.accentStrong : palette.button, height: bounds.height, width: bounds.width }, bounds.x, bounds.y, 0.04)}
    {textNode(labelFromChildren(children), [bounds.x + 0.28, bounds.y - 0.36, 0.12], [1, 1, 1, 1], 0.2, 0.27)}
  </>
);

export const formControlsScene = (
  model: CanvasFormModel,
  font?: TextFontFace,
): RenderRoot => {
  const [title, notes] = model.textControls;

  return (
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
        <Form id="contact-form" bounds={layout.form}>
          <Heading level={1} bounds={layout.heading}>
            Message
          </Heading>
          <Field
            id="title-field"
            label="Title"
            bounds={layout.fields.title}
            active={model.activeTextId === title.id}
          >
            <TextInput
              id="title"
              active={model.activeTextId === title.id}
              control={title}
              font={font}
            />
          </Field>
          <TextArea
            id="notes"
            label="Notes"
            bounds={layout.fields.notes}
            active={model.activeTextId === notes.id}
            control={notes}
            font={font}
          />
          <Checkbox
            id="updates"
            checked={model.checkbox.checked}
            focused={model.focusedId === model.checkbox.id}
            bounds={layout.checkbox}
          >
            {model.checkbox.label}
          </Checkbox>
          <Button
            id="send"
            focused={model.focusedId === model.button.id}
            bounds={layout.button}
          >
            Submit
          </Button>
        </Form>
      </pass>
    </scene>
  ) as RenderRoot;
};

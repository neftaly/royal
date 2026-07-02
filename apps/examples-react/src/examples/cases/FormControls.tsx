/** @jsxImportSource @royal/react */
import { type TextFontFace } from '@royal/renderer-core/text/font';
import { Canvas } from '@royal/react';
import { type ReactNode } from 'react';
import {
  Button,
  Checkbox,
  compactRoyalFormCameraBounds,
  compactRoyalFormLayout,
  defaultRoyalFormTheme,
  Field,
  Form,
  FormStatus,
  Input,
  Label,
  Textarea,
  useRoyalForm,
  type RoyalFormTextControls,
} from './form-kit';
import { useAtkinsonFont } from './text-font';

const renderer = {
  context: { alpha: true, antialias: true, preserveDrawingBuffer: true },
} as const;

const focusOrder = ['name', 'message', 'updates', 'submit'] as const;

const textControls = {
  message: {
    maxLength: 240,
    mode: 'multiline',
  },
  name: {
    maxLength: 64,
    mode: 'single-line',
  },
} as const satisfies RoyalFormTextControls;

const submitStatus = (count: number): string => {
  if (count === 0) return 'Ready to submit';
  if (count === 1) return 'Submitted once';
  return `Submitted ${count} times`;
};

const MessageForm = ({
  font,
}: {
  readonly font: TextFontFace;
}): ReactNode => {
  const form = useRoyalForm({
    cameraBounds: compactRoyalFormCameraBounds,
    focusOrder,
    font,
    layout: compactRoyalFormLayout,
    submitButton: 'submit',
    textControls,
  });

  return (
    <Canvas
      {...form.canvasProps}
      aria-label="Message form"
      renderer={renderer}
    >
      <scene>
        <pass clearColor={defaultRoyalFormTheme.background}>
          <orthographicCamera
            bottom={compactRoyalFormCameraBounds.bottom}
            far={100}
            left={compactRoyalFormCameraBounds.left}
            near={0.1}
            position={[0, 0, 10]}
            right={compactRoyalFormCameraBounds.right}
            rotation={[0, 0, 0]}
            top={compactRoyalFormCameraBounds.top}
          />
          <Form id="message-form" kit={form} title="Message">
            <Field kit={form} name="name">
              <Label control="name" kit={form}>Your name</Label>
              <Input kit={form} name="name" type="text" />
            </Field>
            <Field kit={form} name="message">
              <Label control="message" kit={form}>Message</Label>
              <Textarea kit={form} name="message" />
            </Field>
            <Checkbox kit={form} name="updates">Send me updates</Checkbox>
            <Button kit={form} name="submit" type="submit">Submit</Button>
            <FormStatus kit={form}>{submitStatus(form.activationCount('submit'))}</FormStatus>
          </Form>
        </pass>
      </scene>
    </Canvas>
  );
};

export const FormControls = (): ReactNode => {
  const fontState = useAtkinsonFont();

  if (fontState.status !== 'ready') return null;

  return <MessageForm font={fontState.font} />;
};

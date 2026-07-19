/** @jsxImportSource react */
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from './router';
import './style.css';

const rootElement = document.getElementById('root');
if (rootElement === null) throw new Error('Expected #root element');

const root = createRoot(rootElement);
const render = (content: ReactNode): void => root.render(<StrictMode>{content}</StrictMode>);

if (new URLSearchParams(globalThis.location.search).get('__royalReactLifecycleProbe') === '1') {
  void import('./testing/ReactLifecycleProbe').then(({ ReactLifecycleProbe }) => {
    render(<ReactLifecycleProbe />);
  });
} else {
  render(<Router />);
}

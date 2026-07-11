/** @jsxImportSource react */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Router } from './router';
import './style.css';

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Expected #root element');
}

createRoot(rootElement).render(
  <StrictMode>
    <Router />
  </StrictMode>
);

import '@ta-agent/ui-styles/default.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import './gallery.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Agent UI Component Gallery root is missing.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);

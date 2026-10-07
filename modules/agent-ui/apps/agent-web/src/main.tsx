import '@ta-agent/ui-styles/default.css';
import './application/layout.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BrowserAgentWeb, createBrowserComposition } from './application/browser-composition.js';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Agent Web root is missing.');

const composition = createBrowserComposition(window.location.href);

createRoot(root).render(
  <StrictMode>
    <BrowserAgentWeb
      ports={composition.ports}
      profileLabel={composition.label}
      {...('creationConfig' in composition ? { creationConfig: composition.creationConfig } : {})}
    />
  </StrictMode>
);

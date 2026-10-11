import '@ta-agent/ui-styles/default.css';
import './application/layout.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { BrowserAgentWeb, createBrowserComposition } from './application/browser-composition.js';
import { LocalCollectionApplication } from './application/collection-composition.js';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Agent Web root is missing.');

const local = (new URL(window.location.href).searchParams.get('mode') ?? 'local') === 'local';
const composition = local ? undefined : createBrowserComposition(window.location.href);

createRoot(root).render(
  <StrictMode>
    {composition === undefined ? (
      <LocalCollectionApplication />
    ) : (
      <BrowserAgentWeb
        ports={composition.ports}
        profileLabel={composition.label}
        {...('creationConfig' in composition ? { creationConfig: composition.creationConfig } : {})}
      />
    )}
  </StrictMode>
);

import '@ta-agent/ui-styles/default.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { createDeterministicAgentCatalog } from './adapters/deterministic-agent-catalog.js';
import { App } from './app.js';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Agent Web root is missing.');

createRoot(root).render(
  <StrictMode>
    <App agentCatalog={createDeterministicAgentCatalog()} />
  </StrictMode>
);

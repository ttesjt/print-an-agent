import { createRoot } from 'react-dom/client';
import { Notes } from './notes.js';

const mode = new URL(window.location.href).searchParams.get('styles') ?? 'none';
if (!['none', 'default', 'custom'].includes(mode)) throw new Error('Unknown style profile.');
if (mode !== 'none') await import('@ta-agent/ui-styles/default.css');
if (mode === 'custom') await import('./custom.css');

const root = document.getElementById('root');
if (root === null) throw new Error('Missing consumer root.');
createRoot(root).render(
  <main className="ta-ui-root ta-ui-gallery-consumer" data-ta-ui-theme="light">
    <Notes />
  </main>
);

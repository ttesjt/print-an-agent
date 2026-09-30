import {
  AppShell,
  AppShellHeader,
  AppShellInspector,
  AppShellMain,
  AppShellSidebar,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
} from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

const SHELL_COMPOSITIONS = [
  { id: 'main-only', label: 'Main only', sidebar: false, inspector: false },
  { id: 'sidebar-main', label: 'Sidebar + main', sidebar: true, inspector: false },
  { id: 'main-inspector', label: 'Main + inspector', sidebar: false, inspector: true },
  {
    id: 'sidebar-main-inspector',
    label: 'Sidebar + main + inspector',
    sidebar: true,
    inspector: true,
  },
] as const;

export function AppShellGallery() {
  return (
    <GallerySection
      description="Each preview renders only the regions declared by its children; desktop columns are derived from that DOM."
      id="app-shells"
      title="App Shell"
    >
      <Stack space="large">
        {SHELL_COMPOSITIONS.map((composition) => (
          <Stack key={composition.id} space="small">
            <h3>{composition.label}</h3>
            <AppShell className="ta-ui-gallery-shell-demo" data-composition={composition.id}>
              <AppShellHeader>Header</AppShellHeader>
              {composition.sidebar ? (
                <AppShellSidebar aria-label={`${composition.label} sidebar`}>
                  Sidebar
                </AppShellSidebar>
              ) : null}
              <AppShellMain aria-label={`${composition.label} main`} role="region">
                <Panel variant="muted">
                  <PanelHeader>
                    <strong>Main</strong>
                  </PanelHeader>
                  <PanelBody>
                    <p>Primary application content.</p>
                  </PanelBody>
                </Panel>
              </AppShellMain>
              {composition.inspector ? (
                <AppShellInspector aria-label={`${composition.label} inspector`}>
                  Inspector
                </AppShellInspector>
              ) : null}
            </AppShell>
          </Stack>
        ))}
      </Stack>
    </GallerySection>
  );
}

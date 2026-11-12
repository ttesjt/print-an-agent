import { Grid, Panel, PanelBody, PanelHeader } from '@print-an-agent/ui-react';

import { GallerySection } from './gallery-section.js';

export function ThemeGallery() {
  return (
    <GallerySection
      description="Embedded token scopes rebind foreground color while the preview frame chooses its own canvas."
      id="themes"
      title="Embedded themes"
    >
      <Grid columns="two">
        <ThemeBoundary label="Light boundary" theme="light" />
        <ThemeBoundary label="Dark boundary" theme="dark" />
      </Grid>
    </GallerySection>
  );
}

function ThemeBoundary({ label, theme }: Readonly<{ label: string; theme: 'dark' | 'light' }>) {
  return (
    <div className="ta-ui-gallery-theme-boundary" data-ta-ui-theme={theme}>
      <Panel variant="raised">
        <PanelHeader>
          <h3>{label}</h3>
        </PanelHeader>
        <PanelBody>
          <p>Foreground, muted text, surface, border, and shadow all resolve inside this scope.</p>
        </PanelBody>
      </Panel>
    </div>
  );
}

import { Grid, Panel, PanelBody, PanelFooter, PanelHeader } from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

export function PanelGallery() {
  return (
    <GallerySection
      description="Surface variants and semantic Panel sections use the same public component contract."
      id="panels"
      title="Panel"
    >
      <Grid columns="three">
        <Panel>
          <PanelHeader>
            <h3>Default</h3>
          </PanelHeader>
          <PanelBody>
            <p>Default surface and border treatment.</p>
          </PanelBody>
          <PanelFooter>
            <small>PanelFooter</small>
          </PanelFooter>
        </Panel>

        <Panel variant="muted">
          <PanelHeader>
            <h3>Muted</h3>
          </PanelHeader>
          <PanelBody>
            <p>Lower-emphasis supporting content.</p>
          </PanelBody>
          <PanelFooter>
            <small>PanelFooter</small>
          </PanelFooter>
        </Panel>

        <Panel className="ta-ui-gallery-consumer-panel" variant="raised">
          <PanelHeader>
            <h3>Raised</h3>
          </PanelHeader>
          <PanelBody>
            <p>Includes a consumer className extension.</p>
          </PanelBody>
          <PanelFooter>
            <small>ta-ui-gallery-consumer-panel</small>
          </PanelFooter>
        </Panel>
      </Grid>
    </GallerySection>
  );
}

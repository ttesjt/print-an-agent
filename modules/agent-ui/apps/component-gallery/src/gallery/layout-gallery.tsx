import {
  Cluster,
  Grid,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  type ClusterJustification,
  type GridColumns,
  type LayoutAlignment,
  type LayoutSpace,
} from '@ta-agent/ui-react';
import type { ReactNode } from 'react';

import { GallerySection } from './gallery-section.js';

const SPACES: readonly LayoutSpace[] = ['none', 'small', 'medium', 'large'];
const ALIGNMENTS: readonly LayoutAlignment[] = ['start', 'center', 'end', 'stretch'];
const JUSTIFICATIONS: readonly ClusterJustification[] = ['start', 'center', 'end', 'between'];
const GRID_COLUMNS: readonly GridColumns[] = ['one', 'two', 'three', 'auto'];

export function LayoutGallery() {
  return (
    <GallerySection
      description="Bounded semantic variants publish stable data hooks without accepting arbitrary visual values."
      id="layouts"
      title="Layout primitives"
    >
      <Stack space="large">
        <VariantGroup title="Stack spacing">
          <Grid columns="auto">
            {SPACES.map((space) => (
              <Panel key={space} variant="muted">
                <PanelHeader>
                  <h3>{space}</h3>
                </PanelHeader>
                <PanelBody>
                  <Stack space={space}>
                    <DemoItem>First</DemoItem>
                    <DemoItem>Second</DemoItem>
                    <DemoItem>Third</DemoItem>
                  </Stack>
                </PanelBody>
              </Panel>
            ))}
          </Grid>
        </VariantGroup>

        <VariantGroup title="Stack alignment">
          <Grid columns="auto">
            {ALIGNMENTS.map((alignment) => (
              <Panel key={alignment} variant="muted">
                <PanelHeader>
                  <h3>{alignment}</h3>
                </PanelHeader>
                <PanelBody>
                  <Stack align={alignment} className="ta-ui-gallery-alignment-frame" space="small">
                    <DemoItem>Short</DemoItem>
                    <DemoItem>Longer content</DemoItem>
                  </Stack>
                </PanelBody>
              </Panel>
            ))}
          </Grid>
        </VariantGroup>

        <VariantGroup title="Cluster alignment">
          <Grid columns="auto">
            {ALIGNMENTS.map((alignment) => (
              <Panel key={alignment} variant="muted">
                <PanelHeader>
                  <h3>{alignment}</h3>
                </PanelHeader>
                <PanelBody>
                  <Cluster align={alignment} className="ta-ui-gallery-cluster-frame" space="small">
                    <DemoItem>One</DemoItem>
                    <DemoItem tall>Two</DemoItem>
                  </Cluster>
                </PanelBody>
              </Panel>
            ))}
          </Grid>
        </VariantGroup>

        <VariantGroup title="Cluster justification">
          <Stack space="small">
            {JUSTIFICATIONS.map((justification) => (
              <Panel key={justification} variant="muted">
                <Cluster justify={justification} space="small">
                  <strong>{justification}</strong>
                  <DemoItem>One</DemoItem>
                  <DemoItem>Two</DemoItem>
                </Cluster>
              </Panel>
            ))}
          </Stack>
        </VariantGroup>

        <VariantGroup title="Grid columns">
          <Stack space="medium">
            {GRID_COLUMNS.map((columns) => (
              <Panel key={columns} variant="muted">
                <PanelHeader>
                  <h3>{columns}</h3>
                </PanelHeader>
                <PanelBody>
                  <Grid columns={columns} space="small">
                    <DemoItem>One</DemoItem>
                    <DemoItem>Two</DemoItem>
                    <DemoItem>Three</DemoItem>
                  </Grid>
                </PanelBody>
              </Panel>
            ))}
          </Stack>
        </VariantGroup>

        <VariantGroup title="Narrow container">
          <div className="ta-ui-gallery-narrow-frame">
            <Grid columns="three" space="small">
              <DemoItem>One</DemoItem>
              <DemoItem>Two</DemoItem>
              <DemoItem>Three</DemoItem>
            </Grid>
          </div>
        </VariantGroup>
      </Stack>
    </GallerySection>
  );
}

function VariantGroup({ children, title }: Readonly<{ children: ReactNode; title: string }>) {
  return (
    <Stack space="medium">
      <h3>{title}</h3>
      {children}
    </Stack>
  );
}

function DemoItem({ children, tall = false }: Readonly<{ children: ReactNode; tall?: boolean }>) {
  return (
    <span className="ta-ui-gallery-demo-item" data-tall={tall || undefined}>
      {children}
    </span>
  );
}

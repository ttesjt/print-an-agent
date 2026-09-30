import {
  Button,
  Cluster,
  Grid,
  IconButton,
  Panel,
  PanelBody,
  PanelHeader,
  Stack,
  TextLink,
  type ActionAppearance,
  type ActionSize,
  type ActionTone,
  type IconButtonAppearance,
} from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

const APPEARANCES: readonly ActionAppearance[] = ['solid', 'outline', 'ghost', 'text'];
const ICON_BUTTON_APPEARANCES: readonly IconButtonAppearance[] = ['solid', 'outline', 'ghost'];
const TONES: readonly ActionTone[] = ['neutral', 'accent', 'critical'];
const SIZES: readonly ActionSize[] = ['small', 'medium', 'large'];

export function ActionsGallery() {
  return (
    <GallerySection
      description="Native command and navigation elements expose independent appearance, tone, size, and lifecycle hooks."
      id="actions"
      title="Actions"
    >
      <Grid columns="three">
        <Panel variant="muted">
          <PanelHeader>
            <h3>Appearance</h3>
          </PanelHeader>
          <PanelBody>
            <Cluster space="small">
              {APPEARANCES.map((appearance) => (
                <Button appearance={appearance} key={appearance}>
                  {appearance}
                </Button>
              ))}
            </Cluster>
          </PanelBody>
        </Panel>

        <Panel variant="muted">
          <PanelHeader>
            <h3>Tone</h3>
          </PanelHeader>
          <PanelBody>
            <Cluster space="small">
              {TONES.map((tone) => (
                <Button key={tone} tone={tone}>
                  {tone}
                </Button>
              ))}
            </Cluster>
          </PanelBody>
        </Panel>

        <Panel variant="muted">
          <PanelHeader>
            <h3>Size</h3>
          </PanelHeader>
          <PanelBody>
            <Cluster align="center" space="small">
              {SIZES.map((size) => (
                <Button key={size} size={size}>
                  {size}
                </Button>
              ))}
            </Cluster>
          </PanelBody>
        </Panel>
      </Grid>

      <Panel>
        <PanelHeader>
          <h3>Lifecycle and element semantics</h3>
        </PanelHeader>
        <PanelBody>
          <Stack space="medium">
            <Cluster align="center" space="small">
              <Button disabled>Disabled</Button>
              <Button pending>Pending</Button>
              <Button tone="critical">Destructive</Button>
              {ICON_BUTTON_APPEARANCES.map((appearance) => (
                <IconButton
                  appearance={appearance}
                  aria-label={`${appearance} icon action`}
                  key={appearance}
                >
                  ↻
                </IconButton>
              ))}
              <IconButton aria-label="Remove Agent" tone="critical">
                ×
              </IconButton>
            </Cluster>
            <Cluster space="medium">
              <Button appearance="text">Link-like command</Button>
              <TextLink href="#forms">Native navigation link</TextLink>
            </Cluster>
          </Stack>
        </PanelBody>
      </Panel>
    </GallerySection>
  );
}

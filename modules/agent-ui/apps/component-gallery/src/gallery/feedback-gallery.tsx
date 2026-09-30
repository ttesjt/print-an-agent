import {
  Alert,
  Badge,
  Button,
  Cluster,
  EmptyState,
  Grid,
  InlineError,
  Panel,
  PanelBody,
  PanelHeader,
  Separator,
  Skeleton,
  Spinner,
  Stack,
  Status,
  type FeedbackTone,
} from '@ta-agent/ui-react';

import { GallerySection } from './gallery-section.js';

const TONES: readonly FeedbackTone[] = ['neutral', 'accent', 'positive', 'caution', 'critical'];

export function FeedbackGallery() {
  return (
    <GallerySection
      description="Visual tone remains independent from explicit live-region behavior, loading semantics, and application recovery actions."
      id="feedback"
      title="Feedback"
    >
      <Grid columns="two">
        <Panel>
          <PanelHeader>
            <h3>Status and badges</h3>
          </PanelHeader>
          <PanelBody>
            <Stack space="medium">
              <Cluster space="small">
                {TONES.map((tone) => (
                  <Badge key={tone} tone={tone}>
                    {tone}
                  </Badge>
                ))}
              </Cluster>
              <Stack space="small">
                {TONES.map((tone) => (
                  <Status key={tone} tone={tone}>
                    {tone} status
                  </Status>
                ))}
              </Stack>
            </Stack>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <h3>Alerts</h3>
          </PanelHeader>
          <PanelBody>
            <Stack space="small">
              {TONES.map((tone) => (
                <Alert key={tone} tone={tone}>
                  Static {tone} notice
                </Alert>
              ))}
              <Alert announcement="polite" tone="positive">
                Newly saved status announced politely.
              </Alert>
              <InlineError>Inline errors remain silent unless explicitly announced.</InlineError>
            </Stack>
          </PanelBody>
        </Panel>
      </Grid>

      <Grid columns="two">
        <EmptyState
          actions={<Button>Create Agent</Button>}
          description="Create an Agent to begin a new Session."
          title="No Agents yet"
        />

        <Panel variant="muted">
          <PanelHeader>
            <h3>Loading presentation</h3>
          </PanelHeader>
          <PanelBody>
            <Stack space="medium">
              <Cluster align="center" space="small">
                <Spinner label="Loading Agent catalog" />
                <span>Silent labelled spinner</span>
                <Spinner announcement="polite" label="Loading new messages" />
                <span>Polite labelled spinner</span>
                <Spinner decorative />
                <span>Decorative spinner</span>
              </Cluster>
              <Skeleton />
              <Skeleton shape="block" />
              <Cluster align="center" space="small">
                <span>Before</span>
                <Separator orientation="vertical" />
                <span>After</span>
              </Cluster>
              <Separator />
            </Stack>
          </PanelBody>
        </Panel>
      </Grid>
    </GallerySection>
  );
}

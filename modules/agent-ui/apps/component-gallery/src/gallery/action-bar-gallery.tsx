import {
  ActionBar,
  Button,
  ConversationTurnActions,
  Grid,
  IconButton,
  Stack,
  Status,
  TextLink,
  Tooltip,
  type TooltipPlacement,
} from '@print-an-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

const PLACEMENTS: readonly TooltipPlacement[] = ['top', 'right', 'bottom', 'left'];
const TIMESTAMPS = Object.freeze({
  answeredAt: '2026-02-01T12:01:00.000Z',
  sentAt: '2026-02-01T12:00:00.000Z',
});
const LABELS = Object.freeze({
  answeredLabel: 'Answered',
  forkLabel: 'Fork from here',
  rewindLabel: 'Rewind to here',
  sentLabel: 'Sent',
  timestampsLabel: 'Message timestamps',
});
const formatTimestamp = (value: string) => value.replace('T', ' ').replace('.000Z', ' UTC');

export function ActionBarGallery() {
  const [lastAction, setLastAction] = useState('No preview action selected.');
  return (
    <GallerySection
      description="Always-visible commands, optional icon/text content, and informational hover/focus previews. Native Tab navigation; Escape dismisses a tooltip."
      id="action-bars"
      title="Action bars and tooltips"
    >
      <Stack space="large">
        <ActionBar aria-label="Mixed preview actions">
          <Button
            appearance="ghost"
            onClick={() => setLastAction('Saved preview.')}
            size="small"
            tone="neutral"
          >
            Save
          </Button>
          <Tooltip content="Refresh this deterministic preview.">
            {(triggerProps) => (
              <IconButton
                {...triggerProps}
                aria-label="Refresh preview"
                onClick={() => setLastAction('Refreshed preview.')}
                size="small"
              >
                <span aria-hidden="true">↻</span>
              </IconButton>
            )}
          </Tooltip>
          <TextLink href="#conversation">Conversation examples</TextLink>
          <span>Read only information</span>
          <Button appearance="ghost" disabled size="small" tone="neutral">
            Unavailable
          </Button>
        </ActionBar>
        <Status>{lastAction}</Status>

        <Grid columns="two" space="large">
          {PLACEMENTS.map((placement) => (
            <div className="ta-ui-gallery-tooltip-frame" key={placement}>
              <Tooltip
                content={`The ${placement} placement can flip at viewport edges in the anchored top layer.`}
                placement={placement}
              >
                {(triggerProps) => (
                  <Button {...triggerProps} appearance="outline" size="small" tone="neutral">
                    {placement} details
                  </Button>
                )}
              </Tooltip>
            </div>
          ))}
        </Grid>

        <Stack space="small">
          <h3>Completed Turn actions</h3>
          <ConversationTurnActions
            {...TIMESTAMPS}
            {...LABELS}
            aria-label="Completed preview Turn actions"
            formatTimestamp={formatTimestamp}
            onFork={() => setLastAction('Fork preview selected; no backend is connected.')}
            onRewind={() =>
              setLastAction('Rewind preview selected; confirmation belongs to the consumer.')
            }
          />
          <ConversationTurnActions
            {...TIMESTAMPS}
            {...LABELS}
            aria-label="Pending preview Turn actions"
            disabled
            forkPending
            formatTimestamp={formatTimestamp}
            onFork={() => undefined}
            onRewind={() => undefined}
          />
          <ConversationTurnActions
            {...TIMESTAMPS}
            {...LABELS}
            aria-label="Read-only preview Turn metadata"
            formatTimestamp={formatTimestamp}
            tooltipPlacement="right"
          />
        </Stack>
      </Stack>
    </GallerySection>
  );
}

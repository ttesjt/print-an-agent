import {
  Button,
  Cluster,
  Grid,
  Panel,
  PanelBody,
  PanelHeader,
  ReasoningBlock,
  Stack,
  Status,
} from '@print-an-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

const MODES = Object.freeze([
  { autoCollapse: false, autoExpand: false, id: 'manual', label: 'Manual only' },
  { autoCollapse: false, autoExpand: true, id: 'expand', label: 'Auto-expand, remain open' },
  {
    autoCollapse: true,
    autoExpand: true,
    id: 'expand-collapse',
    label: 'Auto-expand and collapse',
  },
]);

const READABLE_CONTENT = Array.from(
  { length: 14 },
  (_, index) =>
    `Readable paragraph ${String(index + 1)}. This is deterministic presentation content, not a provider response. The summary stays outside the scrollable body.`
).join('\n\n');

export function DisclosureActivityGallery() {
  return (
    <GallerySection
      description="Explicit activity drives optional expansion. Manually close or reopen a block to take control; finishing will then leave your choice alone. No model or provider detection is involved."
      id="disclosure-activity"
      title="Disclosure activity and content limits"
    >
      <Grid columns="two">
        {MODES.flatMap((mode) =>
          [true, false].map((bounded) => (
            <ActivityExample bounded={bounded} key={`${mode.id}:${String(bounded)}`} mode={mode} />
          ))
        )}
      </Grid>
    </GallerySection>
  );
}

function ActivityExample({
  bounded,
  mode,
}: Readonly<{ bounded: boolean; mode: (typeof MODES)[number] }>) {
  const [active, setActive] = useState(false);
  const [started, setStarted] = useState(false);
  const [text, setText] = useState(READABLE_CONTENT);
  const [instance, setInstance] = useState(0);
  const id = `${mode.id}-${bounded ? 'bounded' : 'unbounded'}`;

  return (
    <Panel data-disclosure-example={id}>
      <PanelHeader>
        <h3>{mode.label}</h3>
        <p>{bounded ? 'Medium maximum height' : 'Natural content height'}</p>
      </PanelHeader>
      <PanelBody>
        <Stack space="small">
          <Cluster space="small">
            <Button
              disabled={active}
              onClick={() => {
                setStarted(true);
                setActive(true);
              }}
              size="small"
            >
              Start activity
            </Button>
            <Button
              appearance="outline"
              disabled={!active}
              onClick={() => setText((current) => `${current}\n\nNew readable content.`)}
              size="small"
            >
              Append content
            </Button>
            <Button
              appearance="outline"
              disabled={!active}
              onClick={() => setActive(false)}
              size="small"
            >
              Finish activity
            </Button>
            <Button
              appearance="text"
              onClick={() => {
                setActive(false);
                setStarted(false);
                setText(READABLE_CONTENT);
                setInstance((current) => current + 1);
              }}
              size="small"
              tone="neutral"
            >
              Reset example
            </Button>
          </Cluster>
          <Status>{active ? 'Activity running' : started ? 'Activity finished' : 'Ready'}</Status>
          <ReasoningBlock
            activity={{ active, autoCollapse: mode.autoCollapse, autoExpand: mode.autoExpand }}
            block={{ modelTurnIndex: 1, text }}
            {...(bounded ? { contentMaxHeight: 'medium' } : {})}
            key={instance}
            label="Thought process"
            state={active ? 'streaming' : 'completed'}
            stateLabel={active ? 'Live' : null}
          />
        </Stack>
      </PanelBody>
    </Panel>
  );
}

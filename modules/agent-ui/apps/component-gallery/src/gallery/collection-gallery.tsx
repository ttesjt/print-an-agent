import {
  CollectionList,
  CollectionSetupForm,
  FormField,
  Grid,
  Panel,
  PanelBody,
  Stack,
  TextInput,
} from '@print-an-agent/ui-react';
import { useState } from 'react';

import { GallerySection } from './gallery-section.js';

export function CollectionGallery() {
  const [selected, setSelected] = useState<string>();
  return (
    <GallerySection
      id="collections"
      title="Collection selection"
      description="Application-defined references. Selection does not infer storage or open a backend."
    >
      <Grid columns="two">
        <Panel>
          <PanelBody>
            <Stack>
              <CollectionList
                label="Opaque references"
                emptyLabel="No collections"
                {...(selected === undefined ? {} : { selectedKey: selected })}
                onSelect={(choice) => setSelected(choice.key)}
                choices={[{ key: 'opaque', label: 'Opaque locator', reference: 'research/team-a' }]}
              />
              <CollectionList
                label="Object references"
                emptyLabel="No collections"
                {...(selected === undefined ? {} : { selectedKey: selected })}
                onSelect={(choice) => setSelected(choice.key)}
                choices={[
                  {
                    key: 'directory',
                    label: 'Directory example',
                    description: 'A concrete application locator',
                    reference: { rootDirectory: '/example/research' },
                  },
                  {
                    key: 'remote',
                    label: 'Remote example',
                    reference: { tenant: 'team-a', endpoint: 'https://example.invalid' },
                  },
                ]}
              />
              <CollectionList
                label="Empty references"
                emptyLabel="No recent collections"
                choices={[]}
                onSelect={() => undefined}
              />
            </Stack>
          </PanelBody>
        </Panel>
        <CollectionSetupForm
          title="Application fields"
          submitLabel="Open"
          pendingLabel="Opening"
          onSubmit={() => setSelected('submitted')}
        >
          <FormField label="Locator">
            {(props) => <TextInput {...props} defaultValue="research/team-a" />}
          </FormField>
        </CollectionSetupForm>
        <CollectionSetupForm
          title="Opening"
          submitLabel="Open"
          pendingLabel="Opening collection"
          pending
          onSubmit={() => undefined}
        >
          <p>Fields are temporarily disabled.</p>
        </CollectionSetupForm>
        <CollectionSetupForm
          title="Unavailable collection"
          submitLabel="Retry"
          pendingLabel="Opening"
          error="Application could not resolve this locator."
          onSubmit={() => undefined}
        >
          <p>Recovery stays with the application.</p>
        </CollectionSetupForm>
      </Grid>
    </GallerySection>
  );
}

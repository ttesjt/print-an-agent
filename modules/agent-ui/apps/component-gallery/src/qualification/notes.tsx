import { useState } from 'react';
import {
  Button,
  Disclosure,
  DisclosureSummary,
  FormField,
  Panel,
  PanelBody,
  Stack,
  TextInput,
} from '@print-an-agent/ui-react';

/** An independent consumer of public components, without Agent ports or application state. */
export function Notes() {
  const [value, setValue] = useState('');
  const [saved, setSaved] = useState('');
  return (
    <Panel aria-label="Notes">
      <PanelBody>
        <Stack>
          <h1>Independent component consumer</h1>
          <FormField label="Note" description="A local note, never sent to a backend">
            {(field) => (
              <TextInput
                {...field}
                value={value}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            )}
          </FormField>
          <Button onClick={() => setSaved(value)}>Save note</Button>
          <Disclosure>
            <DisclosureSummary>Saved note</DisclosureSummary>
            <p>{saved}</p>
          </Disclosure>
        </Stack>
      </PanelBody>
    </Panel>
  );
}

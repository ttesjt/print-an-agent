import { act } from 'react';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { CollectionList, CollectionSetupForm, FormField, TextInput } from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

it('passes the original application reference without interpreting its shape', () => {
  const choice = {
    key: 'canonical',
    label: 'Team collection',
    reference: { tenant: 'a', shards: [1, 2] },
  };
  const select = vi.fn();
  const container = renderInDocument(
    <CollectionList
      choices={[choice]}
      label="Collections"
      emptyLabel="Empty"
      onSelect={select}
      selectedKey="canonical"
    />
  );
  const button = container.querySelector('button');
  expect(button?.getAttribute('aria-current')).toBe('true');
  act(() => button?.click());
  expect(select).toHaveBeenCalledWith(choice);
  expect(select.mock.calls[0]?.[0]).toBe(choice);
});

it('prevents duplicate opening while pending and preserves accessible application field slots', () => {
  const submit = vi.fn();
  const container = renderInDocument(
    <CollectionSetupForm
      title="Open collection"
      submitLabel="Open"
      pendingLabel="Opening"
      pending
      onSubmit={submit}
    >
      <FormField label="Reference">
        {(props) => <TextInput {...props} value="opaque" readOnly />}
      </FormField>
    </CollectionSetupForm>
  );
  expect(container.querySelector('fieldset')?.disabled).toBe(true);
  const form = container.querySelector('form');
  act(() => {
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelector('label')?.htmlFor).toBe(container.querySelector('input')?.id);
});

import { createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  Checkbox,
  Fieldset,
  FieldsetLegend,
  FormField,
  Label,
  Select,
  Switch,
  Textarea,
  TextInput,
} from '../../src/index.js';
import {
  cleanupReactRoots,
  disableReactActEnvironment,
  enableReactActEnvironment,
  renderInDocument,
} from '../support/react-dom.js';

beforeAll(enableReactActEnvironment);
afterEach(cleanupReactRoots);
afterAll(disableReactActEnvironment);

describe('form controls', () => {
  it('preserves native controlled, uncontrolled, readonly, and disabled attributes', () => {
    const markup = renderToStaticMarkup(
      <form>
        <TextInput defaultValue="draft" name="draft" />
        <TextInput readOnly value="stable" />
        <Textarea disabled defaultValue="Unavailable" />
        <Select defaultValue="b">
          <option value="a">A</option>
          <option value="b">B</option>
        </Select>
        <Checkbox defaultChecked />
        <Switch aria-label="Live updates" defaultChecked />
      </form>
    );

    expect(markup).toContain('class="ta-ui-text-input"');
    expect(markup).toContain('value="draft"');
    expect(markup).toContain('readOnly=""');
    expect(markup).toContain('class="ta-ui-textarea"');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('<select class="ta-ui-select"');
    expect(markup).toContain('class="ta-ui-checkbox"');
    expect(markup).toContain('class="ta-ui-switch"');
    expect(markup).toContain('role="switch"');
    expect(markup).not.toContain('style=');
  });

  it('connects labels, descriptions, and errors through the FormField render contract', () => {
    const markup = renderToStaticMarkup(
      <FormField
        controlId="agent-name"
        description="Used in the Agent catalog."
        error="Name is required."
        label="Agent name"
        required
      >
        {(controlProps) => <TextInput {...controlProps} name="agentName" />}
      </FormField>
    );

    const container = document.createElement('div');
    container.innerHTML = markup;
    const label = container.querySelector<HTMLLabelElement>('[data-slot="label"]');
    const input = container.querySelector<HTMLInputElement>('#agent-name');

    expect(container.querySelector('[data-slot="form-field"]')).not.toBeNull();
    expect(label?.htmlFor).toBe('agent-name');
    expect(input?.getAttribute('aria-describedby')).toBe('agent-name-description agent-name-error');
    expect(input?.getAttribute('aria-errormessage')).toBe('agent-name-error');
    expect(input?.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#agent-name-description')).not.toBeNull();
    expect(container.querySelector('#agent-name-error')).not.toBeNull();
  });

  it('forwards native refs and leaves uncontrolled state with the browser', () => {
    const inputRef = createRef<HTMLInputElement>();
    const container = renderInDocument(
      <div>
        <Label htmlFor="toggle">Enabled</Label>
        <Switch id="toggle" ref={inputRef} />
      </div>
    );
    const toggle = container.querySelector<HTMLInputElement>('#toggle');

    expect(inputRef.current).toBe(toggle);
    expect(toggle?.checked).toBe(false);
    toggle?.click();
    expect(toggle?.checked).toBe(true);
  });

  it('keeps group semantics native', () => {
    const markup = renderToStaticMarkup(
      <Fieldset disabled>
        <FieldsetLegend>Capabilities</FieldsetLegend>
        <Checkbox aria-label="Tools" />
      </Fieldset>
    );

    expect(markup).toContain('<fieldset class="ta-ui-fieldset"');
    expect(markup).toContain('<legend class="ta-ui-fieldset__legend"');
    expect(markup).toContain('disabled=""');
  });
});

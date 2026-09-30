import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Panel, PanelBody, PanelFooter, PanelHeader } from '../../src/index.js';

describe('Panel', () => {
  it('publishes stable style and state hooks without loading visual policy', () => {
    const markup = renderToStaticMarkup(
      <Panel className="consumer-panel" id="summary" variant="raised">
        Agent summary
      </Panel>
    );

    expect(markup).toContain('class="ta-ui-panel consumer-panel"');
    expect(markup).toContain('data-slot="panel"');
    expect(markup).toContain('data-variant="raised"');
    expect(markup).toContain('id="summary"');
    expect(markup).not.toContain('style=');
  });

  it('uses the default variant and ignores empty class extensions', () => {
    const markup = renderToStaticMarkup(<Panel className="  ">Content</Panel>);

    expect(markup).toContain('class="ta-ui-panel"');
    expect(markup).toContain('data-variant="default"');
  });

  it('publishes semantic section hooks without owning visual policy', () => {
    const markup = renderToStaticMarkup(
      <Panel>
        <PanelHeader className="consumer-header">Header</PanelHeader>
        <PanelBody aria-label="Content">Body</PanelBody>
        <PanelFooter>Footer</PanelFooter>
      </Panel>
    );

    expect(markup).toContain('<header class="ta-ui-panel__header consumer-header"');
    expect(markup).toContain('data-slot="panel-header"');
    expect(markup).toContain('<div aria-label="Content" class="ta-ui-panel__body"');
    expect(markup).toContain('data-slot="panel-body"');
    expect(markup).toContain('<footer class="ta-ui-panel__footer"');
    expect(markup).toContain('data-slot="panel-footer"');
    expect(markup).not.toContain('style=');
  });
});

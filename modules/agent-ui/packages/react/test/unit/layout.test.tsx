import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AppShell,
  AppShellHeader,
  AppShellInspector,
  AppShellMain,
  AppShellSidebar,
  Cluster,
  Grid,
  Stack,
} from '../../src/index.js';

describe('layout primitives', () => {
  it('publishes bounded layout variants through stable data hooks', () => {
    const markup = renderToStaticMarkup(
      <Stack align="center" className="consumer-stack" id="content" space="large">
        <Cluster justify="between" space="small">
          <span>One</span>
          <span>Two</span>
        </Cluster>
        <Grid columns="three" space="none">
          <span>Three</span>
        </Grid>
      </Stack>
    );

    expect(markup).toContain('class="ta-ui-stack consumer-stack"');
    expect(markup).toContain('data-align="center"');
    expect(markup).toContain('data-space="large"');
    expect(markup).toContain('id="content"');
    expect(markup).toContain('class="ta-ui-cluster"');
    expect(markup).toContain('data-justify="between"');
    expect(markup).toContain('class="ta-ui-grid"');
    expect(markup).toContain('data-columns="three"');
    expect(markup).not.toContain('style=');
  });

  it('uses explicit defaults rather than implicit CSS state', () => {
    const markup = renderToStaticMarkup(
      <>
        <Stack />
        <Cluster />
        <Grid />
      </>
    );

    expect(markup).toContain('data-align="stretch"');
    expect(markup).toContain('data-align="center"');
    expect(markup).toContain('data-justify="start"');
    expect(markup).toContain('data-columns="auto"');
    expect(markup.match(/data-space="medium"/g)).toHaveLength(3);
  });

  it('keeps shell landmarks in consumer-authored DOM order', () => {
    const markup = renderToStaticMarkup(
      <AppShell className="consumer-shell">
        <AppShellHeader>Header</AppShellHeader>
        <AppShellSidebar aria-label="Navigation">Sidebar</AppShellSidebar>
        <AppShellMain>Main</AppShellMain>
        <AppShellInspector aria-label="Inspector">Inspector</AppShellInspector>
      </AppShell>
    );

    const headerIndex = markup.indexOf('data-slot="app-shell-header"');
    const sidebarIndex = markup.indexOf('data-slot="app-shell-sidebar"');
    const mainIndex = markup.indexOf('data-slot="app-shell-main"');
    const inspectorIndex = markup.indexOf('data-slot="app-shell-inspector"');

    expect(markup).toContain('class="ta-ui-app-shell consumer-shell"');
    expect(markup).toContain('<header');
    expect(markup).toContain('<main');
    expect(markup.match(/<aside/g)).toHaveLength(2);
    expect(headerIndex).toBeGreaterThan(-1);
    expect(sidebarIndex).toBeGreaterThan(headerIndex);
    expect(mainIndex).toBeGreaterThan(sidebarIndex);
    expect(inspectorIndex).toBeGreaterThan(mainIndex);
    expect(markup).not.toContain('style=');
  });

  it('does not invent omitted optional shell regions', () => {
    const mainOnly = renderToStaticMarkup(
      <AppShell>
        <AppShellHeader>Header</AppShellHeader>
        <AppShellMain>Main</AppShellMain>
      </AppShell>
    );
    const sidebarAndMain = renderToStaticMarkup(
      <AppShell>
        <AppShellSidebar>Sidebar</AppShellSidebar>
        <AppShellMain>Main</AppShellMain>
      </AppShell>
    );
    const mainAndInspector = renderToStaticMarkup(
      <AppShell>
        <AppShellMain>Main</AppShellMain>
        <AppShellInspector>Inspector</AppShellInspector>
      </AppShell>
    );

    expect(mainOnly).not.toContain('app-shell-sidebar');
    expect(mainOnly).not.toContain('app-shell-inspector');
    expect(sidebarAndMain).toContain('app-shell-sidebar');
    expect(sidebarAndMain).not.toContain('app-shell-inspector');
    expect(mainAndInspector).not.toContain('app-shell-sidebar');
    expect(mainAndInspector).toContain('app-shell-inspector');
  });
});

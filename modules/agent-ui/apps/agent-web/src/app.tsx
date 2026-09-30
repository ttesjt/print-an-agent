import type { AgentCatalogPort, AgentSummary } from '@ta-agent/ui-contracts';
import {
  Alert,
  AppShell,
  AppShellHeader,
  AppShellInspector,
  AppShellMain,
  AppShellSidebar,
  Cluster,
  EmptyState,
  Grid,
  Panel,
  PanelBody,
  PanelFooter,
  PanelHeader,
  Stack,
  Status,
} from '@ta-agent/ui-react';
import { useEffect, useState } from 'react';

export interface AppProps {
  readonly agentCatalog: AgentCatalogPort;
}

type AgentCatalogState =
  | Readonly<{ status: 'loading' }>
  | Readonly<{ status: 'ready'; agents: readonly AgentSummary[] }>
  | Readonly<{ status: 'failed' }>;

export function App({ agentCatalog }: AppProps) {
  const [catalogState, setCatalogState] = useState<AgentCatalogState>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const agents = await agentCatalog.listAgents({ signal: controller.signal });
        if (!controller.signal.aborted) setCatalogState({ status: 'ready', agents });
      } catch {
        if (!controller.signal.aborted) setCatalogState({ status: 'failed' });
      }
    };
    void load();
    return () => controller.abort();
  }, [agentCatalog]);

  return (
    <AppShell className="ta-ui-root">
      <AppShellHeader>
        <Cluster justify="between" space="small">
          <strong>Agent Web</strong>
          <span>Visual and layout foundations</span>
        </Cluster>
      </AppShellHeader>

      <AppShellSidebar aria-labelledby="agent-catalog-title">
        <Stack space="small">
          <h2 id="agent-catalog-title">Agents</h2>
          <AgentCatalog state={catalogState} />
        </Stack>
      </AppShellSidebar>

      <AppShellMain>
        <Stack space="large">
          <Panel aria-labelledby="agent-web-title" variant="raised">
            <PanelHeader>
              <h1 id="agent-web-title">Composable Agent interfaces</h1>
              <p>Structure and visual policy remain independently replaceable.</p>
            </PanelHeader>
            <PanelBody>
              <p>
                This walking skeleton consumes a UI-owned port, unstyled React layout primitives,
                and an explicitly imported default stylesheet.
              </p>
            </PanelBody>
            <PanelFooter>
              <p>Resize the viewport to verify stable reading order and responsive reflow.</p>
            </PanelFooter>
          </Panel>

          <Grid columns="two">
            <Panel variant="muted">
              <PanelHeader>
                <h2>Global visual language</h2>
              </PanelHeader>
              <PanelBody>
                <p>Semantic tokens define themes, typography, spacing, and accessible states.</p>
              </PanelBody>
            </Panel>
            <Panel variant="muted">
              <PanelHeader>
                <h2>Stable layout semantics</h2>
              </PanelHeader>
              <PanelBody>
                <p>Responsive CSS changes layout without changing or hiding semantic regions.</p>
              </PanelBody>
            </Panel>
          </Grid>
        </Stack>
      </AppShellMain>

      <AppShellInspector aria-labelledby="foundation-title">
        <Stack space="small">
          <h2 id="foundation-title">Foundation</h2>
          <p>Theme: system</p>
          <p>Stylesheet: optional default</p>
          <p>Backend: deterministic port</p>
        </Stack>
      </AppShellInspector>
    </AppShell>
  );
}

function AgentCatalog({ state }: Readonly<{ state: AgentCatalogState }>) {
  if (state.status === 'loading') {
    return <Status announcement="polite">Loading Agents…</Status>;
  }
  if (state.status === 'failed') {
    return (
      <Alert announcement="assertive" tone="critical">
        Agents could not be loaded.
      </Alert>
    );
  }
  if (state.agents.length === 0) {
    return <EmptyState title="No Agents are available." />;
  }
  return (
    <ul className="ta-ui-record-list" aria-label="Agents">
      {state.agents.map((agent) => (
        <li className="ta-ui-record-list__item" key={agent.agentId}>
          <span>{agent.displayName}</span>
          <span className="ta-ui-record-list__status">{agent.status}</span>
        </li>
      ))}
    </ul>
  );
}

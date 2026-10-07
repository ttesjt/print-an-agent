import { useCallback, useEffect, useRef, useState } from 'react';
import { App } from '../app.js';
import { createHttpAgentWebPorts } from '../adapters/http-agent-web-ports.js';
import { createDeterministicAgentManagement } from '../adapters/deterministic-agent-management.js';
import { createDeterministicSessionManagement } from '../adapters/deterministic-session-management.js';
import { createDeterministicConversationManagement } from '../adapters/deterministic-conversation-management.js';
import {
  readWorkspaceLocation,
  workspaceHash,
  type WorkspaceLocation,
} from './workspace-location.js';
import type { AgentWebPorts } from './ports.js';
import type { DemoAgentConfig } from './demo-agent-config.js';

export function createBrowserComposition(url: string) {
  const mode = new URL(url).searchParams.get('mode') ?? 'local';
  if (mode === 'local') return { label: 'Local Agent Base', ports: createHttpAgentWebPorts() };
  if (mode !== 'deterministic') throw new Error('Unsupported application mode.');
  const sessions = createDeterministicSessionManagement();
  return {
    label: 'Deterministic fixtures',
    ports: {
      agents: createDeterministicAgentManagement(),
      sessions,
      conversations: createDeterministicConversationManagement(sessions),
    },
  };
}

/** Location is application selection, not runtime ownership or a durable branch mutation. */
export function BrowserAgentWeb({
  ports,
  profileLabel,
}: Readonly<{ ports: AgentWebPorts<DemoAgentConfig>; profileLabel: string }>) {
  const [requestedLocation, setRequestedLocation] = useState<WorkspaceLocation | undefined>(() =>
    window.location.hash === '' ? undefined : safeLocation()
  );
  const pending = useRef(requestedLocation !== undefined);
  useEffect(() => {
    const navigate = () => {
      pending.current = true;
      setRequestedLocation(safeLocation());
    };
    window.addEventListener('popstate', navigate);
    window.addEventListener('hashchange', navigate);
    return () => {
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('hashchange', navigate);
    };
  }, []);
  const selected = useCallback(
    (location: WorkspaceLocation) => {
      if (
        pending.current &&
        (location.agentId !== requestedLocation?.agentId ||
          location.sessionId !== requestedLocation?.sessionId)
      )
        return;
      pending.current = false;
      const hash = workspaceHash(location);
      if (window.location.hash !== hash)
        window.history.pushState(
          null,
          '',
          `${window.location.pathname}${window.location.search}${hash}`
        );
    },
    [requestedLocation]
  );
  return (
    <App
      ports={ports}
      profileLabel={profileLabel}
      {...(requestedLocation === undefined ? {} : { requestedLocation })}
      onLocationChange={selected}
    />
  );
}
function safeLocation(): WorkspaceLocation {
  try {
    return readWorkspaceLocation(window.location.hash);
  } catch {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return {};
  }
}

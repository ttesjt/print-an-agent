import { BrowserAgentWorkspace } from '@ta-agent/ui-workspace';
import { useMemo } from 'react';
import { createDefaultConnection } from './default-extension.js';
import type { AppProps } from '../app.js';
import { createHttpAgentWebPorts } from '../adapters/http-agent-web-ports.js';
import { createDeterministicAgentManagement } from '../adapters/deterministic-agent-management.js';
import { createDeterministicSessionManagement } from '../adapters/deterministic-session-management.js';
import { createDeterministicConversationManagement } from '../adapters/deterministic-conversation-management.js';
import { DEFAULT_AGENT_CONFIG } from './agent-config.js';
export function createBrowserComposition(url: string) {
  const mode = new URL(url).searchParams.get('mode') ?? 'local';
  if (mode === 'local') return { label: 'Local Agent Base', ports: createHttpAgentWebPorts() };
  if (mode !== 'deterministic') throw new Error('Unsupported application mode.');
  const sessions = createDeterministicSessionManagement();
  return {
    label: 'Deterministic fixtures',
    creationConfig: {
      ...DEFAULT_AGENT_CONFIG,
      model: { kind: 'engine' as const, engineId: 'agent-web.offline' },
    },
    ports: {
      agents: createDeterministicAgentManagement(),
      sessions,
      conversations: createDeterministicConversationManagement(sessions),
    },
  };
}

export function BrowserAgentWeb({
  ports,
  creationConfig,
  profileLabel,
  ...props
}: AppProps & {
  readonly collectionKey?: string;
  readonly onHashPublished?: (hash: string) => void;
}) {
  const connection = useMemo(
    () => createDefaultConnection(ports, profileLabel, creationConfig),
    [ports, profileLabel, creationConfig]
  );
  return <BrowserAgentWorkspace {...props} {...connection} />;
}

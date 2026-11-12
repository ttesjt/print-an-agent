import { AgentWorkspace, type AgentWorkspaceProps } from '@print-an-agent/ui-workspace';
import { useMemo } from 'react';
import type { AgentWebConfig } from './application/agent-config.js';
import type { AgentWebPorts } from './application/ports.js';
import { createDefaultConnection } from './application/default-extension.js';

export interface AppProps extends Omit<AgentWorkspaceProps, 'ports' | 'extension'> {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly creationConfig?: AgentWebConfig;
}
export function App({ ports, creationConfig, profileLabel, ...props }: AppProps) {
  const connection = useMemo(
    () => createDefaultConnection(ports, profileLabel, creationConfig),
    [ports, profileLabel, creationConfig]
  );
  return <AgentWorkspace {...props} {...connection} />;
}

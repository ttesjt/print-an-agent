import {
  CollectionApplication as WorkspaceCollections,
  type CollectionApplicationProps,
  type CollectionConnection as WorkspaceConnection,
} from '@ta-agent/ui-workspace';
import type { CollectionAccessPort, CollectionReference } from '@ta-agent/ui-contracts';
import { useMemo } from 'react';
import type { AgentWebConfig } from '../application/agent-config.js';
import type { AgentWebPorts } from '../application/ports.js';
import { createDefaultConnection } from '../application/default-extension.js';

export interface CollectionConnection {
  readonly ports: AgentWebPorts<AgentWebConfig>;
  readonly profileLabel: string;
  readonly creationConfig?: AgentWebConfig;
}
export function CollectionApplication<Reference extends CollectionReference>({
  access,
  ...props
}: Omit<CollectionApplicationProps<Reference>, 'access'> & {
  readonly access: CollectionAccessPort<CollectionConnection, Reference>;
}) {
  const workspaceAccess = useMemo<CollectionAccessPort<WorkspaceConnection, Reference>>(
    () => ({
      openCollection: async (input) => {
        const result = await access.openCollection(input);
        if (!result.ok) return result;
        const { ports, profileLabel, creationConfig } = result.connection;
        return {
          ...result,
          connection: createDefaultConnection(ports, profileLabel, creationConfig),
        };
      },
    }),
    [access]
  );
  return <WorkspaceCollections {...props} access={workspaceAccess} />;
}

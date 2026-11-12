import type { AgentDetails } from '@print-an-agent/ui-contracts';
import type { ComponentType, ReactNode } from 'react';

export interface WorkspaceEditBoundary {
  readonly dirty: boolean;
  readonly working: boolean;
  /** Defaults to working. False is appropriate only when the owner retains in-flight work across selection. */
  readonly navigationBlocked?: boolean;
  readonly editIdentity: object | undefined;
  readonly discard: () => void;
}

export interface WorkspaceSurfaces {
  /** Application-owned actions; the workspace does not interpret their domain behavior. */
  readonly headerActions?: ReactNode;
  readonly settings?: ReactNode;
  readonly inspector?: ReactNode;
  readonly createDialog?: ReactNode;
  readonly requestCreate?: () => void;
  readonly boundary?: WorkspaceEditBoundary;
  readonly interaction?: Readonly<{ allowed: boolean; notice?: ReactNode }>;
}

/** Provider implementation is product-owned; rendering and navigation remain workspace-owned. */
export interface WorkspaceExtensionProps {
  readonly agent: AgentDetails | undefined;
  readonly refresh: () => void;
  readonly onCreated: (agentId: string) => void;
  /** Notify confirmed removal from this Collection; never infer removal from a failed read. */
  readonly onRemoved: (agentId: string) => void;
  readonly children: (surfaces: WorkspaceSurfaces) => ReactNode;
}
export type WorkspaceExtension = ComponentType<WorkspaceExtensionProps>;

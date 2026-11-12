import type { ManagedAgentAuthoritySnapshot } from '@print-an-agent/base-composition';
import type {
  SessionLifecycleSummary,
  SessionNavigationSnapshot,
} from '@print-an-agent/base-session';
import type {
  AgentSnapshot,
  SessionDetails,
  SessionNavigationSnapshot as WebNavigation,
} from '@print-an-agent/ui-contracts';
import type { AgentWebConfig } from '../../application/agent-config.js';

export function revision(value: string): number {
  if (!/^(0|[1-9][0-9]*)$/u.test(value) || !Number.isSafeInteger(Number(value)))
    throw new Error('Invalid revision token.');
  return Number(value);
}

export function projectAgent(
  snapshot: ManagedAgentAuthoritySnapshot<AgentWebConfig>
): AgentSnapshot<AgentWebConfig> {
  const identity = snapshot.identity;
  return {
    details: {
      agentId: identity.identity.id,
      displayName: identity.identity.displayName,
      identityRevision: String(identity.revision),
      status: identity.status,
      createdAt: new Date(identity.createdAt).toISOString(),
      updatedAt: new Date(identity.updatedAt).toISOString(),
    },
    config: {
      agentId: identity.identity.id,
      revision: String(snapshot.config.revision),
      value: snapshot.config.value,
    },
  };
}

export function projectSession(snapshot: SessionLifecycleSummary): SessionDetails {
  const summary = {
    agentId: snapshot.agentId,
    branchCount: snapshot.branchCount,
    createdAt: new Date(snapshot.createdAt).toISOString(),
    metadataRevision: String(snapshot.metadataRevision),
    navigationRevision: String(snapshot.navigationRevision),
    selectedBranchId: snapshot.selectedBranchId,
    sessionId: snapshot.sessionId,
    turnCount: snapshot.turnCount,
    updatedAt: new Date(Math.max(snapshot.updatedAt, snapshot.metadataUpdatedAt)).toISOString(),
    ...(snapshot.title === undefined ? {} : { title: snapshot.title }),
  };
  return snapshot.status === 'active'
    ? { ...summary, status: 'active' }
    : {
        ...summary,
        status: 'retired',
        retiredAt: new Date(snapshot.retiredAt).toISOString(),
      };
}

export function projectNavigation(snapshot: SessionNavigationSnapshot): WebNavigation {
  return {
    agentId: snapshot.agentId,
    sessionId: snapshot.sessionId,
    revision: String(snapshot.revision),
    selectedBranchId: snapshot.selectedBranchId,
    branches: snapshot.branches.map((branch) => ({
      ...branch,
      createdAt: new Date(branch.createdAt).toISOString(),
    })),
  };
}

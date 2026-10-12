import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useWorkspaceAgents } from './agent/use-workspace-agents.js';
import { useAgentMetadata } from './agent/use-agent-metadata.js';
import { useSessionManagement } from './session/use-session-management.js';
import { useConversationManagement } from './conversation/use-conversation-management.js';
import type { AgentWorkspaceProps } from './workspace.js';

/** One mounted Collection owns these coordinators; removal never remounts unrelated work. */
export function useWorkspaceController(props: AgentWorkspaceProps) {
  const [appliedLocation, setAppliedLocation] = useState(props.requestedLocation);
  const [view, setView] = useState<'conversation' | 'settings'>(
    props.requestedLocation?.view ?? 'conversation'
  );
  const [selectionReset, setSelectionReset] = useState(0);
  const agents = useWorkspaceAgents(props.ports.agents, appliedLocation);
  const sessions = useSessionManagement(
    agents.selectedAgentId,
    props.ports.sessions,
    appliedLocation
  );
  const metadata = useAgentMetadata(props.ports.agents, agents.selected, agents.refresh);
  const conversation = useConversationManagement({
    agentId: agents.selectedAgentId,
    management: props.ports.conversations,
    onConversationCommitted: sessions.synchronizeConversationCommit,
    onSessionAdmitted: sessions.synchronizeConversationAdmission,
    onInteractionSettled: sessions.reconcileInteractionCatalog,
    onNavigationChanged: sessions.reconcileSession,
    sessionState:
      view === 'settings' && sessions.selectionState.status === 'draft'
        ? { status: 'idle' }
        : sessions.selectionState,
  });
  useEffect(() => {
    if (
      view === 'conversation' &&
      agents.selectedAgentId !== undefined &&
      (appliedLocation?.sessionId === undefined ||
        appliedLocation.agentId !== agents.selectedAgentId) &&
      sessions.selectedSessionId === undefined &&
      sessions.lifecycleFilter === 'active' &&
      sessions.selectionState.status === 'idle'
    )
      sessions.createDraft();
  }, [
    view,
    appliedLocation,
    agents.selectedAgentId,
    sessions.selectedSessionId,
    sessions.lifecycleFilter,
    sessions.selectionState.status,
    sessions.createDraft,
  ]);
  const owners = {
    agents,
    sessions,
    metadata,
    conversation,
    onLocationChange: props.onLocationChange,
  };
  const current = useRef(owners);
  current.current = owners;
  const mounted = useRef(true);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const removed = useCallback((id: string) => {
    if (!mounted.current) return;
    const owners = current.current;
    if (owners.agents.isRemoved(id)) return;
    const wasSelected = owners.agents.removeAgent(id);
    owners.sessions.forgetAgent(id);
    owners.conversation.forgetAgent(id);
    owners.metadata.forgetAgent(id);
    if (!wasSelected) return;
    const empty = { view: 'conversation' } as const;
    setAppliedLocation(empty);
    setView('conversation');
    setSelectionReset((value) => value + 1);
    // A confirmed result supersedes unsaved-edit navigation, including pending URL requests.
    owners.onLocationChange?.(empty, { replace: true });
  }, []);
  const created = useCallback((id: string) => {
    if (!mounted.current) return;
    current.current.agents.createdAgent(id);
    setView('settings');
  }, []);
  return {
    agents,
    sessions,
    metadata,
    conversation,
    appliedLocation,
    setAppliedLocation,
    view,
    setView,
    selectionReset,
    created,
    removed,
  };
}
export type WorkspaceController = ReturnType<typeof useWorkspaceController>;

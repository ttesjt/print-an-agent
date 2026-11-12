import type { WorkspacePorts } from '@print-an-agent/ui-contracts';
import { object, optional, union, literal } from './decoder.js';

/** Advertisement, not authorization. Servers still enforce access on every operation. */
export interface WorkspaceTransportCapabilities {
  readonly renameAgent?: boolean;
  readonly disableAgent?: boolean;
  readonly reactivateAgent?: boolean;
  readonly renameSession?: boolean;
  readonly retireSession?: boolean;
  readonly restoreSession?: boolean;
  readonly purgeSession?: boolean;
  readonly selectSessionBranch?: boolean;
  readonly forkSessionBranch?: boolean;
  readonly rewindSessionBranch?: boolean;
}
const capability = optional(union(literal(true), literal(false)));
export const workspaceCapabilitiesDecoder = object({
  renameAgent: capability,
  disableAgent: capability,
  reactivateAgent: capability,
  renameSession: capability,
  retireSession: capability,
  restoreSession: capability,
  purgeSession: capability,
  selectSessionBranch: capability,
  forkSessionBranch: capability,
  rewindSessionBranch: capability,
});
export function workspaceCapabilities(ports: WorkspacePorts): WorkspaceTransportCapabilities {
  return {
    renameAgent: typeof ports.agents.renameAgent === 'function',
    disableAgent: typeof ports.agents.disableAgent === 'function',
    reactivateAgent: typeof ports.agents.reactivateAgent === 'function',
    renameSession: typeof ports.sessions.renameSession === 'function',
    retireSession: typeof ports.sessions.retireSession === 'function',
    restoreSession: typeof ports.sessions.restoreSession === 'function',
    purgeSession: typeof ports.sessions.purgeSession === 'function',
    selectSessionBranch: typeof ports.sessions.selectSessionBranch === 'function',
    forkSessionBranch: typeof ports.conversations.forkSessionBranch === 'function',
    rewindSessionBranch: typeof ports.conversations.rewindSessionBranch === 'function',
  };
}

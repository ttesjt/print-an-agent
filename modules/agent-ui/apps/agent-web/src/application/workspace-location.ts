export interface WorkspaceLocation {
  readonly agentId?: string;
  readonly sessionId?: string;
}
export function readWorkspaceLocation(hash: string): WorkspaceLocation {
  const fields = new URLSearchParams(hash.replace(/^#/u, ''));
  const agentId = fields.get('agent') ?? undefined;
  const sessionId = fields.get('session') ?? undefined;
  if (
    [...fields.keys()].some((key) => key !== 'agent' && key !== 'session') ||
    [...fields.keys()].length !== new Set(fields.keys()).size ||
    [agentId, sessionId].some(
      (value) => value !== undefined && (value.length === 0 || value.length > 256)
    ) ||
    (sessionId !== undefined && agentId === undefined)
  )
    throw new Error('Invalid workspace location.');
  return {
    ...(agentId === undefined ? {} : { agentId }),
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}
export function workspaceHash(location: WorkspaceLocation): string {
  const fields = new URLSearchParams();
  if (location.agentId !== undefined) fields.set('agent', location.agentId);
  if (location.agentId !== undefined && location.sessionId !== undefined)
    fields.set('session', location.sessionId);
  return fields.size === 0 ? '' : `#${fields.toString()}`;
}

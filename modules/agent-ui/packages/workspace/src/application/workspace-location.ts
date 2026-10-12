export interface WorkspaceLocation {
  readonly agentId?: string;
  readonly sessionId?: string;
  readonly view?: 'conversation' | 'settings';
}
export function readWorkspaceLocation(hash: string): WorkspaceLocation {
  const fields = new URLSearchParams(hash.replace(/^#/u, ''));
  const agentId = fields.get('agent') ?? undefined;
  const sessionId = fields.get('session') ?? undefined;
  const view = fields.get('view') ?? undefined;
  if (
    [...fields.keys()].some((key) => !['agent', 'session', 'view'].includes(key)) ||
    (view !== undefined && view !== 'conversation' && view !== 'settings') ||
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
    ...(view === undefined ? {} : { view }),
  };
}
export function workspaceHash(location: WorkspaceLocation): string {
  const fields = new URLSearchParams();
  if (location.agentId !== undefined) fields.set('agent', location.agentId);
  if (location.agentId !== undefined && location.sessionId !== undefined)
    fields.set('session', location.sessionId);
  if (location.view !== undefined) fields.set('view', location.view);
  return fields.size === 0 ? '' : `#${fields.toString()}`;
}

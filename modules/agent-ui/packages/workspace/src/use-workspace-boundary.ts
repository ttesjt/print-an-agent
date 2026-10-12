import { useRef } from 'react';
import type { WorkspaceEditBoundary } from './extensions.js';

/** Explicit participants only; no global registry and no inferred product dependencies. */
export function useWorkspaceBoundary(
  participants: readonly (WorkspaceEditBoundary | undefined)[]
): WorkspaceEditBoundary {
  const active = participants.filter(
    (entry): entry is WorkspaceEditBoundary => entry !== undefined
  );
  const identities = active.filter((entry) => entry.dirty).map((entry) => entry.editIdentity);
  const previous = useRef<{ identities: readonly (object | undefined)[]; identity: object }>({
    identities: [],
    identity: {},
  });
  if (
    identities.length !== previous.current.identities.length ||
    identities.some((identity, index) => identity !== previous.current.identities[index])
  )
    previous.current = { identities, identity: {} };
  return {
    dirty: active.some((entry) => entry.dirty),
    working: active.some((entry) => entry.working),
    navigationBlocked: active.some((entry) => entry.navigationBlocked ?? entry.working),
    editIdentity: identities.length === 0 ? undefined : previous.current.identity,
    discard: () => {
      for (const entry of active) entry.discard();
    },
  };
}

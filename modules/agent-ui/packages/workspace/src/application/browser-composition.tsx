import { useCallback, useEffect, useRef, useState } from 'react';
import { AgentWorkspace } from '../workspace.js';
import type { WorkspaceExtension } from '../extensions.js';
import {
  readWorkspaceLocation,
  workspaceHash,
  type WorkspaceLocation,
} from './workspace-location.js';
import type { WorkspacePorts } from '@ta-agent/ui-contracts';
import { collectionHash, readCollectionLocation } from '../collection/collection-location.js';
import type { CollectionBoundaryState } from '../collection/collection-application.js';

/** Location is application selection, not runtime ownership or a durable branch mutation. */
export function BrowserAgentWorkspace({
  ports,
  profileLabel,
  extension,
  collectionKey,
  onRequestCollections,
  onBoundaryStateChange,
  onHashPublished,
}: Readonly<{
  ports: WorkspacePorts;
  profileLabel: string;
  extension?: WorkspaceExtension;
  collectionKey?: string;
  onRequestCollections?: () => void;
  onBoundaryStateChange?: (state: CollectionBoundaryState) => void;
  onHashPublished?: (hash: string) => void;
}>) {
  const [requestedLocation, setRequestedLocation] = useState<WorkspaceLocation | undefined>(() =>
    window.location.hash === '' ? undefined : safeLocation(collectionKey)
  );
  const pending = useRef(requestedLocation !== undefined);
  const publishedHash = useRef(window.location.hash);
  useEffect(() => {
    const navigate = () => {
      // Application URL publication is not a new navigation request (including late echoes).
      if (window.location.hash === publishedHash.current) return;
      if (collectionKey !== undefined) {
        try {
          const location = readCollectionLocation(window.location.hash);
          if (location.route !== 'workspace' || location.collectionKey !== collectionKey) return;
        } catch {
          return;
        }
      }
      publishedHash.current = window.location.hash;
      pending.current = true;
      setRequestedLocation(safeLocation(collectionKey));
    };
    window.addEventListener('popstate', navigate);
    window.addEventListener('hashchange', navigate);
    return () => {
      window.removeEventListener('popstate', navigate);
      window.removeEventListener('hashchange', navigate);
    };
  }, [collectionKey]);
  const selected = useCallback(
    (location: WorkspaceLocation, options?: Readonly<{ replace?: boolean }>) => {
      if (
        pending.current &&
        !options?.replace &&
        ((requestedLocation?.agentId !== undefined &&
          location.agentId !== requestedLocation.agentId) ||
          location.sessionId !== requestedLocation?.sessionId ||
          location.view !== (requestedLocation?.view ?? 'conversation'))
      )
        return;
      pending.current = false;
      const hash =
        collectionKey === undefined
          ? workspaceHash(location)
          : collectionHash(collectionKey, location);
      publishedHash.current = hash;
      onHashPublished?.(hash);
      if (window.location.hash !== hash)
        window.history[options?.replace ? 'replaceState' : 'pushState'](
          null,
          '',
          `${window.location.pathname}${window.location.search}${hash}`
        );
    },
    [requestedLocation, collectionKey, onHashPublished]
  );
  return (
    <AgentWorkspace
      ports={ports}
      profileLabel={profileLabel}
      {...(extension === undefined ? {} : { extension })}
      {...(requestedLocation === undefined ? {} : { requestedLocation })}
      onLocationChange={selected}
      {...(onRequestCollections === undefined ? {} : { onRequestCollections })}
      {...(onBoundaryStateChange === undefined ? {} : { onBoundaryStateChange })}
    />
  );
}
function safeLocation(collectionKey?: string): WorkspaceLocation {
  try {
    if (collectionKey !== undefined) {
      const location = readCollectionLocation(window.location.hash);
      return location.route === 'workspace' && location.collectionKey === collectionKey
        ? location.workspace
        : {};
    }
    return readWorkspaceLocation(window.location.hash);
  } catch {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return {};
  }
}

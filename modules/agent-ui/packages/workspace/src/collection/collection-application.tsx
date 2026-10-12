import type {
  CollectionAccessPort,
  CollectionChoice,
  CollectionReference,
} from '@ta-agent/ui-contracts';
import {
  Alert,
  CollectionList,
  CollectionSetupForm,
  ConfirmationDialog,
  Panel,
  PanelBody,
  Stack,
  Status,
} from '@ta-agent/ui-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BrowserAgentWorkspace } from '../application/browser-composition.js';
import type { WorkspaceExtension } from '../extensions.js';
import type { WorkspacePorts } from '@ta-agent/ui-contracts';
import { useNavigationGuard } from '../application/use-navigation-guard.js';
import {
  collectionHash,
  readCollectionLocation,
  type CollectionLocation,
} from './collection-location.js';

export interface CollectionConnection {
  readonly ports: WorkspacePorts;
  readonly profileLabel: string;
  readonly extension?: WorkspaceExtension;
}
export interface CollectionBoundaryState {
  readonly dirty: boolean;
  readonly working: boolean;
  /** Opaque draft snapshot identity, including edits made while dirty remains true. */
  readonly editIdentity: object | undefined;
}
interface Binding<Reference extends CollectionReference> {
  readonly collection: CollectionChoice<Reference>;
  readonly connection: CollectionConnection;
}
interface NavigationIntent<Reference extends CollectionReference> {
  readonly controller: AbortController;
  readonly source: Binding<Reference> | undefined;
  authorisedEdits: object | undefined;
}
type NavigationTarget<Reference extends CollectionReference> =
  | Readonly<{ kind: 'open'; reference: Reference; replace?: boolean }>
  | Readonly<{ kind: 'route'; location: CollectionLocation }>;
export interface CollectionApplicationProps<Reference extends CollectionReference> {
  readonly access: CollectionAccessPort<CollectionConnection, Reference>;
  readonly reference: Reference;
  readonly fields: ReactNode;
  readonly choices?: readonly CollectionChoice<Reference>[];
  readonly initialCollection?: CollectionChoice<Reference>;
  /** Application-owned revalidation for a URL's canonical key. Never trust a URL as authority. */
  readonly resolveReference?: (key: string, signal: AbortSignal) => Promise<Reference | undefined>;
  readonly onOpened?: (choice: CollectionChoice<Reference>) => void;
  readonly recentActions?: (choice: CollectionChoice<Reference>) => ReactNode;
  readonly historyActions?: ReactNode;
}

/** Connection, request ownership and component state are bound to one immutable Collection. */
export function CollectionApplication<Reference extends CollectionReference>({
  access,
  reference,
  fields,
  choices = [],
  initialCollection,
  resolveReference,
  onOpened,
  recentActions,
  historyActions,
}: CollectionApplicationProps<Reference>) {
  const [binding, setBinding] = useState<Binding<Reference>>();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [boundary, setBoundary] = useState<CollectionBoundaryState>({
    dirty: false,
    working: false,
    editIdentity: undefined,
  });
  const guard = useNavigationGuard(boundary.dirty);
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const navigation = useRef<NavigationIntent<Reference> | undefined>(undefined);
  const publishedHash = useRef(window.location.hash);
  const knownChoices = useRef(new Map<string, CollectionChoice<Reference>>());
  const callbacks = useRef({ access, resolveReference, onOpened });
  const startupCollection = useRef(initialCollection);
  callbacks.current = { access, resolveReference, onOpened };

  const publish = useCallback((hash: string, replace = false) => {
    publishedHash.current = hash;
    if (window.location.hash !== hash)
      window.history[replace ? 'replaceState' : 'pushState'](
        null,
        '',
        `${window.location.pathname}${window.location.search}${hash}`
      );
  }, []);
  const cancelNavigation = useCallback(() => {
    navigation.current?.controller.abort();
    navigation.current = undefined;
    guard.reset();
    setOpening(false);
  }, [guard.reset]);
  const beginNavigation = useCallback(() => {
    cancelNavigation();
    const intent: NavigationIntent<Reference> = {
      controller: new AbortController(),
      source: bindingRef.current,
      authorisedEdits: undefined,
    };
    navigation.current = intent;
    return intent;
  }, [cancelNavigation]);
  const isCurrent = useCallback(
    (intent: NavigationIntent<Reference>) =>
      navigation.current === intent && !intent.controller.signal.aborted,
    []
  );
  const canLeave = useCallback(
    (intent: NavigationIntent<Reference>) => {
      if (!isCurrent(intent) || bindingRef.current !== intent.source) return false;
      if (
        boundaryRef.current.working ||
        (boundaryRef.current.dirty && boundaryRef.current.editIdentity !== intent.authorisedEdits)
      ) {
        setNotice('Finish active work and resolve unsaved changes before changing Collection.');
        return false;
      }
      return true;
    },
    [isCurrent]
  );
  const navigate = useCallback(
    async (intent: NavigationIntent<Reference>, target: NavigationTarget<Reference>) => {
      setError(undefined);
      setNotice(undefined);
      try {
        if (!canLeave(intent)) return;
        if (target.kind === 'route' && target.location.route === 'collections') {
          setBinding(undefined);
          setBoundary({ dirty: false, working: false, editIdentity: undefined });
          publish('#collections');
          return;
        }
        const location = target.kind === 'route' ? target.location : undefined;
        if (
          location?.route === 'workspace' &&
          intent.source?.collection.key === location.collectionKey
        )
          return;
        setOpening(true);
        let locator: Reference | undefined;
        if (target.kind === 'open') locator = target.reference;
        else if (target.location.route === 'workspace') {
          const known = knownChoices.current.get(target.location.collectionKey);
          locator =
            known === undefined
              ? await callbacks.current.resolveReference?.(
                  target.location.collectionKey,
                  intent.controller.signal
                )
              : known.reference;
        }
        if (!isCurrent(intent)) return;
        if (locator === undefined) {
          // Recovery can unmount a workspace too; it needs the same leave authority as success.
          if (!canLeave(intent)) return;
          setBinding(undefined);
          setBoundary({ dirty: false, working: false, editIdentity: undefined });
          setError('This Collection is not available. Select or open it again.');
          publish('#collections', true);
          return;
        }
        const result = await callbacks.current.access.openCollection({
          reference: locator,
          signal: intent.controller.signal,
        });
        if (!isCurrent(intent)) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        if (location?.route === 'workspace' && location.collectionKey !== result.collection.key) {
          setError('Collection identity changed. Select it again.');
          return;
        }
        if (!canLeave(intent)) return;
        knownChoices.current.set(result.collection.key, result.collection);
        setBoundary({ dirty: false, working: false, editIdentity: undefined });
        setBinding({ collection: result.collection, connection: result.connection });
        publish(
          collectionHash(
            result.collection.key,
            location?.route === 'workspace' ? location.workspace : {}
          ),
          target.kind === 'route' || target.replace === true
        );
        callbacks.current.onOpened?.(result.collection);
      } catch {
        if (isCurrent(intent)) setError('Collection could not be restored. Select it again.');
      } finally {
        if (isCurrent(intent)) {
          navigation.current = undefined;
          setOpening(false);
        }
      }
    },
    [canLeave, isCurrent, publish]
  );
  const open = useCallback(
    (locator: Reference, replace = false) => {
      const intent = beginNavigation();
      intent.authorisedEdits = boundaryRef.current.editIdentity;
      return navigate(intent, { kind: 'open', reference: locator, replace });
    },
    [beginNavigation, navigate]
  );
  const navigateRef = useRef({ beginNavigation, navigate });
  navigateRef.current = { beginNavigation, navigate };
  useEffect(() => {
    let location: CollectionLocation;
    try {
      location = readCollectionLocation(window.location.hash);
    } catch {
      location = { route: 'collections' };
      publish('#collections', true);
    }
    if (location.route === 'workspace') {
      const intent = navigateRef.current.beginNavigation();
      void navigateRef.current.navigate(intent, { kind: 'route', location });
    } else if (startupCollection.current !== undefined && window.location.hash === '')
      void open(startupCollection.current.reference, true);
    else publish('#collections', true);
    return () => {
      navigation.current?.controller.abort();
      navigation.current = undefined;
    };
  }, [open, publish]);

  const changeCollection = useCallback(
    (location: CollectionLocation, rejectedHash: string) => {
      const intent = beginNavigation();
      if (boundaryRef.current.working) {
        cancelNavigation();
        setNotice('Finish or cancel active work before changing Collection.');
        publish(rejectedHash, true);
        return;
      }
      guard.request(
        () => {
          if (!isCurrent(intent)) return;
          if (boundaryRef.current.working) {
            setNotice('Finish or cancel active work before changing Collection.');
            publish(rejectedHash, true);
            cancelNavigation();
            return;
          }
          // Confirmation authorises this snapshot, never future edits to the same dirty workspace.
          intent.authorisedEdits = boundaryRef.current.editIdentity;
          void navigate(intent, { kind: 'route', location });
        },
        () => {
          if (!isCurrent(intent)) return;
          cancelNavigation();
          publish(rejectedHash, true);
        }
      );
    },
    [beginNavigation, cancelNavigation, guard.request, isCurrent, navigate, publish]
  );
  useEffect(() => {
    const readNavigation = (event: Event) => {
      // Ignore queued echoes of a URL already reconciled by replaceState or a later navigation.
      if (
        event instanceof HashChangeEvent &&
        event.newURL !== '' &&
        new URL(event.newURL).hash !== window.location.hash
      )
        return;
      if (
        window.location.hash === publishedHash.current &&
        (navigation.current === undefined ||
          (event instanceof HashChangeEvent && event.newURL !== ''))
      )
        return;
      const previousHash = publishedHash.current;
      // Even a return to the currently bound Collection supersedes an in-flight opening.
      cancelNavigation();
      let location: CollectionLocation;
      try {
        location = readCollectionLocation(window.location.hash);
      } catch {
        publish(previousHash, true);
        return;
      }
      if (
        location.route === 'workspace' &&
        bindingRef.current?.collection.key === location.collectionKey
      )
        return;
      // Do not let a rejected/guarded navigation leave the URL pointing at another scope.
      publish(previousHash, true);
      changeCollection(location, previousHash);
    };
    window.addEventListener('hashchange', readNavigation);
    window.addEventListener('popstate', readNavigation);
    return () => {
      window.removeEventListener('hashchange', readNavigation);
      window.removeEventListener('popstate', readNavigation);
    };
  }, [cancelNavigation, changeCollection, publish]);
  const recordBoundary = useCallback(
    (next: CollectionBoundaryState) =>
      setBoundary((current) =>
        current.dirty === next.dirty &&
        current.working === next.working &&
        current.editIdentity === next.editIdentity
          ? current
          : next
      ),
    []
  );
  const recordHash = useCallback((hash: string) => {
    publishedHash.current = hash;
  }, []);

  return (
    <>
      {notice !== undefined && <Alert tone="caution">{notice}</Alert>}
      {binding !== undefined && error !== undefined && <Alert tone="critical">{error}</Alert>}
      {binding === undefined ? (
        <main className="ta-ui-root ta-ui-workspace-collection-entry">
          <Panel>
            <PanelBody>
              <Stack space="large">
                <h1>Collections</h1>
                <p>Open a Collection to manage its Agents and conversations.</p>
                <CollectionSetupForm
                  title="Open Collection"
                  description="The connection belongs to this application, not to an Agent."
                  submitLabel="Open Collection"
                  pendingLabel="Opening Collection…"
                  pending={opening}
                  onSubmit={() => {
                    void open(reference);
                  }}
                  {...(error === undefined ? {} : { error })}
                >
                  {fields}
                </CollectionSetupForm>
                <CollectionList
                  choices={choices}
                  label="Collections"
                  emptyLabel="No saved Collections"
                  pending={opening}
                  onSelect={(choice) => {
                    void open(choice.reference);
                  }}
                  {...(recentActions === undefined ? {} : { renderActions: recentActions })}
                />
                {historyActions}
              </Stack>
            </PanelBody>
          </Panel>
        </main>
      ) : (
        <BrowserAgentWorkspace
          key={binding.collection.key}
          ports={binding.connection.ports}
          profileLabel={`${binding.collection.label} · ${binding.connection.profileLabel}`}
          collectionKey={binding.collection.key}
          onBoundaryStateChange={recordBoundary}
          onHashPublished={recordHash}
          onRequestCollections={() =>
            changeCollection({ route: 'collections' }, window.location.hash)
          }
          {...(binding.connection.extension === undefined
            ? {}
            : { extension: binding.connection.extension })}
        />
      )}
      {opening && binding !== undefined && <Status>Opening Collection…</Status>}
      <ConfirmationDialog
        open={guard.pending}
        title="Leave this Collection?"
        description="Unsaved changes will be discarded."
        cancelLabel="Keep editing"
        confirmLabel="Discard and leave"
        onConfirm={guard.confirm}
        onOpenChange={(value) => {
          if (!value) guard.cancel();
        }}
      />
    </>
  );
}

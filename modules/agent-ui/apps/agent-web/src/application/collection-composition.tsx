import { Alert, Button, Status, Stack } from '@ta-agent/ui-react';
import type { RecentCollectionsPersistencePort } from '@ta-agent/ui-contracts';
import { useEffect, useState } from 'react';
import { CollectionApplication } from '../collection/collection-application.js';
import { createDirectoryCollectionAccess } from '../adapters/directory-collection-access.js';
import { DirectoryFields } from '../collection/directory-fields.js';
import type {
  DirectoryCollectionChoice,
  DirectoryCollectionReference,
} from '../collection/directory-contracts.js';
import { createBrowserCollectionHistory } from '../adapters/browser-collection-history.js';
import { useRecentCollections } from '../collection/use-recent-collections.js';

export function LocalCollectionApplication({
  access = DEFAULT_ACCESS,
  history = DEFAULT_HISTORY,
}: {
  readonly access?: ReturnType<typeof createDirectoryCollectionAccess>;
  readonly history?: RecentCollectionsPersistencePort<DirectoryCollectionReference>;
}) {
  const recent = useRecentCollections(history);
  const [bootstrap, setBootstrap] = useState<
    | Readonly<{ status: 'loading' }>
    | Readonly<{ status: 'failed' }>
    | Readonly<{ status: 'ready'; initialCollection?: DirectoryCollectionChoice }>
  >({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [path, setPath] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setBootstrap({ status: 'loading' });
    void access.bootstrap(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) {
          setBootstrap({ status: 'ready', ...value });
          setPath(value.initialCollection?.reference.rootDirectory ?? '');
        }
      },
      () => {
        if (!controller.signal.aborted) setBootstrap({ status: 'failed' });
      }
    );
    return () => controller.abort();
  }, [access, attempt]);
  if (bootstrap.status === 'loading') return <Status>Connecting to the Collection host…</Status>;
  if (bootstrap.status === 'failed')
    return (
      <Alert tone="critical">
        The local Collection host is unavailable.
        <Button onClick={() => setAttempt((value) => value + 1)}>Retry connection</Button>
      </Alert>
    );
  return (
    <CollectionApplication
      access={access}
      reference={{ rootDirectory: path }}
      fields={<DirectoryFields path={path} onPathChange={setPath} browse={access.browse} />}
      choices={recent.records.map((record) => record.collection)}
      onOpened={recent.remember}
      recentActions={(choice) => (
        <Button
          appearance="text"
          onClick={() => recent.forget(choice.key)}
          aria-label={`Forget ${choice.label}`}
        >
          Forget
        </Button>
      )}
      historyActions={
        <Stack>
          {recent.warning !== undefined && <Alert tone="caution">{recent.warning}</Alert>}
          {recent.records.length > 0 && (
            <Button appearance="text" onClick={recent.clear}>
              Clear recent Collections
            </Button>
          )}
          <p>
            Recent history stores directory references only. Forgetting a Collection never deletes
            its files.
          </p>
        </Stack>
      }
      {...(bootstrap.initialCollection === undefined
        ? {}
        : { initialCollection: bootstrap.initialCollection })}
      resolveReference={(key, signal) => {
        signal.throwIfAborted();
        return bootstrap.initialCollection?.key === key
          ? Promise.resolve(bootstrap.initialCollection.reference)
          : recent.resolveReference(key, signal);
      }}
    />
  );
}
const DEFAULT_ACCESS = createDirectoryCollectionAccess();
const DEFAULT_HISTORY = createBrowserCollectionHistory();

import { Alert, Button, Cluster, FormField, Stack, TextInput } from '@print-an-agent/ui-react';
import { useEffect, useRef, useState } from 'react';
import type { DirectoryListing } from './directory-contracts.js';

export function DirectoryFields({
  path,
  onPathChange,
  browse,
}: {
  readonly path: string;
  readonly onPathChange: (path: string) => void;
  readonly browse: (path: string, signal: AbortSignal) => Promise<DirectoryListing>;
}) {
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | undefined>(undefined);
  useEffect(
    () => () => {
      controllerRef.current?.abort();
      controllerRef.current = undefined;
    },
    []
  );
  const inspect = async (next: string) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const value = await browse(next, controller.signal);
      if (!controller.signal.aborted) setListing(value);
    } catch {
      if (!controller.signal.aborted)
        setError('Folders could not be listed. Enter a writable absolute path directly.');
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = undefined;
        setPending(false);
      }
    }
  };
  return (
    <Stack>
      <FormField
        label="Collection directory"
        description="An absolute path on the local host. Opening creates a missing directory; Agent model settings stay inside each Agent."
        required
      >
        {(props) => (
          <TextInput
            {...props}
            value={path}
            autoComplete="off"
            onChange={(event) => onPathChange(event.currentTarget.value)}
          />
        )}
      </FormField>
      <Button
        appearance="outline"
        pending={pending}
        onClick={() => {
          void inspect(path);
        }}
      >
        Browse folders
      </Button>
      {error !== undefined && <Alert tone="caution">{error}</Alert>}
      {listing !== undefined && (
        <section aria-label="Host folders">
          <Stack space="small">
            <p>{listing.rootDirectory}</p>
            <Cluster>
              <Button appearance="outline" onClick={() => onPathChange(listing.rootDirectory)}>
                Use this folder
              </Button>
              {listing.parentDirectory !== undefined && (
                <Button
                  appearance="text"
                  onClick={() => {
                    void inspect(listing.parentDirectory ?? '');
                  }}
                >
                  Parent folder
                </Button>
              )}
            </Cluster>
            <ul>
              {listing.directories.map((directory) => (
                <li key={directory.rootDirectory}>
                  <Button
                    appearance="text"
                    onClick={() => {
                      void inspect(directory.rootDirectory);
                    }}
                  >
                    {directory.label}
                  </Button>
                </li>
              ))}
            </ul>
            {listing.directories.length === 200 && (
              <p>Showing the first 200 folders. You can also enter a path directly.</p>
            )}
          </Stack>
        </section>
      )}
    </Stack>
  );
}

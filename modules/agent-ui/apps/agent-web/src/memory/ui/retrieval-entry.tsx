import {
  Alert,
  Button,
  Cluster,
  ConfirmationDialog,
  FormField,
  Stack,
  Textarea,
} from '@print-an-agent/ui-react';
import { useRevisionedEditor } from '@print-an-agent/ui-workspace';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RetrievalMemoryPort } from '../contracts.js';
import type { retrievalReceipt } from '../schemas/retrieval.js';
import { retrievalSource } from '../schemas/retrieval.js';
import { metadata } from '../schemas/common.js';
import {
  JsonField,
  message,
  useMemoryBoundary,
  useMemoryWrite,
  WriteFeedback,
  type BoundaryReporter,
  type MemoryTarget,
} from './support.js';

type Receipt = ReturnType<typeof retrievalReceipt.decode>;
interface EntryDraft {
  readonly content: string;
  readonly metadata: string;
  readonly source: string;
}
export function parseEntry(value: EntryDraft) {
  const parsedMetadata = metadata.decode(JSON.parse(value.metadata));
  const source = retrievalSource.decode(JSON.parse(value.source));
  return { content: value.content, metadata: parsedMetadata, source };
}
export function RetrievalEntryEditor({
  port,
  target,
  entryId,
  indexed,
  report,
  onChanged,
  onRemoved,
}: {
  readonly port: RetrievalMemoryPort;
  readonly target: MemoryTarget;
  readonly entryId: string;
  readonly indexed: boolean;
  readonly report: BoundaryReporter;
  readonly onChanged: () => void;
  readonly onRemoved: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const write = useMemoryWrite<Receipt>(JSON.stringify([target, entryId]), (requestId, signal) =>
    port.getReceipt({ ...target, requestId, signal })
  );
  const callbacks = useRef({ onChanged, onRemoved });
  callbacks.current = { onChanged, onRemoved };
  const result = write.result;
  useEffect(() => {
    if (result?.status === 'committed' && result.value.operation === 'remove') {
      callbacks.current.onChanged();
      callbacks.current.onRemoved();
    }
  }, [result]);
  const editor = useRevisionedEditor<EntryDraft>({
    scope: JSON.stringify([target, entryId]),
    equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    read: async (signal) => {
      const result = await port.get({ ...target, entryId, signal });
      if (result.status !== 'succeeded') throw new Error(message(result));
      return {
        revision: String(result.value.revision),
        value: {
          content: result.value.content,
          metadata: JSON.stringify(result.value.metadata, null, 2),
          source: JSON.stringify(result.value.source, null, 2),
        },
      };
    },
    save: async ({ revision, value }) => {
      let parsed: ReturnType<typeof parseEntry>;
      try {
        parsed = parseEntry(value);
      } catch {
        return {
          status: 'rejected',
          failure: {
            code: 'operation-failed',
            message: 'Invalid metadata or source JSON. No write was sent.',
          },
        };
      }
      const requestId = crypto.randomUUID();
      const result = await write.run({
        requestId,
        execute: (signal) =>
          port.update({
            ...target,
            entryId,
            expectedRevision: Number(revision),
            requestId,
            ...parsed,
            signal,
          }),
      });
      if (result === undefined) throw new Error('Another operation is pending.');
      return result.status === 'committed'
        ? { ...result, value: { revision: String(result.value.entryRevision), value } }
        : result;
    },
    onCommitted: () => {
      onChanged();
      void editor.reload();
    },
  });
  const unknown = write.result?.status === 'indeterminate';
  const reload = useRef(editor.reload);
  reload.current = editor.reload;
  useEffect(() => {
    if (
      write.recoveredResult?.status === 'committed' &&
      write.recoveredResult.value.operation !== 'remove'
    )
      void reload.current();
  }, [write.recoveredResult]);
  const identity = useMemo(
    () => editor.boundary.editIdentity ?? (unknown ? {} : undefined),
    [editor.boundary.editIdentity, unknown]
  );
  useMemoryBoundary(
    {
      ...editor.boundary,
      dirty: editor.dirty || unknown,
      working: editor.pending || write.pending,
      navigationBlocked: editor.pending || write.pending,
      editIdentity: identity,
    },
    report
  );
  const busy = editor.pending || write.pending;
  const blocked = busy || unknown;
  const mutate = async (operation: 'remove' | 'reindex') => {
    if (editor.snapshot === undefined) return;
    const requestId = crypto.randomUUID();
    const input = {
      ...target,
      entryId,
      expectedRevision: Number(editor.snapshot.revision),
      requestId,
    };
    const result = await write.run({
      requestId,
      execute: (signal) => port[operation]({ ...input, signal }),
    });
    setConfirm(false);
    if (result?.status === 'committed') {
      onChanged();
      if (operation === 'reindex') void editor.reload();
    }
  };
  return (
    <Stack>
      <h3>Entry {entryId}</h3>
      <p>Entry revision {editor.snapshot?.revision ?? '…'}</p>
      {editor.error && (
        <Alert tone="critical">{editor.error} Use the list to choose an existing entry.</Alert>
      )}
      {editor.result?.status === 'rejected' && (
        <Alert tone="critical">{editor.result.failure.message}</Alert>
      )}
      {editor.draft && (
        <>
          <FormField label="Entry content" disabled={blocked || !indexed}>
            {(props) => (
              <Textarea
                {...props}
                rows={7}
                value={editor.draft?.content ?? ''}
                onChange={(event) =>
                  editor.draft && editor.setDraft({ ...editor.draft, content: event.target.value })
                }
              />
            )}
          </FormField>
          <JsonField
            label="Entry metadata (JSON)"
            disabled={blocked || !indexed}
            value={editor.draft.metadata}
            onChange={(value) =>
              editor.draft && editor.setDraft({ ...editor.draft, metadata: value })
            }
          />
          <JsonField
            label="Entry source (JSON)"
            disabled={blocked || !indexed}
            value={editor.draft.source}
            onChange={(value) =>
              editor.draft && editor.setDraft({ ...editor.draft, source: value })
            }
          />
        </>
      )}
      <Cluster>
        <Button disabled={blocked || !indexed || !editor.dirty} onClick={() => void editor.save()}>
          Save Entry
        </Button>
        <Button
          disabled={blocked || !indexed || editor.dirty || editor.snapshot === undefined}
          onClick={() => void mutate('reindex')}
        >
          Reindex Entry
        </Button>
        <Button
          tone="critical"
          disabled={blocked || editor.dirty || editor.snapshot === undefined}
          onClick={() => setConfirm(true)}
        >
          Delete Entry…
        </Button>
        <Button
          disabled={busy}
          onClick={() => {
            editor.discard();
            void editor.reload();
          }}
        >
          Discard and reload Entry
        </Button>
      </Cluster>
      <WriteFeedback write={write} />
      <ConfirmationDialog
        open={confirm}
        title="Delete Entry?"
        description="Permanently remove this entry and its indexed representation. This cannot be undone."
        cancelLabel="Keep Entry"
        confirmLabel="Delete Entry"
        tone="critical"
        pending={busy}
        onOpenChange={() => setConfirm(false)}
        onConfirm={() => void mutate('remove')}
      />
    </Stack>
  );
}

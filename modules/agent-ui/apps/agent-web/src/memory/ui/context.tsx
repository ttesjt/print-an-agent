import {
  Alert,
  Button,
  Cluster,
  Disclosure,
  DisclosurePanel,
  DisclosureSummary,
  FormField,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@print-an-agent/ui-react';
import { useRevisionedEditor } from '@print-an-agent/ui-workspace';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContextMemoryPort } from '../contracts.js';
import type { contextReceipt, contextSnapshot } from '../schemas/context.js';
import { contextCodecs } from '../schemas/context.js';
import {
  message,
  useMemoryBoundary,
  useMemoryRead,
  useMemoryWrite,
  WriteFeedback,
  type BoundaryReporter,
  type MemoryTarget,
} from './support.js';

type Snapshot = ReturnType<typeof contextSnapshot.decode>;
type Receipt = ReturnType<typeof contextReceipt.decode>;
type Command = Parameters<ContextMemoryPort['apply']>[0]['commands'][number];
type Draft = Pick<Snapshot, 'items' | 'config'>;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export function ContextMemoryPanel({
  port,
  target,
  report,
}: {
  readonly port: ContextMemoryPort;
  readonly target: MemoryTarget;
  readonly report: BoundaryReporter;
}) {
  const query = useMemoryRead(async (signal) => {
    const result = await port.inspect({ ...target, signal });
    if (result.status === 'failed' && result.failure.domainCode === 'MEMORY_NOT_FOUND') return null;
    if (result.status !== 'succeeded') throw new Error(message(result));
    return result.value;
  }, target);
  if (query.value != null) return <ContextEditor port={port} target={target} report={report} />;
  return <ContextEmpty port={port} target={target} report={report} query={query} />;
}
function ContextEmpty({
  port,
  target,
  report,
  query,
}: {
  readonly port: ContextMemoryPort;
  readonly target: MemoryTarget;
  readonly report: BoundaryReporter;
  readonly query: ReturnType<typeof useMemoryRead<Snapshot | null>>;
}) {
  const write = useMemoryWrite<Receipt>(JSON.stringify(target), (requestId, signal) =>
    port.getReceipt({ ...target, requestId, signal })
  );
  const working = write.pending;
  useMemoryBoundary(
    {
      dirty: write.result?.status === 'indeterminate',
      working,
      editIdentity: write.result,
      discard: () => undefined,
    },
    report
  );
  const create = async () => {
    const requestId = crypto.randomUUID();
    const result = await write.run({
      requestId,
      execute: (signal) => port.create({ ...target, requestId, signal }),
    });
    if (result?.status === 'committed') void query.reload();
  };
  return (
    <Stack>
      {query.error && <Alert tone="critical">{query.error}</Alert>}
      {query.loading ? (
        <p>Reading Memory…</p>
      ) : (
        query.value === null && (
          <>
            <p>
              {write.result?.status === 'committed'
                ? 'Creation confirmed. Read the current document to restore its display.'
                : 'This Memory Document has not been created.'}
            </p>
            <Button
              disabled={
                working ||
                write.result?.status === 'indeterminate' ||
                write.result?.status === 'committed'
              }
              onClick={() => void create()}
            >
              Create Context Memory
            </Button>
          </>
        )
      )}
      <WriteFeedback write={write} />
      <Button disabled={working} onClick={() => void query.reload()}>
        Read current state
      </Button>
    </Stack>
  );
}

function ContextEditor({
  port,
  target,
  report,
}: {
  readonly port: ContextMemoryPort;
  readonly target: MemoryTarget;
  readonly report: BoundaryReporter;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const write = useMemoryWrite<Receipt>(JSON.stringify(target), (requestId, signal) =>
    port.getReceipt({ ...target, requestId, signal })
  );
  const editor = useRevisionedEditor<Draft>({
    scope: JSON.stringify(target),
    equals: same,
    read: async (signal) => {
      const result = await port.inspect({ ...target, signal });
      if (result.status !== 'succeeded') throw new Error(message(result));
      if (result.value === null) throw new Error('Document no longer exists.');
      signal.throwIfAborted();
      setSnapshot(result.value);
      return {
        revision: String(result.value.revision),
        value: { items: result.value.items, config: result.value.config },
      };
    },
    save: async ({ value, revision }, signal) => {
      if (snapshot === undefined) throw new Error('Read current state first.');
      const commands = itemCommands(snapshot.items, value.items);
      if (commands.length !== 0 && !same(snapshot.config, value.config))
        return {
          status: 'rejected',
          failure: {
            code: 'operation-failed',
            message: 'Save items and configuration separately.',
          },
        };
      const requestId = crypto.randomUUID();
      try {
        if (commands.length === 0)
          contextCodecs.configure.input.decode({
            ...target,
            requestId,
            expectedRevision: Number(revision),
            config: value.config,
          });
        else
          contextCodecs.apply.input.decode({
            ...target,
            requestId,
            expectedRevision: Number(revision),
            commands,
          });
      } catch {
        return {
          status: 'rejected',
          failure: {
            code: 'operation-failed',
            message: 'Invalid Memory input. No write was sent.',
          },
        };
      }
      signal.addEventListener('abort', write.cancel, { once: true });
      const result = await write.run({
        requestId,
        execute: (ownSignal) =>
          commands.length === 0
            ? port.configure({
                ...target,
                requestId,
                expectedRevision: Number(revision),
                config: value.config,
                signal: ownSignal,
              })
            : port.apply({
                ...target,
                requestId,
                expectedRevision: Number(revision),
                commands,
                signal: ownSignal,
              }),
      });
      signal.removeEventListener('abort', write.cancel);
      if (result === undefined) throw new Error('Another Memory operation is pending.');
      if (result.status !== 'committed') return result;
      const added = new Map(
        result.value.commandOutcomes.map((outcome) => [outcome.commandIndex, outcome.itemId])
      );
      let nextAdd = 0;
      const newItemIds = commands.flatMap((command, index) =>
        command.op === 'add' ? [added.get(index)] : []
      );
      const items = value.items
        .map((item) => {
          if (snapshot.items.some((old) => old.id === item.id)) return item;
          return { ...item, id: newItemIds[nextAdd++] ?? item.id };
        })
        .filter((item) => item.content.trim() !== '');
      return {
        ...result,
        value: { revision: String(result.value.revision), value: { ...value, items } },
      };
    },
    onCommitted: () => {
      void editor.reload();
    },
  });
  const draft = editor.draft;
  const reload = useRef(editor.reload);
  reload.current = editor.reload;
  useEffect(() => {
    if (write.recoveredResult?.status === 'committed') void reload.current();
  }, [write.recoveredResult]);
  const unknown = write.result?.status === 'indeterminate';
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
  const preview = useMemoryRead(async (signal) => {
    const result = await port.readContext({ ...target, signal });
    if (result.status !== 'succeeded') throw new Error(message(result));
    return result.value;
  }, snapshot?.revision);
  const needsRead =
    write.result?.status === 'committed' &&
    (snapshot === undefined || snapshot.revision < write.result.value.revision);
  const blocked = editor.pending || write.pending || unknown || editor.loading || needsRead;
  const itemsDirty = draft !== undefined && !same(editor.snapshot?.value.items, draft.items);
  const configDirty = draft !== undefined && !same(editor.snapshot?.value.config, draft.config);
  return (
    <Stack>
      {editor.error && <Alert tone="critical">{editor.error}</Alert>}
      {needsRead && !editor.loading && (
        <Alert tone="caution">
          Commit confirmed. Read the current document before editing again; the last displayed
          snapshot is stale.
        </Alert>
      )}
      {editor.result?.status === 'rejected' && (
        <Alert tone="critical">{editor.result.failure.message}</Alert>
      )}
      {snapshot && (
        <p>
          Revision {snapshot.revision} · {snapshot.measurement.tokens} tokens (
          {snapshot.measurement.accuracy}) · budget{' '}
          {snapshot.config.maxContextTokens ?? 'unbounded'} · {snapshot.measurement.measurementRef}
        </p>
      )}
      {draft && (
        <>
          {draft.items.map((item, index) => (
            <Stack key={item.id}>
              <FormField
                label={`Memory item ${index + 1}`}
                description={item.id}
                disabled={blocked || configDirty}
              >
                {(props) => (
                  <Textarea
                    {...props}
                    rows={3}
                    value={item.content}
                    onChange={(event) =>
                      editor.setDraft({
                        ...draft,
                        items: draft.items.map((old, i) =>
                          i === index ? { ...old, content: event.target.value } : old
                        ),
                      })
                    }
                  />
                )}
              </FormField>
              <Button
                disabled={blocked || configDirty}
                onClick={() =>
                  editor.setDraft({
                    ...draft,
                    items: draft.items.filter((old) => old.id !== item.id),
                  })
                }
              >
                Remove item {index + 1}
              </Button>
            </Stack>
          ))}
          <Button
            disabled={blocked || configDirty}
            onClick={() =>
              editor.setDraft({
                ...draft,
                items: [...draft.items, { id: crypto.randomUUID(), content: '' }],
              })
            }
          >
            Add item
          </Button>
          <Disclosure>
            <DisclosureSummary>Document configuration</DisclosureSummary>
            <DisclosurePanel>
              <Stack>
                <FormField
                  label="Token budget (blank = unlimited)"
                  disabled={blocked || itemsDirty}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      type="number"
                      min={1}
                      value={draft.config.maxContextTokens ?? ''}
                      onChange={(event) =>
                        editor.setDraft({
                          ...draft,
                          config: {
                            ...draft.config,
                            maxContextTokens:
                              event.target.value === '' ? null : Number(event.target.value),
                          },
                        })
                      }
                    />
                  )}
                </FormField>
                <FormField label="Context format" disabled={blocked || itemsDirty}>
                  {(props) => (
                    <Select
                      {...props}
                      value={draft.config.render.format}
                      onChange={(event) =>
                        editor.setDraft({
                          ...draft,
                          config: {
                            ...draft.config,
                            render:
                              event.target.value === 'json'
                                ? { format: 'json' }
                                : { format: 'text', separator: '\n\n' },
                          },
                        })
                      }
                    >
                      <option value="text">Text (content only)</option>
                      <option value="json">JSON (IDs and content)</option>
                      {draft.config.render.format === 'custom' && (
                        <option value="custom">Installed custom renderer</option>
                      )}
                    </Select>
                  )}
                </FormField>
                {draft.config.render.format === 'text' && (
                  <FormField label="Item separator" disabled={blocked || itemsDirty}>
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={2}
                        value={
                          draft.config.render.format === 'text' ? draft.config.render.separator : ''
                        }
                        onChange={(event) =>
                          editor.setDraft({
                            ...draft,
                            config: {
                              ...draft.config,
                              render: { format: 'text', separator: event.target.value },
                            },
                          })
                        }
                      />
                    )}
                  </FormField>
                )}
                <p>Configuration is a separate revisioned save. No automatic compaction.</p>
              </Stack>
            </DisclosurePanel>
          </Disclosure>
        </>
      )}
      <Cluster>
        <Button disabled={blocked || !editor.dirty} onClick={() => void editor.save()}>
          Save Memory
        </Button>
        <Button
          disabled={editor.pending || write.pending}
          onClick={() => {
            editor.discard();
            void editor.reload();
          }}
        >
          Discard and reload Memory
        </Button>
      </Cluster>
      <WriteFeedback write={write} />
      <Disclosure>
        <DisclosureSummary>Context preview</DisclosureSummary>
        <DisclosurePanel>
          <Stack>
            {preview.error && (
              <Alert tone="caution">
                Preview unavailable. {preview.error} The stored document remains readable.
              </Alert>
            )}
            <FormField label="Rendered context">
              {(props) => (
                <Textarea {...props} readOnly rows={8} value={preview.value?.text ?? ''} />
              )}
            </FormField>
            <Button onClick={() => void preview.reload()}>Refresh preview</Button>
          </Stack>
        </DisclosurePanel>
      </Disclosure>
    </Stack>
  );
}
function itemCommands(before: Snapshot['items'], after: Snapshot['items']): Command[] {
  const commands: Command[] = before
    .filter((item) => !after.some((next) => next.id === item.id))
    .map((item) => ({ op: 'remove', itemId: item.id }));
  for (const item of after) {
    const previous = before.find((old) => old.id === item.id);
    const { content, metadata } = item;
    const body = { content, ...(metadata === undefined ? {} : { metadata }) };
    if (previous === undefined) commands.push({ op: 'add', ...body });
    else if (!same(previous, item)) commands.push({ op: 'replace', itemId: item.id, ...body });
  }
  return commands;
}

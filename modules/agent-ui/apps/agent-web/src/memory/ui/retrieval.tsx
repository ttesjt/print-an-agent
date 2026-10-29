import {
  Alert,
  Button,
  Cluster,
  DataList,
  DataListItem,
  FormField,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@ta-agent/ui-react';
import { useWorkspaceBoundary, type WorkspaceEditBoundary } from '@ta-agent/ui-workspace';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MemoryCapabilities, RetrievalMemoryPort } from '../contracts.js';
import type { retrievalReceipt } from '../schemas/retrieval.js';
import {
  message,
  useMemoryBoundary,
  useMemoryRead,
  useMemoryWrite,
  WriteFeedback,
  type BoundaryReporter,
  type MemoryTarget,
} from './support.js';
import { RetrievalEntryEditor } from './retrieval-entry.js';

type Receipt = ReturnType<typeof retrievalReceipt.decode>;
type Page = Extract<
  Awaited<ReturnType<RetrievalMemoryPort['list']>>,
  { status: 'succeeded' }
>['value'];
interface Submission {
  readonly operation: 'create' | 'ingest';
  readonly content: string;
  readonly draftGeneration: number;
}
export function RetrievalMemoryPanel({
  port,
  target,
  embeddings,
  report,
}: {
  readonly port: RetrievalMemoryPort;
  readonly target: MemoryTarget;
  readonly embeddings: NonNullable<MemoryCapabilities['retrieval']>['embeddings'];
  readonly report: BoundaryReporter;
}) {
  const space = useMemoryRead(async (signal) => {
    const result = await port.inspect({ ...target, signal });
    if (result.status === 'failed' && result.failure.domainCode === 'MEMORY_NOT_FOUND') return null;
    if (result.status !== 'succeeded') throw new Error(message(result));
    return result.value;
  }, target);
  const [profile, setProfile] = useState('0');
  const [content, setContent] = useState('');
  const draftGeneration = useRef(0);
  const submissions = useRef(new Map<string, Submission>());
  const editContent = (value: string) => {
    draftGeneration.current++;
    setContent(value);
  };
  const [entryId, setEntryId] = useState<string>();
  const [entryBoundary, setEntryBoundary] = useState<WorkspaceEditBoundary>();
  const [page, setPage] = useState<Page>();
  const [listError, setListError] = useState<string>();
  const [listing, setListing] = useState(false);
  const listingRequest = useRef<AbortController | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [searchQuery, setSearchQuery] = useState<string>();
  const search = useMemoryRead(async (signal) => {
    if (searchQuery === undefined) return null;
    const result = await port.search({ ...target, query: searchQuery, signal });
    if (result.status !== 'succeeded') throw new Error(message(result));
    return result.value;
  }, searchQuery);
  const write = useMemoryWrite<Receipt>(JSON.stringify(target), (requestId, signal) =>
    port.getReceipt({ ...target, requestId, signal })
  );
  const unknown = write.result?.status === 'indeterminate';
  const receipt = write.result?.status === 'committed' ? write.result.value : undefined;
  const finalizing = receipt !== undefined && submissions.current.has(receipt.requestId);
  const editIdentity = useMemo(
    () => (content !== '' || unknown ? {} : undefined),
    [content, unknown]
  );
  const boundary = useWorkspaceBoundary([
    {
      dirty: content !== '' || unknown,
      working: write.pending || finalizing,
      navigationBlocked: write.pending || finalizing,
      editIdentity,
      discard: () => editContent(''),
    },
    entryBoundary,
  ]);
  useMemoryBoundary(boundary, report);
  const indexed =
    space.value != null &&
    embeddings.some(
      (embedding) =>
        embedding.embeddingRef === space.value?.index.embeddingRef &&
        embedding.chunkerRef === space.value.index.chunkerRef &&
        embedding.metricRef === space.value.index.metricRef
    );
  const blocked = boundary.working || unknown;
  const readPage = async (more = false) => {
    if (listingRequest.current !== undefined) return;
    const controller = new AbortController();
    listingRequest.current = controller;
    setListing(true);
    setListError(undefined);
    try {
      const result = await port.list({
        ...target,
        limit: 20,
        ...(more && page?.nextCursor ? { cursor: page.nextCursor } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (result.status !== 'succeeded') throw new Error(message(result));
      setPage((previous) => ({
        ...result.value,
        entries: more
          ? [...(previous?.entries ?? []), ...result.value.entries]
          : result.value.entries,
      }));
    } catch (cause) {
      if (!controller.signal.aborted)
        setListError(cause instanceof Error ? cause.message : 'Entries could not be read.');
    } finally {
      if (listingRequest.current === controller) {
        listingRequest.current = undefined;
        setListing(false);
      }
    }
  };
  useEffect(() => {
    if (space.value != null) void readPage();
    return () => listingRequest.current?.abort();
  }, [space.value?.revision]);
  const changed = () => {
    listingRequest.current?.abort();
    listingRequest.current = undefined;
    void readPage();
    setSearchQuery(undefined);
  };
  // The receipt is the common completion fact for initial delivery, recovery and exact replay.
  // Consume it before re-enabling submission, independently of fallible display reads.
  useLayoutEffect(() => {
    if (receipt === undefined) return;
    const submitted = submissions.current.get(receipt.requestId);
    if (submitted === undefined) return;
    submissions.current.delete(receipt.requestId);
    if (submitted.operation === 'ingest') {
      if (draftGeneration.current === submitted.draftGeneration) {
        draftGeneration.current++;
        setContent((current) => (current === submitted.content ? '' : current));
      }
      changed();
    } else {
      // The first successful Space read starts its initial list query.
      setSearchQuery(undefined);
    }
    void space.reload();
  }, [receipt]);
  const mutate = async (operation: 'create' | 'ingest') => {
    const requestId = crypto.randomUUID();
    const selected = embeddings[Number(profile)];
    if (operation === 'create' && selected === undefined) return;
    submissions.current.set(requestId, {
      operation,
      content,
      draftGeneration: draftGeneration.current,
    });
    const result = await write.run({
      requestId,
      execute: (signal) =>
        operation === 'create' && selected !== undefined
          ? port.create({
              ...target,
              requestId,
              index: {
                embeddingRef: selected.embeddingRef,
                chunkerRef: selected.chunkerRef,
                metricRef: selected.metricRef,
              },
              signal,
            })
          : port.ingest({ ...target, requestId, content, signal }),
    });
    if (result === undefined || result.status === 'rejected') submissions.current.delete(requestId);
  };
  return (
    <Stack>
      {space.error && <Alert tone="critical">{space.error}</Alert>}
      {space.value === null && (
        <>
          <p>
            {write.result?.status === 'committed'
              ? 'Creation confirmed. Read the current space to restore its display.'
              : 'This Memory Space has not been created.'}
          </p>
          <FormField label="Embedding profile" disabled={blocked || embeddings.length === 0}>
            {(props) => (
              <Select
                {...props}
                value={profile}
                onChange={(event) => setProfile(event.target.value)}
              >
                {embeddings.map((embedding, i) => (
                  <option key={embedding.embeddingRef} value={i}>
                    {embedding.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <Button
            disabled={blocked || embeddings.length === 0 || write.result?.status === 'committed'}
            onClick={() => void mutate('create')}
          >
            Create Retrieval Memory
          </Button>
        </>
      )}
      {space.value != null && (
        <>
          <p>
            Space revision {space.value.revision} · sequence{' '}
            {page?.space.sequence ?? space.value.sequence} · {space.value.index.dimensions}{' '}
            dimensions
          </p>
          {!indexed && (
            <Alert tone="caution">
              Embedding profile is not installed. Browsing and deletion remain available; indexed
              writes, search and reindex require the original profile.
            </Alert>
          )}
          <FormField label="New Entry" disabled={blocked || !indexed || !!entryBoundary?.dirty}>
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                value={content}
                onChange={(event) => editContent(event.target.value)}
              />
            )}
          </FormField>
          <Button
            disabled={blocked || !indexed || content.trim() === '' || !!entryBoundary?.dirty}
            onClick={() => void mutate('ingest')}
          >
            Add Entry
          </Button>
          <Cluster>
            <FormField label="Search Memory" disabled={!indexed}>
              {(props) => (
                <TextInput
                  {...props}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              )}
            </FormField>
            <Button
              disabled={!indexed || query.trim() === '' || search.loading}
              onClick={() => {
                if (searchQuery === query) void search.reload();
                else setSearchQuery(query);
              }}
            >
              Search
            </Button>
          </Cluster>
          {search.error && <Alert tone="critical">{search.error}</Alert>}
          {search.value && (
            <section aria-label="Memory search results">
              <h3>Search results</h3>
              <DataList>
                {search.value.hits.map((hit) => (
                  <DataListItem
                    key={hit.chunkId}
                    label={
                      <Button
                        disabled={blocked || boundary.dirty}
                        onClick={() => setEntryId(hit.entryId)}
                      >
                        Open result {hit.ordinal + 1}
                      </Button>
                    }
                    value={
                      <>
                        <p>{hit.text}</p>
                        <p>
                          Distance {hit.ranking.value} ·{' '}
                          {hit.source?.label ?? hit.source?.ref ?? hit.entryId}
                        </p>
                      </>
                    }
                  />
                ))}
              </DataList>
              {search.value.hits.length === 0 && <p>No matching entries.</p>}
            </section>
          )}
          <section aria-label="Memory entries">
            <h3>Entries</h3>
            {listError && <Alert tone="critical">{listError}</Alert>}
            <DataList>
              {page?.entries.map((entry) => (
                <DataListItem
                  key={entry.entryId}
                  label={
                    <Button
                      disabled={blocked || boundary.dirty}
                      onClick={() => setEntryId(entry.entryId)}
                    >
                      {entry.entryId}
                    </Button>
                  }
                  value={
                    <>
                      <span>Revision {entry.revision}</span>
                      <p>{entry.source?.label ?? entry.source?.ref ?? 'No source'}</p>
                      <p>{JSON.stringify(entry.metadata)}</p>
                    </>
                  }
                />
              ))}
            </DataList>
            {page?.entries.length === 0 && <p>No entries yet.</p>}
            <Cluster>
              <Button disabled={listing} onClick={() => void readPage()}>
                Refresh entries
              </Button>
              {page?.nextCursor && (
                <Button disabled={listing} onClick={() => void readPage(true)}>
                  Load more entries
                </Button>
              )}
            </Cluster>
          </section>
          {entryId && (
            <RetrievalEntryEditor
              key={entryId}
              port={port}
              target={target}
              entryId={entryId}
              indexed={indexed}
              report={setEntryBoundary}
              onChanged={changed}
              onRemoved={() => setEntryId(undefined)}
            />
          )}
        </>
      )}
      {embeddings.length === 0 && (
        <Alert tone="caution">No embedding profiles advertised by this Host.</Alert>
      )}
      <WriteFeedback write={write} />
      <Button
        disabled={blocked}
        onClick={() => {
          void space.reload();
          changed();
        }}
      >
        Read current state
      </Button>
    </Stack>
  );
}

import { Alert, Button, Cluster, FormField, Textarea } from '@ta-agent/ui-react';
import { useWorkspaceMutation, type WorkspaceEditBoundary } from '@ta-agent/ui-workspace';
import type { MutationOutcome, MutationNotice } from '@ta-agent/ui-contracts';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MemoryMutationOutcome } from '../schemas/common.js';

export interface MemoryTarget {
  readonly agentId: string;
  readonly memoryId: string;
}
export type BoundaryReporter = (boundary: WorkspaceEditBoundary | undefined) => void;
export function useMemoryBoundary(boundary: WorkspaceEditBoundary, report: BoundaryReporter) {
  const latest = useRef(boundary);
  latest.current = boundary;
  useLayoutEffect(() => {
    report({ ...latest.current, discard: () => latest.current.discard() });
  }, [report, boundary.dirty, boundary.working, boundary.navigationBlocked, boundary.editIdentity]);
  useLayoutEffect(() => () => report(undefined), [report]);
}
export function message(
  result:
    | { status: 'failed'; failure: { code: string; message: string; domainCode?: string } }
    | { status: 'skipped'; reason: string }
) {
  return result.status === 'failed'
    ? `${result.failure.code}${result.failure.domainCode ? ` (${result.failure.domainCode})` : ''}: ${result.failure.message}`
    : `Skipped: ${result.reason}`;
}
export function useMemoryRead<Value>(
  read: (signal: AbortSignal) => Promise<Value>,
  identity: unknown
) {
  const callback = useRef(read);
  callback.current = read;
  const [state, setState] = useState<{
    value?: Value;
    error?: string | undefined;
    loading: boolean;
  }>({ loading: true });
  const active = useRef<AbortController | undefined>(undefined);
  const reload = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setState((previous) => ({ ...previous, loading: true, error: undefined }));
    try {
      const value = await callback.current(controller.signal);
      if (!controller.signal.aborted) setState({ value, loading: false });
    } catch (cause) {
      if (!controller.signal.aborted)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: cause instanceof Error ? cause.message : 'Memory could not be read.',
        }));
    }
  };
  useEffect(() => {
    void reload();
    return () => active.current?.abort();
  }, [identity]); // caller supplies immutable read identity
  return { ...state, reload };
}

interface ReceiptQuery<R> {
  readonly status: 'succeeded';
  readonly value: R | null;
  readonly notices?: readonly MutationNotice[];
}
type Query<R> =
  | ReceiptQuery<R>
  | {
      readonly status: 'failed';
      readonly failure: { readonly code: string; readonly message: string };
    }
  | { readonly status: 'skipped'; readonly reason: string };
interface Write<R> {
  readonly requestId: string;
  readonly execute: (signal: AbortSignal) => Promise<MemoryMutationOutcome<R>>;
}
/** Keeps the original immutable request through delivery loss. Recovery never invents a new write. */
export function useMemoryWrite<R>(
  scope: string,
  getReceipt: (requestId: string, signal: AbortSignal) => Promise<Query<R>>
) {
  const last = useRef<Write<R> | undefined>(undefined);
  const [recovery, setRecovery] = useState<{
    result?: MutationOutcome<R>;
    missing?: boolean;
    error?: string;
    pending: boolean;
  }>({ pending: false });
  const recoveryRequest = useRef<AbortController | undefined>(undefined);
  const mutation = useWorkspaceMutation<Write<R>, R>({
    scope,
    execute: async (input, signal) => {
      const result = await input.execute(signal);
      if (result.status === 'committed') return { ...result, value: result.value.receipt };
      if (result.status === 'skipped')
        return { status: 'rejected', failure: { code: 'unavailable', message: result.reason } };
      if (result.status === 'rejected')
        return {
          status: 'rejected',
          failure: {
            code: 'operation-failed',
            message: `${result.failure.domainCode ?? result.failure.code}: ${result.failure.message}`,
          },
        };
      return result;
    },
  });
  useEffect(() => () => recoveryRequest.current?.abort(), [scope]);
  const run = async (input: Write<R>) => {
    if (
      mutation.isPending() ||
      recoveryRequest.current !== undefined ||
      mutation.result?.status === 'indeterminate'
    )
      return;
    last.current = input;
    setRecovery({ pending: false });
    return mutation.run(input);
  };
  const recover = async () => {
    if (last.current === undefined || recoveryRequest.current !== undefined) return;
    const controller = new AbortController();
    recoveryRequest.current = controller;
    setRecovery({ pending: true });
    try {
      const result = await getReceipt(last.current.requestId, controller.signal);
      if (controller.signal.aborted && !(result.status === 'succeeded' && result.value !== null))
        return;
      if (result.status !== 'succeeded') setRecovery({ pending: false, error: message(result) });
      else if (result.value === null) setRecovery({ pending: false, missing: true });
      else {
        mutation.reconciled();
        setRecovery({
          pending: false,
          result: {
            status: 'committed',
            value: result.value,
            notices: [
              ...(result.notices ?? []),
              {
                code: 'receipt-recovered',
                message: 'Commit confirmed. Read current state; do not resubmit.',
              },
            ],
          },
        });
      }
    } catch {
      if (!controller.signal.aborted)
        setRecovery({
          pending: false,
          error: 'Receipt could not be read. The outcome remains unconfirmed.',
        });
    } finally {
      if (recoveryRequest.current === controller) {
        recoveryRequest.current = undefined;
        setRecovery((previous) => ({ ...previous, pending: false }));
      }
    }
  };
  const replay = async () => {
    if (!recovery.missing || last.current === undefined) return;
    mutation.reconciled();
    setRecovery({ pending: false });
    const result = await mutation.run(last.current);
    if (result?.status === 'committed') setRecovery({ pending: false, result });
    return result;
  };
  return {
    run,
    recover,
    replay,
    result: recovery.result ?? mutation.result,
    recoveredResult: recovery.result,
    pending: mutation.pending || recovery.pending,
    missing: recovery.missing,
    recoveryError: recovery.error,
    cancel: () => {
      mutation.cancel();
      recoveryRequest.current?.abort();
    },
  };
}
export function WriteFeedback<R>({
  write,
}: {
  readonly write: ReturnType<typeof useMemoryWrite<R>>;
}) {
  const result = write.result;
  return (
    <>
      {result?.status === 'rejected' && <Alert tone="critical">{result.failure.message}</Alert>}
      {result?.status === 'committed' && (
        <Alert tone="positive">Committed. {result.notices.map((n) => n.message).join(' ')}</Alert>
      )}
      {result?.status === 'indeterminate' && (
        <Alert tone="caution">
          {result.notice.message}
          <Cluster>
            <Button disabled={write.pending} onClick={() => void write.recover()}>
              Read receipt
            </Button>
            {write.missing && (
              <Button disabled={write.pending} onClick={() => void write.replay()}>
                Retry original request
              </Button>
            )}
          </Cluster>
          {write.missing && (
            <p>
              No receipt found yet. This does not prove rejection. Retry uses the identical request
              ID and input.
            </p>
          )}
        </Alert>
      )}
      {write.recoveryError && <Alert tone="critical">{write.recoveryError}</Alert>}
      {write.pending && <Button onClick={write.cancel}>Cancel Memory operation</Button>}
    </>
  );
}
export function JsonField({
  label,
  value,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
}) {
  return (
    <FormField label={label} disabled={disabled ?? false}>
      {(props) => (
        <Textarea
          {...props}
          rows={4}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

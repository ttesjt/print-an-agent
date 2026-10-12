import type { MutationOutcome, RevisionedValue } from '@ta-agent/ui-contracts';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceEditBoundary } from './extensions.js';
import { useWorkspaceMutation } from './use-workspace-mutation.js';

export interface RevisionedEditorOptions<Value> {
  /** Include Collection/Agent/section identity; revisions are deliberately not scope identity. */
  readonly scope: string;
  readonly read: (signal: AbortSignal) => Promise<RevisionedValue<Value>>;
  readonly save: (
    input: RevisionedValue<Value>,
    signal: AbortSignal
  ) => Promise<MutationOutcome<RevisionedValue<Value>>>;
  readonly equals: (left: Value, right: Value) => boolean;
  readonly onCommitted?: (value: RevisionedValue<Value>) => void;
}

/** Independent editor state for one authority; composing two editors never merges their revisions. */
export function useRevisionedEditor<Value>(options: RevisionedEditorOptions<Value>) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const [state, setState] = useState<{
    scope: string;
    snapshot: RevisionedValue<Value> | undefined;
    draft: Value | undefined;
    loading: boolean;
    error: string | undefined;
  }>({
    scope: options.scope,
    snapshot: undefined,
    draft: undefined,
    loading: true,
    error: undefined,
  });
  const reads = useRef<AbortController | undefined>(undefined);
  const editGeneration = useRef(0);
  const mutation = useWorkspaceMutation<RevisionedValue<Value>, RevisionedValue<Value>>({
    scope: options.scope,
    execute: (input, signal) => callbacks.current.save(input, signal),
  });
  const current = state.scope === options.scope ? state : undefined;
  const read = useCallback(async () => {
    reads.current?.abort();
    const controller = new AbortController();
    reads.current = controller;
    const scope = callbacks.current.scope;
    const generation = editGeneration.current;
    setState((previous) => ({ ...previous, scope, loading: true, error: undefined }));
    try {
      const snapshot = await callbacks.current.read(controller.signal);
      if (controller.signal.aborted || callbacks.current.scope !== scope) return false;
      setState((previous) => ({
        scope,
        snapshot,
        draft: generation === editGeneration.current ? snapshot.value : previous.draft,
        loading: false,
        error: undefined,
      }));
      return true;
    } catch {
      if (!controller.signal.aborted && callbacks.current.scope === scope)
        setState((previous) => ({
          ...previous,
          loading: false,
          error: 'Settings could not be loaded.',
        }));
      return false;
    } finally {
      if (reads.current === controller) reads.current = undefined;
    }
  }, []);
  useEffect(() => {
    setState({
      scope: options.scope,
      snapshot: undefined,
      draft: undefined,
      loading: true,
      error: undefined,
    });
    void read();
    return () => reads.current?.abort();
  }, [options.scope, read]);
  const dirty =
    current?.snapshot !== undefined &&
    current.draft !== undefined &&
    !options.equals(current.snapshot.value, current.draft);
  const editIdentity = useMemo(
    () => (dirty ? {} : undefined),
    [dirty, options.scope, current?.draft]
  );
  const save = async () => {
    if (
      current?.snapshot === undefined ||
      current.draft === undefined ||
      !dirty ||
      current.loading ||
      reads.current !== undefined
    )
      return;
    const submitted = current.draft;
    const scope = options.scope;
    const result = await mutation.run({ revision: current.snapshot.revision, value: submitted });
    if (callbacks.current.scope !== scope || result?.status !== 'committed') return;
    setState((previous) =>
      previous.scope !== scope
        ? previous
        : {
            ...previous,
            snapshot: result.value,
            draft:
              previous.draft !== undefined && callbacks.current.equals(previous.draft, submitted)
                ? result.value.value
                : previous.draft,
          }
    );
    callbacks.current.onCommitted?.(result.value);
  };
  const discard = () => {
    editGeneration.current++;
    setState((previous) => ({ ...previous, draft: previous.snapshot?.value, error: undefined }));
  };
  const boundary: WorkspaceEditBoundary = {
    dirty,
    working: mutation.pending || !!current?.loading,
    editIdentity,
    discard,
  };
  return {
    snapshot: current?.snapshot,
    draft: current?.draft,
    loading: current?.loading ?? true,
    error: current?.error,
    dirty,
    pending: mutation.pending,
    result: mutation.result,
    boundary,
    save,
    cancel: mutation.cancel,
    discard,
    setDraft: (draft: Value) => {
      editGeneration.current++;
      setState((previous) => ({ ...previous, draft }));
    },
    reload: async () => {
      if (mutation.isPending()) return;
      if (await read()) mutation.reconciled();
    },
  };
}

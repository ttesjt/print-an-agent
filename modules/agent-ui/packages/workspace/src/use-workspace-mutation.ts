import type { MutationOutcome } from '@ta-agent/ui-contracts';
import { useEffect, useRef, useState } from 'react';

/** A scoped single-flight operation. Cancellation requests cooperation; it never declares rollback. */
export function useWorkspaceMutation<Input, Value>(options: {
  readonly scope: string;
  readonly execute: (input: Input, signal: AbortSignal) => Promise<MutationOutcome<Value>>;
  readonly onCommitted?: (value: Value) => void;
}) {
  const callbacks = useRef(options);
  callbacks.current = options;
  const operation = useRef<AbortController | undefined>(undefined);
  const requiresReconciliation = useRef(false);
  const [state, setState] = useState<{
    scope: string;
    pending: boolean;
    result: MutationOutcome<Value> | undefined;
  }>({ scope: options.scope, pending: false, result: undefined });
  useEffect(() => {
    operation.current?.abort();
    operation.current = undefined;
    requiresReconciliation.current = false;
    setState({ scope: options.scope, pending: false, result: undefined });
    return () => {
      operation.current?.abort();
      operation.current = undefined;
    };
  }, [options.scope]);
  const current = state.scope === options.scope ? state : undefined;
  const run = async (input: Input) => {
    if (operation.current !== undefined || requiresReconciliation.current) return;
    const scope = options.scope;
    const controller = new AbortController();
    operation.current = controller;
    setState({ scope, pending: true, result: undefined });
    let result: MutationOutcome<Value>;
    try {
      result = await callbacks.current.execute(input, controller.signal);
    } catch {
      result = {
        status: 'indeterminate',
        notice: {
          code: 'outcome-unconfirmed',
          message:
            'The operation result is unconfirmed. Reload authoritative state before retrying.',
        },
      };
    }
    if (operation.current !== controller || callbacks.current.scope !== scope) return;
    operation.current = undefined;
    requiresReconciliation.current = result.status === 'indeterminate';
    // A confirmed commit is preserved even when cancellation raced with the response.
    setState({ scope, pending: false, result });
    if (result.status === 'committed') callbacks.current.onCommitted?.(result.value);
    return result;
  };
  return {
    pending: current?.pending ?? false,
    /** Synchronous ownership check for composing coordinators before React renders. */
    isPending: () => operation.current !== undefined,
    result: current?.result,
    run,
    cancel: () => operation.current?.abort(),
    /** Call only after an authoritative read/reconciliation, never as an automatic retry. */
    reconciled: () => {
      if (operation.current === undefined) {
        requiresReconciliation.current = false;
        setState({ scope: options.scope, pending: false, result: undefined });
      }
    },
  };
}

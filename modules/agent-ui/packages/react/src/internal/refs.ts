import type { Ref } from 'react';

export function assignRef<Value>(ref: Ref<Value> | undefined, value: Value | null): void {
  if (typeof ref === 'function') ref(value);
  else if (ref !== null && ref !== undefined) ref.current = value;
}

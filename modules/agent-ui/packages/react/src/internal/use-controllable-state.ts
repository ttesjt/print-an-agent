import { useCallback, useState } from 'react';

interface ControllableStateOptions<Value> {
  readonly defaultValue: Value;
  readonly onValueChange: ((value: Value) => void) | undefined;
  readonly value: Value | undefined;
}

export function useControllableState<Value>({
  defaultValue,
  onValueChange,
  value,
}: ControllableStateOptions<Value>): readonly [Value, (nextValue: Value) => void] {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = value !== undefined;
  const currentValue = isControlled ? value : uncontrolledValue;

  const setValue = useCallback(
    (nextValue: Value) => {
      if (Object.is(currentValue, nextValue)) return;
      if (!isControlled) setUncontrolledValue(nextValue);
      onValueChange?.(nextValue);
    },
    [currentValue, isControlled, onValueChange]
  );

  return [currentValue, setValue] as const;
}

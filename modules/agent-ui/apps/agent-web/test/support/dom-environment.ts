interface DomDriver {
  readonly setURL: (url: string) => void;
  readonly waitUntilComplete: () => Promise<void>;
  readonly setWindowSize: (options: { width: number; height: number }) => void;
}
function driver(value: unknown): value is DomDriver {
  return (
    typeof value === 'object' &&
    value !== null &&
    'setURL' in value &&
    typeof value.setURL === 'function' &&
    'waitUntilComplete' in value &&
    typeof value.waitUntilComplete === 'function' &&
    'setWindowSize' in value &&
    typeof value.setWindowSize === 'function'
  );
}
export function domEnvironment(): DomDriver {
  if (!('happyDOM' in window) || !driver(window.happyDOM))
    throw new Error('DOM environment required');
  return window.happyDOM;
}

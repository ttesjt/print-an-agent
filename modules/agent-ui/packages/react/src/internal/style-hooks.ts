export function joinStyleHooks(
  required: string,
  ...extensions: readonly (string | undefined)[]
): string {
  const normalizedExtensions = extensions
    .map((extension) => extension?.trim())
    .filter((extension): extension is string => extension !== undefined && extension.length > 0);
  return [required, ...normalizedExtensions].join(' ');
}

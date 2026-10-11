import { resolve } from 'node:path';

/** --root is a directory shortcut, never JSON or a provider configuration. */
export function parseHostArguments(
  args: readonly string[]
): Readonly<{ port: number; initialRoot?: string }> {
  const fields = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (
      name === undefined ||
      !['--port', '--root'].includes(name) ||
      value === undefined ||
      value.trim() === '' ||
      fields.has(name)
    )
      throw new Error('Invalid host arguments.');
    fields.set(name, value);
  }
  const port = Number(fields.get('--port') ?? '4174');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port.');
  const root = fields.get('--root');
  return { port, ...(root === undefined ? {} : { initialRoot: resolve(root) }) };
}

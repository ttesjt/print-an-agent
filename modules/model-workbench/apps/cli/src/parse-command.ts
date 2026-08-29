import { ModelWorkbenchCliError } from './errors.js';

export const ModelWorkbenchCliCommandKind = {
  Help: 'help',
  InitializationStart: 'initialization-start',
  TrainingStart: 'training-start',
  ExportStart: 'export-start',
  OutputInvoke: 'output-invoke',
  RunGet: 'run-get',
  RunList: 'run-list',
  RunRefresh: 'run-refresh',
  RunWait: 'run-wait',
  RunCancel: 'run-cancel',
  BaseGet: 'base-get',
  BaseList: 'base-list',
  ModificationGet: 'modification-get',
  ModificationList: 'modification-list',
  OutputGet: 'output-get',
  OutputList: 'output-list',
  ModelCompose: 'model-compose',
} as const;

export type ModelWorkbenchCliCommandKind =
  (typeof ModelWorkbenchCliCommandKind)[keyof typeof ModelWorkbenchCliCommandKind];

export type ModelWorkbenchCliCommand =
  | Readonly<{ kind: typeof ModelWorkbenchCliCommandKind.Help }>
  | Readonly<{
      kind: Exclude<ModelWorkbenchCliCommandKind, typeof ModelWorkbenchCliCommandKind.Help>;
      applicationPath: string;
      requestPath: string;
    }>;

const COMMANDS = new Map<string, Exclude<ModelWorkbenchCliCommandKind, 'help'>>([
  ['initialization start', ModelWorkbenchCliCommandKind.InitializationStart],
  ['training start', ModelWorkbenchCliCommandKind.TrainingStart],
  ['export start', ModelWorkbenchCliCommandKind.ExportStart],
  ['output invoke', ModelWorkbenchCliCommandKind.OutputInvoke],
  ['run get', ModelWorkbenchCliCommandKind.RunGet],
  ['run list', ModelWorkbenchCliCommandKind.RunList],
  ['run refresh', ModelWorkbenchCliCommandKind.RunRefresh],
  ['run wait', ModelWorkbenchCliCommandKind.RunWait],
  ['run cancel', ModelWorkbenchCliCommandKind.RunCancel],
  ['base get', ModelWorkbenchCliCommandKind.BaseGet],
  ['base list', ModelWorkbenchCliCommandKind.BaseList],
  ['modification get', ModelWorkbenchCliCommandKind.ModificationGet],
  ['modification list', ModelWorkbenchCliCommandKind.ModificationList],
  ['output get', ModelWorkbenchCliCommandKind.OutputGet],
  ['output list', ModelWorkbenchCliCommandKind.OutputList],
  ['model compose', ModelWorkbenchCliCommandKind.ModelCompose],
]);

export function parseModelWorkbenchCliCommand(argv: readonly string[]): ModelWorkbenchCliCommand {
  if (argv.length === 0 || (argv.length === 1 && argv[0] === '--help')) {
    return Object.freeze({ kind: ModelWorkbenchCliCommandKind.Help });
  }
  const kind = COMMANDS.get(`${String(argv[0])} ${String(argv[1])}`);
  if (kind === undefined) usageError('Unknown command.');
  const options = parseOptions(argv.slice(2));
  assertOnly(options, ['application', 'request']);
  return Object.freeze({
    kind,
    applicationPath: requireOption(options, 'application'),
    requestPath: requireOption(options, 'request'),
  });
}

function parseOptions(tokens: readonly string[]): ReadonlyMap<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < tokens.length; index += 2) {
    const token = tokens[index];
    const value = tokens[index + 1];
    if (token === undefined || !token.startsWith('--') || token.length === 2) {
      usageError('Options must use --name value syntax.');
    }
    const name = token.slice(2);
    if (value === undefined || value.startsWith('--'))
      usageError(`Option --${name} needs a value.`);
    if (options.has(name)) usageError(`Option --${name} cannot be repeated.`);
    options.set(name, value);
  }
  return options;
}

function requireOption(options: ReadonlyMap<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value.length === 0) usageError(`Option --${name} is required.`);
  return value;
}

function assertOnly(options: ReadonlyMap<string, string>, allowed: readonly string[]): void {
  const unexpected = [...options.keys()].find((name) => !allowed.includes(name));
  if (unexpected !== undefined) usageError(`Option --${unexpected} is not supported.`);
}

function usageError(message: string): never {
  throw new ModelWorkbenchCliError('CLI_USAGE_INVALID', message);
}

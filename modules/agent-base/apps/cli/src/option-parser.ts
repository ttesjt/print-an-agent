import { AgentBaseCliError } from './errors.js';

export type CliOptionValues = ReadonlyMap<string, string | true>;

export function parseCliOptions(
  tokens: readonly string[],
  booleanOptions: ReadonlySet<string> = new Set()
): CliOptionValues {
  const values = new Map<string, string | true>();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || !token.startsWith('--') || token.length === 2) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', 'Command options must use --name syntax.');
    }
    const name = token.slice(2);
    if (values.has(name)) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} cannot be repeated.`);
    }
    if (booleanOptions.has(name)) {
      values.set(name, true);
      continue;
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} requires a value.`);
    }
    values.set(name, value);
    index += 1;
  }
  return values;
}

export function assertAllowedCliOptions(
  options: CliOptionValues,
  allowed: readonly string[]
): void {
  const unexpected = [...options.keys()].find((name) => !allowed.includes(name));
  if (unexpected !== undefined) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${unexpected} is not supported.`);
  }
}

export function requireCliOption(options: CliOptionValues, name: string): string {
  const value = options.get(name);
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} is required.`);
  }
  return value;
}

export function optionalCliOption(options: CliOptionValues, name: string): string | undefined {
  const value = options.get(name);
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} requires a value.`);
  }
  return value;
}

export function requireBooleanCliOption(options: CliOptionValues, name: string): void {
  if (options.get(name) !== true) {
    throw new AgentBaseCliError('CLI_USAGE_INVALID', `Option --${name} is required.`);
  }
}

function parseSafeInteger(raw: string, name: string, minimum: number, maximum: number): number {
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum || String(value) !== raw) {
    throw new AgentBaseCliError(
      'CLI_USAGE_INVALID',
      `Option --${name} must be a safe integer between ${minimum} and ${maximum}.`
    );
  }
  return value;
}

export function requireSafeIntegerCliOption(
  options: CliOptionValues,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  return parseSafeInteger(requireCliOption(options, name), name, minimum, maximum);
}

export function optionalSafeIntegerCliOption(
  options: CliOptionValues,
  name: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER
): number | undefined {
  const raw = optionalCliOption(options, name);
  return raw === undefined ? undefined : parseSafeInteger(raw, name, minimum, maximum);
}

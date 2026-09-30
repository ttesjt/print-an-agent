#!/usr/bin/env node
import {
  loadAgentBaseCliManagedDirectory,
  loadAgentBaseCliProvider,
  loadAgentBaseCliRuntime,
  loadAgentBaseCliSessionManager,
  readAgentBaseCliJsonDocument,
} from './host-loaders.js';
import {
  createNodeWriter,
  defaultAgentBaseCliProcess,
  readNodeStandardInput,
} from './node-process.js';
import { runAgentBaseCli } from './run-cli.js';

const cliProcess = defaultAgentBaseCliProcess();
const cancellation = new AbortController();
const onInterrupt = (): void => cancellation.abort(new Error('Agent Base CLI interrupted.'));
process.once('SIGINT', onInterrupt);

try {
  process.exitCode = await runAgentBaseCli(cliProcess.argv, {
    loadProvider: (locator) => loadAgentBaseCliProvider(locator, cliProcess.environment),
    loadRuntime: (locator) => loadAgentBaseCliRuntime(locator, cliProcess.environment),
    loadManagedDirectory: (rootDirectory) =>
      loadAgentBaseCliManagedDirectory(rootDirectory, cliProcess.environment),
    loadSessionManager: loadAgentBaseCliSessionManager,
    readJsonDocument: readAgentBaseCliJsonDocument,
    readStandardInput: (signal) => readNodeStandardInput(cliProcess.standardInput, signal),
    standardOutput: createNodeWriter(cliProcess.standardOutput),
    standardError: createNodeWriter(cliProcess.standardError),
    signal: cancellation.signal,
  });
} finally {
  process.off('SIGINT', onInterrupt);
}

#!/usr/bin/env node
import {
  loadAgentBaseCliManagedDirectory,
  loadAgentBaseCliRuntime,
  readAgentBaseCliJsonDocument,
} from './load-runtime.js';
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
    loadRuntime: (locator) => loadAgentBaseCliRuntime(locator, cliProcess.environment),
    loadManagedDirectory: (rootDirectory) =>
      loadAgentBaseCliManagedDirectory(rootDirectory, cliProcess.environment),
    readJsonDocument: readAgentBaseCliJsonDocument,
    readStandardInput: (signal) => readNodeStandardInput(cliProcess.standardInput, signal),
    standardOutput: createNodeWriter(cliProcess.standardOutput),
    standardError: createNodeWriter(cliProcess.standardError),
    signal: cancellation.signal,
  });
} finally {
  process.off('SIGINT', onInterrupt);
}

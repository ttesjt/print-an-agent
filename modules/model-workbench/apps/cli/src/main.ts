#!/usr/bin/env node
import {
  loadModelWorkbenchCliApplication,
  readModelWorkbenchCliJsonDocument,
} from './load-application.js';
import { createNodeWriter, defaultModelWorkbenchCliProcess } from './node-process.js';
import { runModelWorkbenchCli } from './run-cli.js';

const cliProcess = defaultModelWorkbenchCliProcess();
const cancellation = new AbortController();
const interrupt = (): void => cancellation.abort(new Error('Model Workbench CLI interrupted.'));
process.once('SIGINT', interrupt);

try {
  process.exitCode = await runModelWorkbenchCli(cliProcess.argv, {
    loadApplication: loadModelWorkbenchCliApplication,
    readJsonDocument: (path) => readModelWorkbenchCliJsonDocument(path),
    standardOutput: createNodeWriter(cliProcess.standardOutput),
    standardError: createNodeWriter(cliProcess.standardError),
    signal: cancellation.signal,
  });
} finally {
  process.off('SIGINT', interrupt);
}

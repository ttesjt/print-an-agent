#!/usr/bin/env node
import { runLocalSupervisor } from './run-local-supervisor.js';

const executionDirectory = process.argv[2];
if (executionDirectory === undefined) {
  process.stderr.write('Missing local execution directory.\n');
  process.exitCode = 1;
} else {
  void runLocalSupervisor(executionDirectory).catch((cause: unknown) => {
    process.stderr.write(`${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exitCode = 1;
  });
}

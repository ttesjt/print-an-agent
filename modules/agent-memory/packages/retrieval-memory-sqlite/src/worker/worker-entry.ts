import { parentPort, workerData } from 'node:worker_threads';
import { readWorkerConfiguration } from './protocol/index.js';
import { runWorker } from './runtime.js';

if (parentPort === null) throw new Error('SQLite retrieval worker needs a host.');
runWorker(parentPort, readWorkerConfiguration(workerData));

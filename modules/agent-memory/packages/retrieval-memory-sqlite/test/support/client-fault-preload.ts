import { isMainThread, parentPort } from 'node:worker_threads';

// Real Worker fault injection, inherited only by isolated consumer subprocesses.
if (!isMainThread && parentPort !== null) {
  if (process.env.RETRIEVAL_TEST_CLIENT_FAULT === 'exit') {
    parentPort.once('message', () => process.exit(17));
  } else {
    const send = parentPort.postMessage.bind(parentPort);
    let injected = false;
    parentPort.postMessage = (message: unknown) => {
      if (
        !injected &&
        typeof message === 'object' &&
        message !== null &&
        'operation' in message &&
        message.operation === 'inspect'
      ) {
        injected = true;
        send({ malformed: true });
      } else send(message);
    };
  }
}

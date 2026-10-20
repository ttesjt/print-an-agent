import { expect, it } from 'vitest';
import { readNdjsonResponse } from '../src/browser.js';

it('preserves split UTF-8 lines and awaits backpressure before another frame', async () => {
  const encoded = new TextEncoder().encode('中\n文\n');
  const release = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const values: string[] = [];
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of encoded) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } }
  );
  const pending = readNdjsonResponse(response, async (line) => {
    values.push(line);
    if (values.length === 1) {
      entered.resolve();
      await release.promise;
    }
  });
  await entered.promise;
  expect(values).toEqual(['中']);
  release.resolve();
  await pending;
  expect(values).toEqual(['中', '文']);
});

it.each(['unterminated', '\ntrailing'])('rejects incomplete final framing: %s', async (body) => {
  await expect(
    readNdjsonResponse(
      new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } }),
      () => Promise.resolve()
    )
  ).rejects.toMatchObject({ code: 'WEB_TRANSPORT_INVALID' });
});

it('cancels a stalled reader when its caller aborts', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const cause = new Error('cancel');
  const response = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { headers: { 'Content-Type': 'application/x-ndjson' } }
  );
  const pending = readNdjsonResponse(response, () => Promise.resolve(), controller.signal);
  const checked = expect(pending).rejects.toBe(cause);
  controller.abort(cause);
  await checked;
  expect(cancelled).toBe(true);
});

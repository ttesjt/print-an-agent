import { readFile } from 'node:fs/promises';
import { createProviderRuntime, defineProviderConfig } from '@ta-agent/base-composition';
import { defineProviderTransportLivenessPolicy } from '@ta-agent/base-model';
import { object, optional, union, literal, integer } from '../transport/decoder.js';
import { WEB_TRANSPORT_LIMITS } from '../transport/limits.js';

/** Server-only host provisioning; never stored in browser-editable Agent config. */
export async function loadWebProviderRuntime(filename: string) {
  const bytes = await readFile(filename);
  if (bytes.byteLength > WEB_TRANSPORT_LIMITS.requestBytes)
    throw new Error('Host config exceeds its input bound.');
  const opaque = { decode: (value: unknown) => value };
  const timeout = union(literal(null), integer(1, 2_147_483_647));
  const input = object({
    config: opaque,
    transportLivenessPolicy: optional(
      object({
        responseStartTimeoutMilliseconds: timeout,
        streamEventIdleTimeoutMilliseconds: timeout,
      })
    ),
  }).decode(JSON.parse(bytes.toString('utf8')));
  const config = defineProviderConfig(input.config);
  const transportLivenessPolicy = defineProviderTransportLivenessPolicy(
    input.transportLivenessPolicy
  );
  return createProviderRuntime({
    config,
    transportLivenessPolicy,
    credentialResolver: {
      resolve: ({ reference, signal }) => {
        signal.throwIfAborted();
        // Host convention: credentialRef is the exact name of an environment variable.
        if (!/^[A-Z][A-Z0-9_]{0,127}$/u.test(reference)) return Promise.resolve(undefined);
        const apiKey = process.env[reference];
        return Promise.resolve(
          apiKey === undefined || apiKey.length === 0
            ? undefined
            : { type: 'api-key' as const, apiKey }
        );
      },
    },
  });
}

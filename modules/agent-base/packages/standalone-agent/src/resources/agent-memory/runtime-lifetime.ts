import { hasSessionMemoryCleanupFailure } from '@print-an-agent/base-composition';
import { ResourceCleanupError } from '@print-an-agent/base-composition/resource-registry';
import type { RequestContextMemory } from '@print-an-agent/base-request';
import { AgentBaseStandaloneError } from '../../errors.js';
import type { StandaloneSetupCloseOptions } from '../../profiles/setup.js';

/** Host/Profile owner of borrowed runtime use, distinct from Registry acquisition lifetime. */
export class RuntimeMemoryLifetime {
  readonly #abort = new AbortController();
  readonly #cleanupFailures = new Set<unknown>();
  #open = true;
  #runs = 0;
  #calls = 0;

  async invoke<T>(
    signal: AbortSignal | undefined,
    operation: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    if (!this.#open) throw new AgentBaseStandaloneError('Runtime Memory setup is closing.');
    this.#calls++;
    try {
      return await operation(
        signal === undefined ? this.#abort.signal : AbortSignal.any([signal, this.#abort.signal])
      );
    } catch (cause) {
      if (hasSessionMemoryCleanupFailure(cause)) this.#cleanupFailures.add(cause);
      throw cause;
    } finally {
      this.#calls--;
    }
  }

  track(capability: RequestContextMemory): RequestContextMemory {
    return {
      open: async (target, signal) => {
        if (!this.#open) throw new AgentBaseStandaloneError('Runtime Memory setup is closing.');
        this.#runs++;
        let finished = false;
        const finish = () => {
          if (!finished) {
            finished = true;
            this.#runs--;
          }
        };
        try {
          const run = await capability.open(target, AbortSignal.any([signal, this.#abort.signal]));
          return {
            ...run,
            settle: async () => {
              try {
                await run.settle();
              } catch (cause) {
                if (hasSessionMemoryCleanupFailure(cause)) this.#cleanupFailures.add(cause);
                throw cause;
              } finally {
                finish();
              }
            },
          };
        } catch (cause) {
          finish();
          if (hasSessionMemoryCleanupFailure(cause)) this.#cleanupFailures.add(cause);
          throw cause;
        }
      },
    };
  }

  prepareClose(options: StandaloneSetupCloseOptions): void {
    this.#open = false;
    if (options.mode === 'abort') this.#abort.abort(new Error('Runtime Memory setup aborted.'));
    if (this.#cleanupFailures.size !== 0)
      throw new ResourceCleanupError({ failures: [...this.#cleanupFailures] });
    if (this.#runs !== 0 || this.#calls !== 0)
      throw new AgentBaseStandaloneError(
        'Stop and join Agent/Memory operations before closing their setup. Resources remain owned and open.',
        { code: 'STANDALONE_MEMORY_BUSY' }
      );
  }
}

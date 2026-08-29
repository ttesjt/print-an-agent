import type { ModelOutput, OutputId } from '@ta-agent/workbench-domain';

import type { OutputRepository } from '../ports/output-repository.js';
import type { PersistencePageRequest } from '../ports/persistence-page.js';
import type { PersistenceRecordStore } from './persistence-record-store.js';

export function createRecordStoreOutputRepository(store: PersistenceRecordStore): OutputRepository {
  return Object.freeze({
    findOutput: (outputId: OutputId): Promise<ModelOutput | undefined> =>
      Promise.resolve().then(() => store.outputs.find(outputId)),
    listOutputs: (request: PersistencePageRequest<OutputId>) =>
      Promise.resolve().then(() => store.outputs.list(request)),
  });
}

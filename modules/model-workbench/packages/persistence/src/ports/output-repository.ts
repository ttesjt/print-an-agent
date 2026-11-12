import type { ModelOutput, OutputId } from '@print-an-agent/workbench-domain';
import type { PersistencePage, PersistencePageRequest } from './persistence-page.js';

export interface OutputRepository {
  findOutput(outputId: OutputId): Promise<ModelOutput | undefined>;
  listOutputs(request: PersistencePageRequest<OutputId>): Promise<PersistencePage<ModelOutput>>;
}

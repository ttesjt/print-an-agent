import type { ModelOutput, OutputId } from '@ta-agent/workbench-domain';

export interface OutputRepository {
  findOutput(outputId: OutputId): Promise<ModelOutput | undefined>;
}

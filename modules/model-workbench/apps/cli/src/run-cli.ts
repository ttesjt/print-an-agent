import {
  type BaseReferenceInput,
  OutputInvocationKind,
  type InvokeOutputInput,
  type ListModelAssetsInput,
  type ListOutputsInput,
  type ListRunsInput,
  type ModelWorkbench,
  type ModificationReferenceInput,
  type OutputReferenceInput,
  type RunReferenceInput,
  type StartExportInput,
  type StartInitializationInput,
  type StartTrainingInput,
} from '@ta-agent/workbench-application';

type ModelStateInput = Parameters<ModelWorkbench['models']['compose']>[0];

import type { ModelWorkbenchCliDependencies } from './contracts.js';
import { ModelWorkbenchCliError } from './errors.js';
import {
  ModelWorkbenchCliCommandKind,
  parseModelWorkbenchCliCommand,
  type ModelWorkbenchCliCommand,
} from './parse-command.js';

export const MODEL_WORKBENCH_CLI_USAGE = `Usage:
  model-workbench initialization start --application <module> --request <json>
  model-workbench training start --application <module> --request <json>
  model-workbench export start --application <module> --request <json>
  model-workbench output invoke|get|list --application <module> --request <json>
  model-workbench run get|list|refresh|wait|cancel --application <module> --request <json>
  model-workbench base get|list --application <module> --request <json>
  model-workbench modification get|list --application <module> --request <json>
  model-workbench model compose --application <module> --request <json>
`;

export async function runModelWorkbenchCli(
  argv: readonly string[],
  dependencies: ModelWorkbenchCliDependencies
): Promise<number> {
  try {
    const command = parseModelWorkbenchCliCommand(argv);
    if (command.kind === ModelWorkbenchCliCommandKind.Help) {
      await dependencies.standardOutput.write(MODEL_WORKBENCH_CLI_USAGE);
      return 0;
    }
    const application = await dependencies.loadApplication(command.applicationPath);
    try {
      const request = await dependencies.readJsonDocument(command.requestPath, dependencies.signal);
      await execute(command, request, dependencies, application.workbench);
      return 0;
    } finally {
      await application.close();
    }
  } catch (error: unknown) {
    if (dependencies.signal.aborted) return 130;
    const code = safeErrorCode(error);
    await dependencies.standardError.write(`Model Workbench command failed (${code}).\n`);
    return error instanceof ModelWorkbenchCliError ? 2 : 1;
  }
}

async function execute(
  command: Exclude<ModelWorkbenchCliCommand, Readonly<{ kind: 'help' }>>,
  request: unknown,
  dependencies: ModelWorkbenchCliDependencies,
  workbench: Awaited<ReturnType<ModelWorkbenchCliDependencies['loadApplication']>>['workbench']
): Promise<void> {
  const value = requireRecord(request);
  const signal = dependencies.signal;
  switch (command.kind) {
    case ModelWorkbenchCliCommandKind.InitializationStart:
      return writeJson(
        dependencies,
        await workbench.initialization.start(value as unknown as StartInitializationInput, {
          signal,
        })
      );
    case ModelWorkbenchCliCommandKind.TrainingStart:
      return writeJson(
        dependencies,
        await workbench.training.start(value as unknown as StartTrainingInput, { signal })
      );
    case ModelWorkbenchCliCommandKind.ExportStart:
      return writeJson(
        dependencies,
        await workbench.exports.start(value as unknown as StartExportInput, { signal })
      );
    case ModelWorkbenchCliCommandKind.RunGet:
      return writeJson(
        dependencies,
        await workbench.runs.get(value as unknown as RunReferenceInput)
      );
    case ModelWorkbenchCliCommandKind.RunList:
      return writeJson(dependencies, await workbench.runs.list(value as unknown as ListRunsInput));
    case ModelWorkbenchCliCommandKind.RunRefresh:
      return writeJson(
        dependencies,
        await workbench.runs.refresh(value as unknown as RunReferenceInput, { signal })
      );
    case ModelWorkbenchCliCommandKind.RunWait:
      return writeJson(
        dependencies,
        await workbench.runs.wait(value as unknown as RunReferenceInput, { signal })
      );
    case ModelWorkbenchCliCommandKind.RunCancel:
      return writeJson(
        dependencies,
        await workbench.runs.cancel(value as unknown as RunReferenceInput, { signal })
      );
    case ModelWorkbenchCliCommandKind.BaseGet:
      return writeJson(
        dependencies,
        await workbench.models.getBase(value as unknown as BaseReferenceInput)
      );
    case ModelWorkbenchCliCommandKind.BaseList:
      return writeJson(
        dependencies,
        await workbench.models.listBases(value as unknown as ListModelAssetsInput)
      );
    case ModelWorkbenchCliCommandKind.ModificationGet:
      return writeJson(
        dependencies,
        await workbench.models.getModification(value as unknown as ModificationReferenceInput)
      );
    case ModelWorkbenchCliCommandKind.ModificationList:
      return writeJson(
        dependencies,
        await workbench.models.listModifications(value as unknown as ListModelAssetsInput)
      );
    case ModelWorkbenchCliCommandKind.OutputGet:
      return writeJson(
        dependencies,
        await workbench.outputs.get(value as unknown as OutputReferenceInput)
      );
    case ModelWorkbenchCliCommandKind.OutputList:
      return writeJson(
        dependencies,
        await workbench.outputs.list(value as unknown as ListOutputsInput)
      );
    case ModelWorkbenchCliCommandKind.ModelCompose:
      return writeJson(dependencies, workbench.models.compose(value as unknown as ModelStateInput));
    case ModelWorkbenchCliCommandKind.OutputInvoke: {
      const invocation = await workbench.outputInvocations.invoke(
        value as unknown as InvokeOutputInput,
        { signal }
      );
      if (invocation.kind === OutputInvocationKind.Completed) {
        return writeJson(dependencies, invocation);
      }
      await writeJson(dependencies, {
        kind: OutputInvocationKind.Streaming,
        evidence: invocation.evidence,
      });
      for await (const result of invocation.stream) {
        await writeJson(dependencies, { kind: 'chunk', result });
      }
    }
  }
}

async function writeJson(
  dependencies: ModelWorkbenchCliDependencies,
  value: unknown
): Promise<void> {
  await dependencies.standardOutput.write(`${JSON.stringify(value)}\n`);
}

function requireRecord(input: unknown): Readonly<Record<string, unknown>> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ModelWorkbenchCliError('CLI_REQUEST_INVALID', 'Request JSON must be an object.');
  }
  return input as Readonly<Record<string, unknown>>;
}

function safeErrorCode(error: unknown): string {
  if (
    typeof error !== 'object' ||
    error === null ||
    !Object.hasOwn(error, 'code') ||
    typeof (error as Readonly<Record<string, unknown>>).code !== 'string'
  ) {
    return 'UNEXPECTED_FAILURE';
  }
  return (error as Readonly<{ code: string }>).code;
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, onTestFinished, vi } from 'vitest';
import {
  createAgentManagementService,
  createContextMemoryManagementService,
  createRetrievalMemoryManagementService,
} from '@print-an-agent/base-composition';
import {
  createStandaloneMemorySetup,
  createStandaloneDirectorySetup,
  defineStandaloneAgentConfig,
} from '@print-an-agent/base-standalone-agent';
import {
  createMemoryApplyDefinition,
  MemoryMeter,
  type MemoryStore,
} from '@print-an-agent/context-memory';
import { SqliteMemoryStore } from '@print-an-agent/context-memory-sqlite';
import { createCodepointChunker, COSINE_METRIC_REF } from '@print-an-agent/retrieval-memory';
import {
  createTextEmbedder,
  createTokenCounter,
  TEXT_TOKEN_INPUT_CONTRACT,
} from '@print-an-agent/model-invocation-core';
import { projectContextMemory } from './consumers/direct-context-memory.js';

const config = () =>
  defineStandaloneAgentConfig({
    provider: {
      config: {
        kind: 'openai-compatible',
        reference: {
          provider: 'unavailable',
          model: 'not-a-chat-test',
          baseUrl: 'http://127.0.0.1:1/v1',
        },
        contextWindowTokens: 4096,
        maxOutputTokens: 512,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    },
  });
const runtime = {
  readEnvironmentVariable: () => {
    throw new Error('Memory management cannot require chat credentials');
  },
};
const target = { agentId: 'project-agent', memoryId: 'notes' };
async function directory() {
  return mkdtemp(join(tmpdir(), 'base-memory-consumer-'));
}
function counter() {
  return createTokenCounter({
    measurementRef: 'consumer:characters:v1',
    inputContract: TEXT_TOKEN_INPUT_CONTRACT,
    measure: (input) => Promise.resolve({ tokens: input.text.length, accuracy: 'exact' }),
  });
}

it('consumes public management with direct provisioning, borrowed adapter, custom named Step and complete Workflow graph', async () => {
  const root = await directory();
  const setup = createStandaloneMemorySetup(runtime);
  await createAgentManagementService(setup.definition).create({
    identity: { id: target.agentId },
    config: config(),
  });
  const path = join(root, 'project-notes.sqlite');
  let store = new SqliteMemoryStore({ path });
  onTestFinished(async () => {
    await setup.close();
    store.close();
    await rm(root, { recursive: true, force: true });
  });
  const commits = vi.fn<MemoryStore['commit']>((...args) => store.commit(...args));
  const adapter: MemoryStore = {
    read: (...args) => store.read(...args),
    getReceipt: (...args) => store.getReceipt(...args),
    commit: commits,
  };
  const namedSteps = vi.fn();
  const graphs = vi.fn();
  const base = createMemoryApplyDefinition();
  const prepare = base.stepDefinitions.prepareInput.step!;
  const custom = createMemoryApplyDefinition({
    stepOverrides: {
      prepareInput: async (context) => {
        namedSteps();
        await prepare(context);
      },
    },
  });
  const applicationWorkflow: typeof custom = {
    ...custom,
    name: 'project.apply-note',
    stepDefinitions: {
      ...custom.stepDefinitions,
      runMemoryOperation: {
        skippable: false,
        cardinality: 'at-most-once',
        step: async (context) => {
          graphs();
          await context.runStep('prepareInput');
          await context.runStep('executeOperation');
        },
      },
    },
  };
  const make = () =>
    createContextMemoryManagementService(
      projectContextMemory(
        setup.definition.namespace.port,
        {
          store: adapter,
          meter: new MemoryMeter({ counter: counter() }),
          defaults: { measurementRef: 'consumer:characters:v1' },
        },
        { apply: applicationWorkflow }
      )
    );
  const service = make();
  await service.create({ ...target, requestId: 'create' });
  const input = {
    ...target,
    requestId: 'edit',
    expectedRevision: 1,
    commands: [{ op: 'add' as const, content: 'A project note.' }],
  };
  const result = await service.apply(input);
  expect(result.value.status).toBe('committed');
  expect(graphs).toHaveBeenCalledTimes(1);
  expect(namedSteps).toHaveBeenCalledTimes(1);
  expect(commits).toHaveBeenCalledTimes(2);
  // The caller owns close/reopen. No Bundle or Service closes a borrowed adapter.
  store.close();
  store = new SqliteMemoryStore({ path });
  const reopened = make();
  expect((await reopened.getReceipt({ ...target, requestId: 'edit' })).value).toEqual(
    result.value.status === 'skipped' ? undefined : result.value.receipt
  );
  expect(await reopened.apply(input)).toEqual(result);
  expect(commits).toHaveBeenCalledTimes(2);
  expect(graphs).toHaveBeenCalledTimes(1);
  expect((await reopened.readContext(target)).value?.text).toBe('A project note.');
  await reopened.create({ ...target, memoryId: 'other-project', requestId: 'create' });
  expect(
    (await reopened.inspect({ ...target, memoryId: 'other-project' })).value?.items
  ).toHaveLength(0);
});

it('reopens public Profile authorities and recovers lost delivery without repeating embedding; content-only management survives model loss', async () => {
  const root = await directory();
  const embed = vi.fn(
    ({ inputs }: { readonly inputs: readonly { readonly id: string; readonly text: string }[] }) =>
      Promise.resolve(
        inputs.map(({ id, text }) => ({ id, vector: text.includes('dog') ? [0, 1] : [1, 0] }))
      )
  );
  const embedding = createTextEmbedder({
    representation: {
      modelRef: 'consumer:semantic-v1',
      dimensions: 2,
      preprocessingRef: 'raw',
      documentRecipeRef: 'same',
      queryRecipeRef: 'same',
      outputTransformRef: 'raw',
    },
    limits: { maxBatchSize: 32, maxInputUtf8Bytes: null, maxBatchUtf8Bytes: null },
    embed,
  });
  let online = true;
  const memory = {
    storageNamespaceId: 'independent-project',
    context: {
      defaults: { measurementRef: 'consumer:characters:v1' },
      acquireCounter: () => ({ value: counter() }),
    },
    retrieval: {
      acquireEmbedding: () => {
        if (!online) throw new Error('Embedding is unavailable');
        return { value: embedding };
      },
    },
  };
  let setup = createStandaloneDirectorySetup({ rootDirectory: root, ...runtime }, memory);
  onTestFinished(async () => {
    await setup.close();
    await rm(root, { recursive: true, force: true });
  });
  const agents = createAgentManagementService(setup.definition);
  for (const id of [target.agentId, 'another-agent'])
    await agents.create({ identity: { id }, config: config() });
  const context = createContextMemoryManagementService(setup.definition);
  await context.create({
    ...target,
    requestId: 'context',
    items: [{ content: 'Preserved context.' }],
  });
  const retrieval = createRetrievalMemoryManagementService(setup.definition);
  const index = {
    embeddingRef: embedding.descriptor.representationRef,
    chunkerRef: createCodepointChunker().ref,
    metricRef: COSINE_METRIC_REF,
  };
  await retrieval.create({ ...target, requestId: 'create', index });
  const input = {
    ...target,
    requestId: 'ingest',
    content: 'cat knowledge',
    metadata: { project: 'research' },
  };
  const result = await retrieval.ingest(input);
  if (result.value.status === 'skipped' || result.value.receipt.entryId === null)
    throw new Error('Expected durable entry');
  const receipt = result.value.receipt;
  const entryId = receipt.entryId;
  if (entryId === null) throw new Error('Expected Entry identity');
  expect(embed).toHaveBeenCalledTimes(1);
  // Delivery can fail independently after this durable result; recovery uses the original request.
  await expect(
    Promise.resolve(result).then(() => {
      throw new Error('Delivery lost');
    })
  ).rejects.toThrow('Delivery lost');
  await setup.close();
  online = false;
  setup = createStandaloneDirectorySetup({ rootDirectory: root, ...runtime }, memory);
  const reopened = createRetrievalMemoryManagementService(setup.definition);
  expect((await reopened.getReceipt({ ...target, requestId: 'ingest' })).value).toEqual({
    status: 'completed',
    value: receipt,
  });
  expect(await reopened.ingest(input)).toEqual(result);
  expect(embed).toHaveBeenCalledTimes(1);
  const list = await reopened.list(target);
  expect(list.value).toMatchObject({
    status: 'completed',
    value: { entries: [{ entryId, revision: 1 }] },
  });
  expect(
    (await createContextMemoryManagementService(setup.definition).readContext(target)).value?.text
  ).toBe('Preserved context.');
  await expect(reopened.inspect({ ...target, agentId: 'another-agent' })).rejects.toMatchObject({
    failure: { code: 'MEMORY_NOT_FOUND' },
  });
  await expect(reopened.search({ ...target, query: 'cat' })).rejects.toMatchObject({
    code: 'MEMORY_OPERATION_FAILED',
  });
  await reopened.remove({ ...target, requestId: 'remove', entryId, expectedRevision: 1 });
  expect(embed).toHaveBeenCalledTimes(1);
});

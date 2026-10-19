import { expect, expectTypeOf, it } from 'vitest';
import {
  createActor,
  type ResolvedActor,
  type ActorDirectResult,
} from '@ta-agent/model-invocation-core';
import { createPiFauxRuntime } from '@ta-agent/model-invocation-pi';
import { createProviderRuntime } from '@ta-agent/base-composition';
import {
  createSessionlessRequestWorkflow,
  resolveRequestInstructions,
  type InstructionsStepContext,
  type SessionlessGenerationPolicy,
  type SessionlessGenerationResources,
  type SessionlessInteractionResponse,
  type SessionlessOutputSink,
} from '@ta-agent/base-request';
import { createWebsiteAssistant, parseWebsiteAnswer } from './consumers/website-assistant.js';
import { startLoopbackProvider } from './support/loopback-provider.js';
import { createToolRegistry, defineTool, defineToolPermissionPolicy } from '@ta-agent/base-tool';

const pages = { projects: { title: 'Projects', summary: 'Modular agent tools.' } };

it('qualifies a tool loop without an Agent or Session using the same public factory', async () => {
  let executions = 0;
  const profile = createPiFauxRuntime({
    responses: [
      { status: 'tool-call', name: 'lookup', arguments: {} },
      { status: 'success', text: 'projects' },
    ],
  });
  const tool = defineTool({
    name: 'lookup',
    description: 'Look up a page',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
    execute: () => {
      executions++;
      return Promise.resolve({ text: 'projects' });
    },
  });
  const workflow = createSessionlessRequestWorkflow({
    mode: 'interaction',
    resources: {
      actor: createActor({ id: 'site', engine: profile.actorEngine }),
      tools: {
        registry: createToolRegistry([tool]),
        permissionPolicy: defineToolPermissionPolicy({
          responsibility: ['lookup'],
          actor: ['lookup'],
          product: ['lookup'],
          runtime: ['lookup'],
        }),
      },
    },
  });
  const result = await workflow.run({ input: { message: 'Find my projects' } });
  expect(result).toMatchObject({
    message: { text: 'projects' },
    toolRun: { status: 'closed', records: [{ status: 'success' }] },
  });
  expect(executions).toBe(1);
  expect(profile.inspect().callCount).toBe(2);
});

it('qualifies a website-owned JSON contract through one public Actor/Workflow generation', async () => {
  const profile = createPiFauxRuntime({
    responses: [{ status: 'success', text: '{"answer":"See my projects","pageId":"projects"}' }],
  });
  const actor = createActor({ id: 'website', engine: profile.actorEngine });
  const workflow = createWebsiteAssistant(actor, pages);
  const response = await workflow.run({
    input: {
      message: 'What do you build?',
      history: [{ role: 'context', text: 'Current page: home', timestamp: 0 }],
    },
  });
  expect(response?.message.text).toContain('projects');
  expect(parseWebsiteAnswer(response?.message.text ?? '', pages)).toEqual({
    answer: 'See my projects',
    pageId: 'projects',
  });
  expect(profile.inspect()).toMatchObject({ callCount: 1, requests: [{ kind: 'direct' }] });
  expect(
    profile
      .inspect()
      .requests[0]?.messages.some((message) => message.text.includes('Modular agent tools'))
  ).toBe(true);
  expect(workflow.name).toBe('website-answer');
});

it('rejects unknown navigation IDs without a repair loop or hidden persistence', async () => {
  const profile = createPiFauxRuntime({
    responses: [
      { status: 'success', text: '{"answer":"Navigate","pageId":"https://example.invalid"}' },
    ],
  });
  const workflow = createWebsiteAssistant(
    createActor({ id: 'website', engine: profile.actorEngine }),
    pages
  );
  await expect(workflow.run({ input: { message: 'Where next?' } })).rejects.toMatchObject({
    code: 'REQUEST_OUTPUT_STATE_INVALID',
  });
  expect(profile.inspect().callCount).toBe(1);
});

it('qualifies streaming through public composition with a real localhost Pi provider', async () => {
  const provider = await startLoopbackProvider([
    { status: 'success', chunks: ['Go to ', 'projects'] },
  ]);
  try {
    const runtime = createProviderRuntime({
      config: {
        kind: 'openai-compatible',
        reference: { provider: 'fixture', model: 'fixture', baseUrl: provider.baseUrl },
        contextWindowTokens: 4096,
        maxOutputTokens: 256,
        supportsReasoning: false,
        compatibility: { supportsDeveloperRole: false },
      },
    });
    const events: string[] = [];
    const channel: SessionlessOutputSink = {
      open: () => Promise.resolve(),
      write: (event) => {
        events.push(event.type);
        return Promise.resolve();
      },
      close: () => {
        events.push('closed');
        return Promise.resolve();
      },
      fail: () => {
        events.push('failed');
        return Promise.resolve();
      },
    };
    const workflow = createSessionlessRequestWorkflow({
      mode: 'stream',
      resources: {
        actor: createActor({ id: 'site', engine: runtime.actorEngine }),
        createOutputSink: () => channel,
      },
    });
    const result = await workflow.run({ input: { message: 'Where next?' } });
    expect(result?.message.text).toBe('Go to projects');
    expect(events).toEqual(['text-delta', 'text-delta', 'closed']);
    expect(provider.requests()).toHaveLength(1);
  } finally {
    await provider.close();
  }
});

it('exposes shared instruction Steps to unrelated minimal Contexts through package exports', async () => {
  interface WebsiteContext extends InstructionsStepContext<string> {
    pageId: string;
  }
  interface ReportContext extends InstructionsStepContext<string> {
    reportId: string;
  }
  const website: WebsiteContext = {
    pageId: 'home',
    state: { request: 'question' },
    resources: {
      policy: { maxInstructionsCharacters: 100 },
      instructionContributors: [({ request }) => request],
    },
  };
  const report: ReportContext = {
    reportId: 'report',
    state: { request: 'report question' },
    resources: {
      policy: { maxInstructionsCharacters: 100 },
      instructionContributors: [({ request }) => request],
    },
  };
  await Promise.all([resolveRequestInstructions(website), resolveRequestInstructions(report)]);
  expect(website.state.instructions).toBe('question');
  expect(report.state.instructions).toBe('report question');
});

it('keeps public Generation resources free from Session, tool and Agent requirements', () => {
  expectTypeOf<SessionlessGenerationResources['actor']>().toEqualTypeOf<ResolvedActor>();
  expectTypeOf<SessionlessGenerationResources>().not.toHaveProperty('session');
  expectTypeOf<SessionlessGenerationResources>().not.toHaveProperty('tools');
  expectTypeOf<SessionlessGenerationPolicy>().not.toHaveProperty('maxModelTurns');
  expectTypeOf<SessionlessInteractionResponse>().toHaveProperty('toolRun');
  expectTypeOf<SessionlessInteractionResponse>().toExtend<ActorDirectResult>();
});

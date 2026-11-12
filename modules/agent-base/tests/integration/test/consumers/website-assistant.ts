import type { ResolvedActor } from '@print-an-agent/model-invocation-core';
import { AgentRequestError, createSessionlessRequestWorkflow } from '@print-an-agent/base-request';

export interface WebsitePage {
  readonly title: string;
  readonly summary: string;
}

export interface WebsiteAnswer {
  readonly answer: string;
  readonly pageId: string;
}

/** Product schema and routing authority belong to the website, not the framework. */
export function parseWebsiteAnswer(
  text: string,
  pages: Readonly<Record<string, WebsitePage>>
): WebsiteAnswer {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AgentRequestError('REQUEST_OUTPUT_STATE_INVALID', 'Website response must be JSON.');
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !('answer' in value) ||
    typeof value.answer !== 'string' ||
    !('pageId' in value) ||
    typeof value.pageId !== 'string' ||
    !Object.hasOwn(pages, value.pageId)
  ) {
    throw new AgentRequestError(
      'REQUEST_OUTPUT_STATE_INVALID',
      'Website response must reference a known page.'
    );
  }
  return Object.freeze({ answer: value.answer, pageId: value.pageId });
}

/** Host assembly: one borrowed Actor, replaceable Steps, no Agent/Session/Journal owner. */
export function createWebsiteAssistant(
  actor: ResolvedActor,
  pages: Readonly<Record<string, WebsitePage>>
) {
  const catalog = Object.freeze(
    Object.fromEntries(Object.entries(pages).map(([id, page]) => [id, Object.freeze({ ...page })]))
  );
  return createSessionlessRequestWorkflow({
    name: 'website-answer',
    mode: 'direct',
    resources: {
      actor,
      instructionContributors: [
        () =>
          'Answer only from the supplied site facts. Return JSON with answer and pageId. Choose a known pageId; never return executable markup or an external URL.',
      ],
    },
    stepOverrides: {
      gatherExternalContext: (context) => {
        context.state.externalContext = [
          { role: 'context', text: JSON.stringify(catalog), timestamp: 0 },
        ];
        return Promise.resolve();
      },
      validateResponse: (context) => {
        const response = context.state.response;
        if (response === undefined)
          throw new AgentRequestError(
            'REQUEST_OUTPUT_STATE_INVALID',
            'Website response is missing.'
          );
        parseWebsiteAnswer(response.message.text, catalog);
        return Promise.resolve();
      },
    },
  });
}

# Sessionless Request Workflows

`createSessionlessRequestWorkflow()` assembles a real `@print-an-agent/workflow-core` Workflow over an
independent Actor. It requires no Agent, AgentOperation, Session, Journal, main Actor, catalog, local
adapter or persistent configuration. It does not automatically load or save conversation history.

Session ownership and invocation mode are independent. The Session-aware foreground Workflow keeps
its existing Session authority, replay and atomic turn/presentation commit. The Sessionless factory
offers these assembly-time profiles:

| `mode`        | Actor capability             | Tool execution      | Result                                            |
| ------------- | ---------------------------- | ------------------- | ------------------------------------------------- |
| `direct`      | `complete()`                 | None                | `ActorDirectResult`                               |
| `stream`      | Single-generation `stream()` | None                | `ActorDirectResult`, with incremental delivery    |
| `interaction` | `interact()`                 | Bounded Tool Broker | Assistant message and closed `toolRun` inspection |

A condition skip returns `undefined`. An active successful Run must produce a result. A logical
single generation does not promise exactly one HTTP request: transport retries belong to the Engine.
An Interaction with `maxModelTurns: 1` remains an Interaction, not a substitute for direct generation.

## Host assembly and invocation

The host reads and validates environment/provider configuration and creates the Actor. Borrowed
resources are bound at assembly; each `.run()` supplies only input and execution options. No runtime
class or API facade is needed:

```ts
import { createActor } from '@print-an-agent/model-invocation-core';
import { createProviderRuntime } from '@print-an-agent/base-composition';
import { createSessionlessRequestWorkflow } from '@print-an-agent/base-request';

// providerOptions is host-owned configuration, including its credential resolver if required.
const provider = createProviderRuntime(providerOptions);
const actor = createActor({ id: 'website', engine: provider.actorEngine });
const workflow = createSessionlessRequestWorkflow({
  name: 'website.answer',
  mode: 'direct',
  resources: {
    actor,
    instructionContributors: [() => 'Answer using the supplied site facts.'],
    policy: { maxOutputCharacters: 4_000 },
  },
});

const result = await workflow.run({
  input: {
    message: 'What projects do you work on?',
    history: [{ role: 'context', text: 'Site facts supplied by the host.', timestamp: 0 }],
  },
  signal,
});
if (result !== undefined) render(result.message.text);
```

The closed input is `{ message, history? }`. Messages use Core's existing user/context/assistant
protocol; they retain order and provenance and are normalized into detached immutable values.
History is optional caller data, not a Session handle. Each invocation adds its own current user
message; previous Runs are never added automatically. The host can map richer HTTP input, such as
the current page, into these messages or author its own Workflow with the reusable Steps.

Resources and definitions can be reused across requests. Mutable state, channels and ToolRuntime
instances cannot: `createOutputSink()` must create one channel for each Run. Shared adapters and
Actors remain borrowed. Hosts must wait for active Runs before releasing their own resources.

## Steps and customization

```text
runRequest
├── prepareRequest
│   ├── validateRequest
│   ├── resolveExecutionTarget
│   ├── resolveInstructions
│   ├── gatherExternalContext       optional; default SKIP_STEP
│   ├── buildTools                  Interaction only
│   └── buildModelContext
└── executeRequest
    ├── openResponseStream
    ├── invokeModel                 selected once at assembly
    │   └── dispatchModelEvent
    │       ├── deliverTextDelta
    │       └── deliverReasoningDelta   optional; installed by default
    ├── buildResponse
    ├── validateResponse            optional; default SKIP_STEP
    └── completeResponse
```

Override through `stepOverrides`, including ordinary structured cardinality overrides and allowed
`SKIP_STEP` values. Preparation/call/response Steps are at-most-once; event dispatch and delta
delivery are repeatable. Same-name overlap remains prohibited. There is no automatic retry.

`gatherExternalContext` may populate `context.state.externalContext` with Core messages. They are
inserted after supplied history and before the current user message. They are not silently promoted
to instructions. `validateResponse` inspects the completed `context.state.response` before output
close; applications can validate JSON and allowed references there without another model call.
Already delivered text cannot be rolled back if final application validation fails.

Actor instructions remain Actor-owned. This Workflow composes only its instruction contributors;
explicit Responsibility routing can be installed through Step replacement using the existing router
and its invocation facade, without a second registry or fabricated identity.

Shared instructions, delta delivery, interaction request assembly, tool preparation and invocation
use minimum Context contracts. Session-specific Steps, output metadata, tracing and commit behavior
remain separate. Replacing a full Composite transfers its execution/drainage responsibilities to the
replacement. Guaranteed cleanup is lifecycle machinery, not a skippable Step.

## Streaming and output lifecycle

`resources.createOutputSink({ request, workflowRunId, signal })` may return a channel synchronously
or asynchronously. It exposes `open({ workflowRunId })`, awaited `write(OutputStreamEvent)`,
`close(result)` and `fail({ code, message })`, without Agent/Session identifiers. A channel must also
handle preparation/open failure. `fail` is best effort and may itself fail; primary and cleanup
errors remain observable rather than hiding the original failure.

Output outcome and Run outcome are separate. After `close()` fulfills, the channel is terminal:
cancellation during that call or a subsequent lifecycle-hook failure can still reject the Run,
but cannot publish `fail()` to the already completed channel. `state.outputOutcome` records `closed`
or `failure-attempted`; failure publication is best effort, not proof that the receiver accepted it.
A rejected `close()` has not established successful closure and is followed by a failure attempt.

Without a channel, buffered and Interaction profiles can simply return their result. A stream
profile can also collect its full result without publishing live events. `direct` never fabricates
incremental delivery; an installed channel receives open/close but no generated deltas in that mode.

Text and readable reasoning are separate named event types. Interaction publishes final-answer
text and reasoning across model turns. Reasoning is neither assistant final text nor automatically
saved/reinserted history. Skipping reasoning delivery does not bypass its budget. No presentation
store or partial-failure persistence is installed.

Actor owns model event normalization and terminal/result consistency. Request owns accepted
delivery, bounded pending work, backpressure, failure containment and drainage before terminal
cleanup. Protocol events are not duplicated into a new Workflow-specific model protocol.

## Interaction permissions

```ts
const workflow = createSessionlessRequestWorkflow({
  mode: 'interaction',
  resources: {
    actor,
    policy: { maxModelTurns: 3 },
    tools: {
      registry,
      permissionPolicy: {
        responsibility: ['lookup'],
        actor: ['lookup'],
        product: ['lookup'],
        runtime: ['lookup'],
      },
    },
  },
});
```

A direct-bound Core Actor does not declare Agent Base tool permissions. The host explicitly supplies
the four policy scopes; capability is not authorization. When using a resolved Responsibility,
derive its scopes from that authoritative binding rather than replacing them with broad lists.
Omitted permission is deny-all. Omitted tools selects a real empty registry/Broker, not an unsupported
placeholder. Generation resources do not accept tool configuration or model-turn limits.

Tool schemas, policy intersection, argument/result limits, cancellation, handler-error recovery,
terminal port rejection and per-call identity remain owned by `base-tool`. The shared Request
invocation boundary serializes admitted Tool calls and latches the first terminal rejection, even
if a custom Engine catches or ignores it. Queued calls cannot start handlers after that failure;
returned `handler-error` outcomes remain recoverable. The Workflow does not duplicate the model/tool
loop or guarantee exactly-once external side effects.

Before publishing the terminal assistant event, Request closes Tool admission and waits for all
admitted calls to settle. This also protects Session-aware terminal commits. On Engine/delivery/Tool
failure, cancellation propagates to active work and drainage precedes failure cleanup. An Engine
returning early cannot leave background handlers behind or produce an incomplete `toolRun` result.
ToolRuntime disposal remains with its creator; neither the Actor nor this borrowed port closes it.

## Limits, deadlines and observation

Generation defaults are exported as `DEFAULT_SESSIONLESS_GENERATION_POLICY`; Interaction adds
`maxModelTurns` through `DEFAULT_SESSIONLESS_INTERACTION_POLICY`. Closed policy overrides accept
positive safe integers. Context budgets cover initial supplied/external/current-message text and
message count, not model-specific request tokenization, tool-loop growth or billing. The current
user message counts toward `maxContextMessages`.

Use Core Workflow `onEvent`, `parentRunId` and `classifyFailure` for observation. No fake Agent Run or
Session trace identity is produced. Output/prompt/history content is not automatically copied into
observation. Hosts own additional content logging and its privacy policy.

The Workflow adds no default deadline. For a whole-call boundary, wrap `.run()` with
`runWithExecutionTimeout()` from `@print-an-agent/workflow-core`, pass its effective signal to `.run()` and
provide an owner-specific timeout failure factory when enabling a deadline. `null` adds no timer but
preserves cancellation. Actor invocation and provider transport deadlines remain independent;
child timeout failures are not relabeled as the host's timeout.

Cancellation is cooperative. Already-running sink calls without cancellation support must settle;
arbitrary JS cannot be forcibly killed, output cannot be recalled and tool effects are not rolled
back. Invalid provider/Actor results, budget excess and known call failures retain their stable
error identities. Output failures use `REQUEST_OUTPUT_FAILED`; safe failure events do not include
raw exception messages.

## Public consumer evidence

The compiled [website consumer](../../../tests/integration/test/consumers/website-assistant.ts)
demonstrates product-owned JSON and route validation over a direct Workflow. It uses a fixed page
catalog and does not execute generated markup or navigate to arbitrary URLs. Provider-native schema
generation is not implied; the current Pi Engine still declares `structuredOutput: false`.

Public package integration tests exercise direct, streaming and bounded tool-loop consumers without
creating an Agent/Session. More detailed request tests cover cancellation, output failure, drainage,
profile separation, limits, concurrent Runs and Step replacement.

## Source ownership

`sessionless/create-workflow.ts` dispatches once by mode. `generation/create-workflow.ts` owns the
direct/stream graph; `interaction/create-workflow.ts` owns the Tool-enabled graph. Each profile
exposes its constructor and contracts through its own named entry. Shared configuration, context
normalization, resource binding, policy, output and execution cleanup live in the parent scope.
Independent contracts live in `sessionless/types/`; profile-specific Workflow options and state
stay with their profile. The existing public Generation resource and policy names identify the
shared contracts for compatibility; internal neutral aliases refer to those same declarations.

Shared Request preparation, interaction and output capabilities consume narrow Context contracts.
They do not import either profile's state or Session-aware implementations. The
[package source layout](../README.md#source-layout) describes the enclosing boundaries.

import type {
  CompletionCapability,
  StreamingCapability,
  InteractionTools,
} from '../../src/index.js';

function completionConsumer(actor: CompletionCapability): void {
  // @ts-expect-error A Completion consumer has no interaction dependency.
  void actor.interact;
}

function toolConsumer(tools: InteractionTools): void {
  // @ts-expect-error Borrowed tool execution carries no disposal authority.
  void tools.close;
}

void completionConsumer;
void toolConsumer;

function streamingConsumer(actor: StreamingCapability): void {
  // @ts-expect-error Streaming does not require buffered Completion support.
  void actor.complete;
}
void streamingConsumer;

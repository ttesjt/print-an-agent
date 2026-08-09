import {
  MemoryOutputSink,
  type AgentResponse,
  type OutputFailure,
  type OutputTextDeltaEvent,
} from '@ta-agent/base-request';

export class CancellingOutputSink extends MemoryOutputSink {
  readonly #controller: AbortController;

  constructor(controller: AbortController) {
    super();
    this.#controller = controller;
  }

  override async write(event: OutputTextDeltaEvent): Promise<void> {
    await super.write(event);
    this.#controller.abort();
  }
}

export class FailingCloseOutputSink extends MemoryOutputSink {
  override close(_response: AgentResponse): Promise<void> {
    return Promise.reject(new Error('close failed'));
  }
}

export class FailingWriteOutputSink extends MemoryOutputSink {
  override write(_event: OutputTextDeltaEvent): Promise<void> {
    return Promise.reject(new Error('write failed'));
  }
}

export class FailingFailureOutputSink extends MemoryOutputSink {
  override fail(_failure: OutputFailure): Promise<void> {
    return Promise.reject(new Error('fail failed'));
  }
}

export class LifecycleRecordingOutputSink extends MemoryOutputSink {
  readonly calls: string[] = [];

  override async open(...parameters: Parameters<MemoryOutputSink['open']>): Promise<void> {
    this.calls.push('open');
    await super.open(...parameters);
  }

  override async write(...parameters: Parameters<MemoryOutputSink['write']>): Promise<void> {
    this.calls.push('write');
    await super.write(...parameters);
  }

  override async close(...parameters: Parameters<MemoryOutputSink['close']>): Promise<void> {
    this.calls.push('close');
    await super.close(...parameters);
  }

  override async fail(...parameters: Parameters<MemoryOutputSink['fail']>): Promise<void> {
    this.calls.push('fail');
    await super.fail(...parameters);
  }
}

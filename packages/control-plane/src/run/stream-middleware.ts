export interface StreamEvent {
  type: string;
  data: unknown;
  seq: number;
  timestamp: number;
}

export type StreamMiddleware = (event: StreamEvent, next: () => Promise<void>) => Promise<void>;

export function createIncrementalSave(
  save: (event: StreamEvent) => Promise<void>,
  batchSize = 10
): StreamMiddleware {
  let buffer: StreamEvent[] = [];

  return async (event, next) => {
    buffer.push(event);
    if (buffer.length >= batchSize || event.type === 'done' || event.type === 'error') {
      const batch = buffer;
      buffer = [];
      for (const e of batch) {
        await save(e);
      }
    }
    await next();
  };
}

export function createErrorHandler(
  onError: (error: Error, event: StreamEvent) => void
): StreamMiddleware {
  return async (event, next) => {
    try {
      await next();
    } catch (error) {
      onError(error instanceof Error ? error : new Error(String(error)), event);
    }
  };
}

export function createStreamLogger(
  log: (msg: string, data?: Record<string, unknown>) => void
): StreamMiddleware {
  let chunkCount = 0;
  let lastChunkAt = Date.now();

  return async (event, next) => {
    chunkCount++;
    const now = Date.now();
    const gap = now - lastChunkAt;
    lastChunkAt = now;

    if (gap > 60_000) {
      log('Stream chunk gap > 60s', { gap, chunkCount, eventType: event.type });
    }

    if (event.type === 'done') {
      log('Stream completed', { chunkCount, eventType: event.type });
    }

    await next();
  };
}

export class StreamPipeline {
  private middlewares: StreamMiddleware[] = [];

  use(middleware: StreamMiddleware): this {
    this.middlewares.push(middleware);
    return this;
  }

  async process(event: StreamEvent): Promise<void> {
    let index = 0;
    const next = async (): Promise<void> => {
      if (index < this.middlewares.length) {
        const mw = this.middlewares[index++];
        await mw(event, next);
      }
    };
    await next();
  }
}

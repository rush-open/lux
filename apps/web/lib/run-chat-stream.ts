/**
 * Client helpers for GET /api/runs/[id]/stream (SSE: id + data lines).
 */

export interface RunStreamEvent {
  seq: number;
  /** Parsed JSON from `data:` line; literal [DONE] yields null with done true */
  payload: unknown;
  done: boolean;
}

function parseSseBlocks(buffer: string): { blocks: string[]; rest: string } {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  return { blocks: parts.filter(Boolean), rest };
}

/**
 * Incrementally parse an SSE body and yield structured events.
 */
export async function* readRunSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<RunStreamEvent> {
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
    const { blocks, rest } = parseSseBlocks(buffer);
    buffer = rest;

    for (const block of blocks) {
      let seq = 0;
      let dataLine: string | undefined;
      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) {
          seq = Number.parseInt(line.slice(4), 10);
        } else if (line.startsWith('data: ')) {
          dataLine = line.slice(6);
        }
      }
      if (dataLine === undefined) continue;
      if (dataLine === '[DONE]') {
        yield { seq, payload: null, done: true };
        continue;
      }
      try {
        const payload = JSON.parse(dataLine) as unknown;
        yield { seq, payload, done: false };
      } catch {
        /* skip malformed */
      }
    }
  }
}

/** Apply one UI message stream chunk to plain assistant text (MVP). */
export function applyAssistantTextChunk(prev: string, payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return prev;
  const p = payload as Record<string, unknown>;
  if (p.type === 'text-delta') {
    const piece = String(p.delta ?? p.textDelta ?? p.text ?? p.content ?? '');
    return prev + piece;
  }
  if (p.type === 'reasoning-delta') {
    const piece = String(p.text ?? p.delta ?? p.textDelta ?? '');
    return prev + piece;
  }
  return prev;
}

/** Check if a stream event is an error event from a failed run. */
export function isStreamError(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (p.type === 'error' && typeof p.error === 'string') {
    return p.error;
  }
  return null;
}

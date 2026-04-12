import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'agent-worker', timestamp: new Date().toISOString() });
});

app.get('/status', (c) => {
  return c.json({ ready: true, activeRuns: 0 });
});

app.post('/prompt', async (c) => {
  const body = await c.req.json();
  const { prompt, sessionId, env } = body;

  if (!prompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  // TODO: Execute Claude Code CLI with the prompt
  // For now, return a placeholder SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({ type: 'text', content: 'Agent response placeholder' })}\n\n`
        )
      );
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    },
  });
});

app.post('/abort', (c) => {
  return c.json({ aborted: true });
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent worker listening on http://localhost:${info.port}`);
});

export default app;

import { DrizzleRunDb, isTerminal, RunService } from '@open-rush/control-plane';
import { agents, getDbClient, runEvents } from '@open-rush/db';
import { and, eq, gt } from 'drizzle-orm';

import { apiError, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

/** Maximum SSE connection lifetime (5 minutes) */
const SSE_MAX_LIFETIME_MS = 5 * 60 * 1000;

/** Poll interval for new events */
const POLL_INTERVAL_MS = 500;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: runId } = await params;
  const lastEventId = request.headers.get('Last-Event-ID');
  const parsedSeq = lastEventId ? Number.parseInt(lastEventId, 10) : Number.NaN;
  const afterSeq = Number.isNaN(parsedSeq) ? -1 : parsedSeq;

  // Look up the Run
  const db = getDbClient();
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const run = await runService.getById(runId);

  if (!run) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }

  // Verify user has access to the run's project
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!agent) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }
  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this run');
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let currentSeq = afterSeq;
      let closed = false;
      let timer: ReturnType<typeof setInterval> | null = null;
      let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;

      const emit = (text: string) => {
        if (closed) return;
        controller.enqueue(encoder.encode(text));
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
        if (lifetimeTimer) {
          clearTimeout(lifetimeTimer);
          lifetimeTimer = null;
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      let polling = false;
      const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
          // Fetch new events since currentSeq
          const events = await db
            .select()
            .from(runEvents)
            .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, currentSeq)))
            .orderBy(runEvents.seq);

          for (const event of events) {
            const data = JSON.stringify(event.payload);
            emit(`id: ${event.seq}\ndata: ${data}\n\n`);
            currentSeq = event.seq;
          }

          // Check if run has reached terminal state
          const currentRun = await runService.getById(runId);
          if (currentRun && isTerminal(currentRun.status)) {
            // Emit error info for failed runs
            if (currentRun.status === 'failed' && currentRun.errorMessage) {
              const errPayload = JSON.stringify({
                type: 'error',
                error: currentRun.errorMessage,
              });
              emit(`data: ${errPayload}\n\n`);
            }
            emit('data: [DONE]\n\n');
            cleanup();
          }
        } catch (err) {
          emit(`data: ${JSON.stringify({ type: 'error', error: String(err) })}\n\n`);
          emit('data: [DONE]\n\n');
          cleanup();
        } finally {
          polling = false;
        }
      };

      // Push-based: poll on interval (works with proxies that buffer pull-based streams)
      timer = setInterval(() => {
        void poll();
      }, POLL_INTERVAL_MS);

      // Close after max lifetime
      lifetimeTimer = setTimeout(() => {
        emit('data: [DONE]\n\n');
        cleanup();
      }, SSE_MAX_LIFETIME_MS);

      // Abort when client disconnects
      request.signal.addEventListener('abort', () => {
        cleanup();
      });

      // First poll immediately
      void poll();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

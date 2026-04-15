import { DrizzleRunDb, isTerminal, RunService } from '@open-rush/control-plane';
import { agents, getDbClient } from '@open-rush/db';
import { eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

/**
 * Best-effort abort: tells the agent-worker to abort the session (sessionId === runId).
 * The control-worker run may still transition via orchestrator error handling.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: runId } = await params;
  const db = getDbClient();
  const runService = new RunService(new DrizzleRunDb(db));
  const run = await runService.getById(runId);
  if (!run) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }

  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId)).limit(1);
  if (!agent) {
    return apiError(404, 'RUN_NOT_FOUND', `Run ${runId} not found`);
  }
  const hasAccess = await verifyProjectAccess(agent.projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this run');
  }

  if (isTerminal(run.status)) {
    return apiSuccess({ aborted: false, reason: 'already_terminal' });
  }

  const base =
    process.env.AGENT_WORKER_URL?.trim() ||
    process.env.DEV_AGENT_WORKER_URL?.trim() ||
    'http://127.0.0.1:8787';

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: runId }),
      signal: AbortSignal.timeout(10_000),
    });
    const ok = res.ok;
    return apiSuccess({ aborted: ok, status: res.status });
  } catch {
    return apiSuccess({ aborted: false, reason: 'agent_unreachable' });
  }
}

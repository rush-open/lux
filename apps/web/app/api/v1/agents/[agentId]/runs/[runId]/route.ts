/**
 * /api/v1/agents/:agentId/runs/:runId
 *   - GET — return a single Run
 *
 * Auth: session OR service-token with scope `runs:read`. See
 * specs/service-token-auth.md.
 *
 * Ownership: we load the run, look up its owning task, verify the task
 * belongs to the agentId in the URL, then verify project access. Cross-
 * agent probing (a valid runId under a different agentId) returns 404
 * without leaking the actual owning agent.
 */

import { v1 } from '@open-rush/contracts';
import { DrizzleRunDb, RunService } from '@open-rush/control-plane';
import { getDbClient, tasks } from '@open-rush/db';
import { eq } from 'drizzle-orm';
import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { runToV1 } from '../helpers';

// -----------------------------------------------------------------------------
// GET /api/v1/agents/:agentId/runs/:runId
// -----------------------------------------------------------------------------

export async function GET(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'runs:read')) {
    return v1Error('FORBIDDEN', 'Missing scope runs:read');
  }

  const awaitedParams = await params;
  const paramsParsed = v1.getRunParamsSchema.safeParse({
    id: awaitedParams.agentId,
    runId: awaitedParams.runId,
  });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const db = getDbClient();
  const runService = new RunService(new DrizzleRunDb(db));
  const run = await runService.getById(paramsParsed.data.runId);
  if (!run) return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);

  // The run must actually belong to the agent in the URL — prevents
  // cross-agent info leak.
  if (run.taskId !== paramsParsed.data.id) {
    return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);
  }

  // Pull the owning task to resolve project access.
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, paramsParsed.data.id))
    .limit(1);
  if (!task) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);
  if (!(await verifyProjectAccess(task.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  // Symmetric with list/cancel: a user-cancelled run persists as
  // `status='failed' + errorMessage='cancelled by user'`. Surface the
  // wire-level virtual status so the single-run GET matches what
  // clients just saw from POST /cancel.
  const isUserCancelled =
    run.status === 'failed' && !!run.errorMessage?.startsWith('cancelled by user');
  return v1Success(
    runToV1(run, {
      apiAgentId: paramsParsed.data.id,
      statusOverride: isUserCancelled ? 'cancelled' : undefined,
    })
  );
}

/**
 * /api/v1/agents/:agentId/runs/:runId/cancel
 *   - POST — cancel a Run. Response maps the service-layer
 *            `status='failed' + errorMessage='cancelled by user'`
 *            transition back to `status: 'cancelled'` (spec §E2E 3.5).
 *
 * Auth: session OR service-token with scope `runs:cancel`.
 *
 * Error mapping:
 * - Run not found / wrong agent → 404
 * - Run already terminal (`completed` / `failed` / `finalized`) → 200
 *   with the existing run reshaped to `status: 'cancelled'`. Cancel is
 *   idempotent per spec: callers who double-tap the button should see a
 *   consistent result.
 * - Run in `finalizing_retryable_failed` → 400 VALIDATION_ERROR + retry
 *   hint (same rationale as the Agent DELETE path — 409 reserved for
 *   version/idempotency conflicts).
 */

import { v1 } from '@open-rush/contracts';
import { DrizzleRunDb, RunAlreadyTerminalError, RunService } from '@open-rush/control-plane';
import { getDbClient, tasks } from '@open-rush/db';
import { eq } from 'drizzle-orm';
import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { mapRunServiceError, runToV1 } from '../../helpers';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agentId: string; runId: string }> }
) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'runs:cancel')) {
    return v1Error('FORBIDDEN', 'Missing scope runs:cancel');
  }

  const awaitedParams = await params;
  const paramsParsed = v1.getRunParamsSchema.safeParse({
    id: awaitedParams.agentId,
    runId: awaitedParams.runId,
  });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const db = getDbClient();
  const runService = new RunService(new DrizzleRunDb(db));

  // Pre-flight: ensure the run exists AND belongs to the agent in the
  // URL AND the caller can access the owning project. Doing this
  // upfront means the 404 / 403 branches don't reach the cancel state
  // machine.
  const run = await runService.getById(paramsParsed.data.runId);
  if (!run) return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);
  if (run.taskId !== paramsParsed.data.id) {
    return v1Error('NOT_FOUND', `Run ${paramsParsed.data.runId} not found`);
  }
  const [task] = await db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, paramsParsed.data.id))
    .limit(1);
  if (!task) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);
  if (!(await verifyProjectAccess(task.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  try {
    const cancelled = await runService.cancelRun(paramsParsed.data.runId);
    // Successful transition: service set status='failed' + errorMessage
    // = 'cancelled by user'. Override the wire status to 'cancelled'
    // so the API stays consistent with spec §E2E 3.5.
    return v1Success(
      runToV1(cancelled, { apiAgentId: paramsParsed.data.id, statusOverride: 'cancelled' })
    );
  } catch (err) {
    if (err instanceof RunAlreadyTerminalError) {
      // Idempotent: return the existing run reshaped as 'cancelled'.
      // Reload defensively in case the original `run` shape has drifted
      // between the pre-flight load and this branch.
      const current = (await runService.getById(paramsParsed.data.runId)) ?? run;
      return v1Success(
        runToV1(current, { apiAgentId: paramsParsed.data.id, statusOverride: 'cancelled' })
      );
    }
    const mapped = mapRunServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
}

/**
 * /api/v1/agents/:agentId/runs
 *   - POST — create a Run (optionally Idempotency-Key-gated)
 *   - GET  — list Runs for the Agent (cursor-paginated)
 *
 * Auth: session OR service-token with scope `runs:write` (POST) /
 *       `runs:read` (GET). See specs/service-token-auth.md.
 *
 * Agent ownership + status guard:
 *   - We load the `tasks` row first, then verify project access. This
 *     avoids leaking 404/403 contrast to callers poking at ids they
 *     don't own.
 *   - POST on an already-terminal Agent (status='completed' | 'cancelled')
 *     is rejected with 409 VERSION_CONFLICT per spec §E2E: "已完成/已取消
 *     Agent 禁止新 run".
 *
 * Idempotency (POST):
 *   - `Idempotency-Key` header is OPTIONAL.
 *   - Value must pass `idempotencyKeyHeaderSchema` (URL-safe ASCII ≤160).
 *     The 160-char cap reflects the double-scoped storage budget: the
 *     route prepends `task:<uuid>|` (42 chars) and the service prepends
 *     `agent:<uuid>|` (43 chars) before landing in
 *     `runs.idempotency_key varchar(255)`.
 *   - Body hash (SHA-256 canonical JSON) + agent-scoped key persisted via
 *     RunService.createRunWithIdempotency. Same key + same body → replay;
 *     same key + different body → 409 IDEMPOTENCY_CONFLICT; no key →
 *     plain createRun.
 */

import { v1 } from '@open-rush/contracts';
import type { RunStatus } from '@open-rush/control-plane';
import { computeIdempotencyHash, DrizzleRunDb, RunService } from '@open-rush/control-plane';
import { getDbClient, runs, tasks } from '@open-rush/db';
import { and, desc, eq, isNull, like, lt, not, or, sql } from 'drizzle-orm';
import { v1Error, v1Paginated, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { decodeRunCursor, encodeRunCursor, mapRunServiceError, runToV1 } from './helpers';

// -----------------------------------------------------------------------------
// POST /api/v1/agents/:agentId/runs
// -----------------------------------------------------------------------------

export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'runs:write')) {
    return v1Error('FORBIDDEN', 'Missing scope runs:write');
  }

  const { agentId } = await params;
  const paramsParsed = v1.getAgentParamsSchema.safeParse({ id: agentId });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return v1Error('VALIDATION_ERROR', 'Invalid JSON body');
  }

  const bodyParsed = v1.createRunRequestSchema.safeParse(body);
  if (!bodyParsed.success) return v1ValidationError(bodyParsed.error);

  // Optional Idempotency-Key header. Header names are case-insensitive
  // per RFC 7230 §3.2 — Next.js's Request already normalises but we
  // probe both to be safe.
  //
  // Scope discipline: we need the idempotency window to be *per-Agent*
  // (= per-tasks.id), NOT per-AgentDefinition. The service layer's
  // `scopeIdempotencyKey` scopes by its own `input.agentId` argument
  // (docs: "Stripe/Anthropic-style credential-scoped idempotency"), and
  // we pass the AgentDefinition id through as `input.agentId` further
  // down. To keep two different API-layer Agents backed by the same
  // AgentDefinition from colliding on the same user-provided key, we
  // prefix the client key with the task id. Future service-layer
  // refactor can collapse this once `RunService` grows a `taskId`-
  // aware scope override.
  const rawIdempotencyHeader =
    request.headers.get('idempotency-key') ?? request.headers.get('Idempotency-Key');
  let idempotency: { key: string; requestHash: string } | undefined;
  let rawClientKey: string | null = null;
  if (rawIdempotencyHeader !== null) {
    const keyParsed = v1.idempotencyKeyHeaderSchema.safeParse(rawIdempotencyHeader);
    if (!keyParsed.success) return v1ValidationError(keyParsed.error);
    rawClientKey = keyParsed.data;
    // `computeIdempotencyHash` feeds the parsed body (not the raw
    // text) through `canonicalJsonStringify` so `{a:1,b:2}` and
    // `{b:2,a:1}` collapse to the same hash — clients don't need to
    // worry about key ordering.
    idempotency = {
      // Task-scoped key placeholder — actual value is set after we've
      // loaded the task row below (we need `task.id` first).
      key: '',
      requestHash: computeIdempotencyHash(bodyParsed.data),
    };
  }

  const db = getDbClient();
  const task = await loadTaskById(db, paramsParsed.data.id);
  if (!task) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);

  if (!(await verifyProjectAccess(task.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  // Agent-level status guard (spec §E2E: completed/cancelled Agents
  // cannot take new runs). VERSION_CONFLICT (409) is the closest v1
  // ErrorCode: the request is well-formed but the resource state
  // conflicts.
  if (task.status === 'completed' || task.status === 'cancelled') {
    return v1Error('VERSION_CONFLICT', `Agent is in terminal state '${task.status}'`, {
      hint: `create a new Agent instead of appending to a ${task.status} one`,
    });
  }

  // Agent must have a backing AgentDefinition (otherwise the run can't
  // resolve a provider / model). Missing this is a server-side drift
  // condition; surface as 500 so it shows up in alerts.
  if (!task.agentId) {
    throw new Error(`Agent ${task.id} has no backing AgentDefinition`);
  }
  if (task.definitionVersion == null) {
    // task-11 guarantees new rows have a frozen version. Legacy pre-
    // migration rows may be null — reject so we don't drift an unbound
    // run.
    return v1Error('VALIDATION_ERROR', 'Agent has no bound AgentDefinition version', {
      hint: 'recreate the Agent via POST /api/v1/agents',
    });
  }

  const runService = new RunService(new DrizzleRunDb(db));

  // Finalise the idempotency scope now that we know `task.id`.
  if (idempotency && rawClientKey !== null) {
    idempotency.key = `task:${task.id}|${rawClientKey}`;
  }

  let created: Awaited<ReturnType<typeof runService.createRun>>;
  try {
    created = await runService.createRunWithIdempotency(
      {
        agentId: task.agentId,
        prompt: bodyParsed.data.input,
        taskId: task.id,
        agentDefinitionVersion: task.definitionVersion,
        parentRunId: bodyParsed.data.parentRunId,
        modelId: bodyParsed.data.modelId,
        triggerSource: 'user',
      },
      idempotency
    );
  } catch (err) {
    const mapped = mapRunServiceError(err);
    if (mapped) return mapped;
    throw err;
  }

  // Fail-closed safety net: if a replay ever returned a run belonging
  // to a DIFFERENT task (shouldn't happen with the task-scoped key
  // above, but keep the invariant enforced at the API boundary), we
  // refuse to respond rather than leak a foreign run. 500 so it shows
  // up in alerting.
  if (created.taskId !== null && created.taskId !== task.id) {
    throw new Error(
      `idempotency replay crossed task boundary: returned run.taskId=${created.taskId} != request task.id=${task.id}`
    );
  }

  const wire = runToV1(created, { apiAgentId: task.id });
  return v1Success(wire, 201);
}

// -----------------------------------------------------------------------------
// GET /api/v1/agents/:agentId/runs
// -----------------------------------------------------------------------------

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'runs:read')) {
    return v1Error('FORBIDDEN', 'Missing scope runs:read');
  }

  const { agentId } = await params;
  const paramsParsed = v1.getAgentParamsSchema.safeParse({ id: agentId });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const url = new URL(request.url);
  const queryParsed = v1.listRunsQuerySchema.safeParse({
    status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!queryParsed.success) return v1ValidationError(queryParsed.error);

  const db = getDbClient();
  const task = await loadTaskById(db, paramsParsed.data.id);
  if (!task) return v1Error('NOT_FOUND', `Agent ${paramsParsed.data.id} not found`);

  if (!(await verifyProjectAccess(task.projectId, auth.userId))) {
    return v1Error('FORBIDDEN', 'No access to this project');
  }

  const limit = queryParsed.data.limit;
  const cursor = decodeRunCursor(queryParsed.data.cursor);

  const filters = [eq(runs.taskId, task.id)];
  if (queryParsed.data.status === 'cancelled') {
    // Wire-level `cancelled` is a virtual status: service-layer rows
    // carry `status='failed'` with `errorMessage='cancelled by user'`.
    // We map the filter onto that shape so the response is symmetric
    // with the single-run GET (which also surfaces `status='cancelled'`
    // on the override branch after cancel).
    filters.push(eq(runs.status, 'failed'));
    filters.push(like(runs.errorMessage, 'cancelled by user%'));
  } else if (queryParsed.data.status === 'failed') {
    // `failed` and `cancelled` must be mutually exclusive on the wire.
    // Without this exclusion, a user-cancelled run (DB: status='failed'
    // + errorMessage='cancelled by user') would leak into the failed
    // bucket AND then get re-stamped `status='cancelled'` in the
    // response → caller sees `GET ?status=failed` returning rows with
    // status='cancelled', which breaks every filter invariant.
    filters.push(eq(runs.status, 'failed'));
    filters.push(
      or(isNull(runs.errorMessage), not(like(runs.errorMessage, 'cancelled by user%'))) as never
    );
  } else if (queryParsed.data.status) {
    filters.push(eq(runs.status, queryParsed.data.status));
  }
  if (cursor) {
    filters.push(
      or(
        sql`date_trunc('milliseconds', ${runs.createdAt}) < ${cursor.createdAt}`,
        and(
          sql`date_trunc('milliseconds', ${runs.createdAt}) = ${cursor.createdAt}`,
          lt(runs.id, cursor.id)
        )
      ) as never
    );
  }

  const rows = await db
    .select()
    .from(runs)
    .where(and(...filters))
    .orderBy(sql`date_trunc('milliseconds', ${runs.createdAt}) DESC`, desc(runs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const items: v1.Run[] = page.map((r) => {
    // Virtual `cancelled` status on the wire mirrors the cancel-route
    // override (spec §E2E 3.5): a user-initiated cancel lives in the
    // DB as `status='failed' + errorMessage='cancelled by user'`.
    const isUserCancelled =
      r.status === 'failed' && !!r.errorMessage?.startsWith('cancelled by user');
    return runToV1(
      {
        id: r.id,
        agentId: r.agentId,
        taskId: r.taskId,
        conversationId: r.conversationId,
        parentRunId: r.parentRunId,
        status: r.status as RunStatus,
        prompt: r.prompt,
        provider: r.provider,
        connectionMode: r.connectionMode,
        modelId: r.modelId,
        triggerSource: r.triggerSource,
        agentDefinitionVersion: r.agentDefinitionVersion,
        idempotencyKey: r.idempotencyKey,
        idempotencyRequestHash: r.idempotencyRequestHash,
        activeStreamId: r.activeStreamId,
        retryCount: r.retryCount,
        maxRetries: r.maxRetries,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
      },
      {
        apiAgentId: task.id,
        statusOverride: isUserCancelled ? 'cancelled' : undefined,
      }
    );
  });

  const last = page[page.length - 1];
  const nextCursor = hasMore && last ? encodeRunCursor(last.createdAt, last.id) : null;
  return v1Paginated(items, nextCursor);
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface TaskLike {
  id: string;
  projectId: string;
  agentId: string | null;
  status: string;
  definitionVersion: number | null;
}

async function loadTaskById(
  db: ReturnType<typeof getDbClient>,
  id: string
): Promise<TaskLike | null> {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      agentId: tasks.agentId,
      status: tasks.status,
      definitionVersion: tasks.definitionVersion,
    })
    .from(tasks)
    .where(eq(tasks.id, id))
    .limit(1);
  return row ?? null;
}

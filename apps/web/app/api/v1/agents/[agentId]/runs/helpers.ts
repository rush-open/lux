/**
 * Shared helpers for `/api/v1/agents/:agentId/runs/*` route files.
 *
 * - {@link runToV1} maps the service-layer `Run` (native Dates) to the
 *   v1 `runSchema` wire shape (ISO strings, idempotency columns stripped).
 * - {@link mapRunServiceError} translates RunService / idempotency domain
 *   errors into v1 Response envelopes.
 */

import type { v1 } from '@open-rush/contracts';
import {
  IdempotencyConflictError,
  type Run,
  RunAlreadyTerminalError,
  RunCannotCancelError,
  RunNotFoundError,
} from '@open-rush/control-plane';

import { v1Error } from '@/lib/api/v1-responses';

/**
 * Map the service `Run` → v1 wire shape.
 *
 * Notes:
 * - `agentId` in v1 = API-layer agent id = DB `tasks.id`. We source it
 *   from `run.taskId` (the service populates this from the route param).
 *   If the run has no taskId (legacy / internal orchestrator-created
 *   runs), we fall back to `run.agentId` (= DB `agents.id`) so the
 *   response stays non-null, but that case shouldn't reach this
 *   endpoint.
 * - `idempotencyKey` / `idempotencyRequestHash` are deliberately not
 *   surfaced — those are internal correlation metadata, not part of the
 *   public contract.
 * - `attachmentsJson` isn't exposed either (v1.runSchema omits it).
 * - `statusOverride` lets the cancel route override the status field to
 *   `'cancelled'` even though the run row stores `status='failed'`
 *   (spec §E2E 3.5 — v0.1 has no dedicated cancelled status on the
 *   state machine, so we fake it at the API boundary).
 */
export function runToV1(
  run: Run,
  options: { apiAgentId: string; statusOverride?: string }
): v1.Run {
  const { apiAgentId, statusOverride } = options;
  return {
    id: run.id,
    agentId: apiAgentId,
    taskId: run.taskId,
    conversationId: run.conversationId,
    parentRunId: run.parentRunId,
    status: (statusOverride ?? run.status) as v1.Run['status'],
    prompt: run.prompt,
    provider: run.provider,
    connectionMode: run.connectionMode as v1.Run['connectionMode'],
    modelId: run.modelId,
    triggerSource: run.triggerSource as v1.Run['triggerSource'],
    agentDefinitionVersion: run.agentDefinitionVersion,
    retryCount: run.retryCount,
    maxRetries: run.maxRetries,
    errorMessage: run.errorMessage,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
  };
}

/**
 * Translate a RunService error to a v1 error Response. Returns `null`
 * when the error is NOT a known domain error — the route rethrows so the
 * Next.js runtime surfaces a 500.
 *
 * Convention for the cancel path (`specs/managed-agents-api.md §E2E
 * 3.5`):
 * - Already-terminal → the route handles this specially (200 with the
 *   existing run reshaped to status='cancelled'), not via this helper.
 *   The helper returns `null` so the caller can fall through to that
 *   branch.
 */
export function mapRunServiceError(err: unknown): Response | null {
  if (err instanceof IdempotencyConflictError) {
    return v1Error('IDEMPOTENCY_CONFLICT', err.message, {
      hint: 'same Idempotency-Key was used with a different request body within 24h',
    });
  }
  if (err instanceof RunCannotCancelError) {
    return v1Error('VALIDATION_ERROR', `Run cannot be cancelled from status '${err.status}'`, {
      hint: 'wait for the retry / timeout flow to resolve and retry cancel',
    });
  }
  if (err instanceof RunNotFoundError) {
    return v1Error('NOT_FOUND', err.message);
  }
  // RunAlreadyTerminalError is NOT handled here — callers decide.
  if (err instanceof RunAlreadyTerminalError) return null;
  return null;
}

/**
 * Opaque cursor for `GET /api/v1/agents/:agentId/runs`. Same shape as
 * the agents / agent-definitions cursors for uniformity:
 * `base64url("<createdAtISO>|<id>")`. Malformed cursors decode to
 * `null`; the handler then treats them as "first page".
 */
export function encodeRunCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, 'utf8').toString('base64url');
}

// UUID shape check before handing `id` into a `uuid` column comparison.
// Postgres rejects a non-UUID literal with a 22P02 typecheck error and
// surfaces as a 500 — an attacker crafting a malicious cursor (e.g.
// `base64url("2024|not-uuid")`) can force that path. We silently drop
// non-UUID cursor ids (→ null, treated as "first page").
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeRunCursor(
  cursor: string | undefined
): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = raw.indexOf('|');
    if (sep < 0) return null;
    const iso = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    if (!iso || !id) return null;
    if (!UUID_RE.test(id)) return null;
    const createdAt = new Date(iso);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

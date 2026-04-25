/**
 * /api/v1/vaults/entries
 *   - POST — create (or upsert-by-name) a vault entry; never logs plaintext
 *   - GET  — list vault entries the caller can see (no encryptedValue on wire)
 *
 * Auth scope (per specs/service-token-auth.md §Scope 定义):
 *   - POST → `vaults:write`
 *   - GET  → `vaults:read`
 *
 * Resource access (per spec §资源归属校验):
 *   - `scope=platform`       → platform-wide; session-only (service tokens
 *                              are rejected even with vaults:read/write).
 *                              This preserves "Platform entries visible only
 *                              to admin" from specs/vault-design.md.
 *   - `scope=project`        → caller must be member of `projectId`.
 *
 * Response shape: `{ data: VaultEntry }` / `{ data: VaultEntry[], nextCursor }`.
 * GET strips `encryptedValue` — the column exists server-side only; the v1
 * contract's `vaultEntrySchema` does NOT include it.
 */

import { v1 } from '@open-rush/contracts';
import type { VaultScope as DomainVaultScope } from '@open-rush/control-plane';
import { getDbClient, projectMembers, projects } from '@open-rush/db';
import { and, eq, isNull } from 'drizzle-orm';

import { v1Error, v1Paginated, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { entryToV1, resolveVault } from './helpers';

// ---------------------------------------------------------------------------
// Shared access helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the set of project_ids the caller can see. Mirrors the task-8
 * helper: membership rows ∪ creator-fallback, both filtered against
 * `projects.deleted_at IS NULL` so soft-deleted projects don't leak.
 */
async function listAccessibleProjectIds(
  db: ReturnType<typeof getDbClient>,
  userId: string
): Promise<string[]> {
  const [memberships, created] = await Promise.all([
    db
      .select({ projectId: projects.id })
      .from(projectMembers)
      .innerJoin(projects, eq(projectMembers.projectId, projects.id))
      .where(and(eq(projectMembers.userId, userId), isNull(projects.deletedAt))),
    db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.createdBy, userId), isNull(projects.deletedAt))),
  ]);
  const ids = new Set<string>();
  for (const m of memberships) ids.add(m.projectId);
  for (const p of created) ids.add(p.id);
  return Array.from(ids);
}

// ---------------------------------------------------------------------------
// POST /api/v1/vaults/entries
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'vaults:write')) {
    return v1Error('FORBIDDEN', 'Missing scope vaults:write');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return v1Error('VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = v1.createVaultEntryRequestSchema.safeParse(body);
  if (!parsed.success) return v1ValidationError(parsed.error);

  // scope=platform requires a session — service tokens are explicitly
  // rejected (spec: "Platform entries visible only to admin").
  if (parsed.data.scope === 'platform' && auth.authType !== 'session') {
    return v1Error('FORBIDDEN', 'Platform-scoped vault entries require a session', {
      hint: 'Service tokens can only manage project-scoped vault entries',
    });
  }

  // scope=project requires membership of the target project.
  if (parsed.data.scope === 'project') {
    if (!parsed.data.projectId) {
      // Guarded by the Zod refine, but belt-and-braces.
      return v1Error('VALIDATION_ERROR', 'projectId is required for scope=project');
    }
    if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
  }

  const resolved = resolveVault();
  if (resolved.error) return resolved.error;
  try {
    const entry = await resolved.service.store(
      parsed.data.scope as DomainVaultScope,
      parsed.data.name,
      parsed.data.value,
      {
        projectId: parsed.data.projectId,
        ownerId: auth.userId,
        credentialType: parsed.data.credentialType,
        injectionTarget: parsed.data.injectionTarget,
      }
    );
    return v1Success(entryToV1(entry), 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Maximum ')) {
      // Cap-exceeded → VALIDATION_ERROR (client must delete before create).
      return v1Error('VALIDATION_ERROR', err.message, {
        hint: 'Delete an existing entry before creating a new one',
      });
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/vaults/entries
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'vaults:read')) {
    return v1Error('FORBIDDEN', 'Missing scope vaults:read');
  }

  const url = new URL(request.url);
  const parsed = v1.listVaultEntriesQuerySchema.safeParse({
    scope: url.searchParams.get('scope') ?? undefined,
    projectId: url.searchParams.get('projectId') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  if (!parsed.success) return v1ValidationError(parsed.error);

  const db = getDbClient();

  // Determine the caller's platform-visibility + accessible project ids.
  // Platform is session-only (see POST rationale).
  let includePlatform = auth.authType === 'session';
  let projectIds: string[] = await listAccessibleProjectIds(db, auth.userId);

  // Apply optional filters. These NARROW the access scope; they never
  // broaden it.
  if (parsed.data.scope === 'platform') {
    if (auth.authType !== 'session') {
      return v1Error('FORBIDDEN', 'Platform scope requires a session');
    }
    projectIds = [];
  } else if (parsed.data.scope === 'project') {
    includePlatform = false;
    if (parsed.data.projectId) {
      if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
        return v1Error('FORBIDDEN', 'No access to this project');
      }
      projectIds = [parsed.data.projectId];
    }
  } else if (parsed.data.projectId) {
    // No scope filter but a projectId → narrow to that project only.
    if (!(await verifyProjectAccess(parsed.data.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
    includePlatform = false;
    projectIds = [parsed.data.projectId];
  }

  const resolved = resolveVault();
  if (resolved.error) return resolved.error;
  const entries = await resolved.service.listForAccess({ includePlatform, projectIds });

  // v0.1 pagination policy: we return ALL visible rows in a single page so
  // clients never miss entries. Per-scope cap is 20
  // (`VaultService.MAX_CREDENTIALS_PER_SCOPE`), and typical deployments have
  // a single platform scope + a handful of projects, so the total is bounded
  // for the foreseeable future. If a future iteration grows that bound, the
  // contract's `cursor` + `limit` are already reserved — see
  // `packages/contracts/src/v1/vaults.ts#listVaultEntriesQuerySchema`.
  //
  // IMPORTANT: we deliberately do NOT truncate by `limit` here. Silent
  // truncation with `nextCursor: null` would be a data-visibility bug
  // (clients cannot distinguish "cap hit" from "no more rows").
  // `parsed.data.limit` is parsed for contract compliance but unused.
  return v1Paginated(entries.map(entryToV1), null);
}

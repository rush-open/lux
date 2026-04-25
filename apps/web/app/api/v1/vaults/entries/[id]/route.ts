/**
 * DELETE /api/v1/vaults/entries/:id
 *
 * Removes a vault entry. The entry row carries its own scope, so we:
 *   1. Load the row (404 if missing)
 *   2. Run the right access check:
 *      - platform → session-only
 *      - project  → caller must be member of `row.projectId`
 *   3. Physically delete (no soft-delete; vault removal is a user-triggered
 *      permanent action, distinct from soft-deleting a project).
 *
 * Auth scope: `vaults:write` (per specs/service-token-auth.md §Scope 定义).
 */
import { v1 } from '@open-rush/contracts';

import { v1Error, v1Success, v1ValidationError } from '@/lib/api/v1-responses';
import { verifyProjectAccess } from '@/lib/api-utils';
import { authenticate, hasScope } from '@/lib/auth/unified-auth';

import { resolveVault } from '../helpers';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth) return v1Error('UNAUTHORIZED', 'Authentication required');
  if (!hasScope(auth, 'vaults:write')) {
    return v1Error('FORBIDDEN', 'Missing scope vaults:write');
  }

  const { id } = await params;
  const paramsParsed = v1.deleteVaultEntryParamsSchema.safeParse({ id });
  if (!paramsParsed.success) return v1ValidationError(paramsParsed.error);

  const resolved = resolveVault();
  if (resolved.error) return resolved.error;

  const entry = await resolved.service.findById(paramsParsed.data.id);
  if (!entry) return v1Error('NOT_FOUND', `Vault entry ${paramsParsed.data.id} not found`);

  // Authorization per entry scope.
  if (entry.scope === 'platform') {
    if (auth.authType !== 'session') {
      return v1Error('FORBIDDEN', 'Platform vault entries can only be managed via session auth');
    }
  } else {
    // scope === 'project'. projectId is enforced non-null by the DB CHECK.
    if (!entry.projectId) {
      return v1Error('INTERNAL', 'Vault entry has scope=project but no projectId');
    }
    if (!(await verifyProjectAccess(entry.projectId, auth.userId))) {
      return v1Error('FORBIDDEN', 'No access to this project');
    }
  }

  await resolved.service.removeById(entry.id);
  return v1Success({ id: entry.id });
}

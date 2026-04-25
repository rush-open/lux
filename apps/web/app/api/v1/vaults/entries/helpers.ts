/**
 * Shared helpers for `/api/v1/vaults/entries/*` route files.
 *
 * Exports:
 * - `resolveVault()` — construct a VaultService OR return a v1 `INTERNAL`
 *   500 Response on misconfiguration (keeps every `/api/v1/*` response
 *   conformant to the error envelope, even on setup failure).
 * - `entryToV1()` — convert the domain `VaultEntry` (Dates; no
 *   `encryptedValue` in the type) to the v1 wire shape (ISO datetimes).
 *   This is the single trusted mapping; if anyone ever extends the domain
 *   type with `encryptedValue`, this function is the one place that must
 *   still strip it.
 */

import type { v1 } from '@open-rush/contracts';
import {
  createCryptoService,
  type VaultEntry as DomainVaultEntry,
  DrizzleVaultDb,
  VaultService,
} from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';

import { v1Error } from '@/lib/api/v1-responses';

export type ResolvedVault =
  | { readonly service: VaultService; readonly error?: never }
  | { readonly service?: never; readonly error: Response };

/**
 * Build a VaultService, or produce a ready-to-return Response when
 * VAULT_MASTER_KEY is missing or malformed. We map BOTH absence AND invalid
 * length to `INTERNAL` with a hint — it's always a server misconfiguration,
 * never a client bug.
 */
export function resolveVault(): ResolvedVault {
  const masterKey = process.env.VAULT_MASTER_KEY;
  if (!masterKey) {
    return {
      error: v1Error('INTERNAL', 'VAULT_MASTER_KEY is not configured', {
        hint: 'Set VAULT_MASTER_KEY (base64 32 bytes) in the server environment',
      }),
    };
  }
  try {
    const db = getDbClient();
    const service = new VaultService(createCryptoService(masterKey), new DrizzleVaultDb(db));
    return { service };
  } catch (err) {
    // `createCryptoService` throws on invalid key length / encoding.
    const msg = err instanceof Error ? err.message : String(err);
    return {
      error: v1Error('INTERNAL', `Vault is misconfigured: ${msg}`),
    };
  }
}

/**
 * Convert the service-layer VaultEntry to the v1 wire shape. Deliberately
 * never touches `encryptedValue`.
 */
export function entryToV1(e: DomainVaultEntry): v1.VaultEntry {
  return {
    id: e.id,
    scope: e.scope as v1.VaultEntry['scope'],
    projectId: e.projectId,
    ownerId: e.ownerId,
    name: e.name,
    credentialType: e.credentialType as v1.VaultEntry['credentialType'],
    keyVersion: e.keyVersion,
    injectionTarget: e.injectionTarget ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}

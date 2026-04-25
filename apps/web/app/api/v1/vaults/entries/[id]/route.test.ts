/**
 * Tests for DELETE /api/v1/vaults/entries/:id.
 *
 * Core properties under test:
 *   - service-token cannot delete platform entries (session-only)
 *   - project entries require membership of the owning project
 *   - unknown id → 404
 *   - 404 returns before any DB write
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticate, mockHasScope, mockVerifyProjectAccess, mockFindById, mockRemoveById } =
  vi.hoisted(() => ({
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockFindById: vi.fn(),
    mockRemoveById: vi.fn(),
  }));

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

vi.mock('@open-rush/control-plane', () => ({
  createCryptoService: () => ({ encrypt: () => 'x', decrypt: () => 'x' }),
  DrizzleVaultDb: class {
    constructor(_db: unknown) {}
  },
  VaultService: class {
    findById = mockFindById;
    removeById = mockRemoveById;
  },
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({ __fake: true }),
}));

import { DELETE } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const ENTRY_ID = '00000000-0000-0000-0000-0000000000aa';

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}
function req() {
  return new Request(`https://t/api/v1/vaults/entries/${ENTRY_ID}`, { method: 'DELETE' });
}

function fakeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: ENTRY_ID,
    scope: 'project',
    projectId: PROJECT_ID,
    ownerId: 'user-1',
    name: 'MY_KEY',
    credentialType: 'env_var',
    keyVersion: 1,
    injectionTarget: null,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

beforeEach(() => {
  process.env.VAULT_MASTER_KEY = 'y5yPxvWNZHZx6JBn280nbmleA+zfQaO6kAl4rtlJYVA=';
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ userId: 'user-1', scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockRemoveById.mockResolvedValue(true);
});

describe('DELETE /api/v1/vaults/entries/:id', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(401);
  });

  it('403 when missing vaults:write scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(403);
  });

  it('400 when id is not a uuid', async () => {
    const res = await DELETE(req(), params('not-a-uuid'));
    expect(res.status).toBe(400);
  });

  it('404 when entry does not exist; no delete issued', async () => {
    mockFindById.mockResolvedValue(null);
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(404);
    expect(mockRemoveById).not.toHaveBeenCalled();
  });

  it('403 when service-token tries to delete a platform entry', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user-1',
      scopes: ['vaults:write'],
      authType: 'service-token',
    });
    mockFindById.mockResolvedValue(fakeEntry({ scope: 'platform', projectId: null }));
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(403);
    expect(mockRemoveById).not.toHaveBeenCalled();
  });

  it('session can delete a platform entry', async () => {
    mockFindById.mockResolvedValue(fakeEntry({ scope: 'platform', projectId: null }));
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(200);
    expect(mockRemoveById).toHaveBeenCalledWith(ENTRY_ID);
  });

  it('403 when caller cannot access a project-scoped entry', async () => {
    mockFindById.mockResolvedValue(fakeEntry());
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(403);
    expect(mockRemoveById).not.toHaveBeenCalled();
  });

  it('200 when membership allows project delete; response carries id', async () => {
    mockFindById.mockResolvedValue(fakeEntry());
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(ENTRY_ID);
    expect(mockRemoveById).toHaveBeenCalledWith(ENTRY_ID);
  });

  it('500 INTERNAL when a project entry has null projectId (DB integrity)', async () => {
    // The DB CHECK constraint prevents this, but guard regression if someone
    // ever bypasses it.
    mockFindById.mockResolvedValue(fakeEntry({ scope: 'project', projectId: null }));
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(500);
    expect(mockRemoveById).not.toHaveBeenCalled();
  });

  it('500 INTERNAL with v1 envelope when VAULT_MASTER_KEY missing', async () => {
    delete process.env.VAULT_MASTER_KEY;
    const res = await DELETE(req(), params(ENTRY_ID));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(mockFindById).not.toHaveBeenCalled();
  });
});

/**
 * Tests for POST/GET /api/v1/vaults/entries.
 *
 * Core safety properties under test:
 *   - GET response body NEVER includes `encryptedValue` (structural + grep)
 *   - POST with `scope=platform` requires session; service-tokens rejected
 *   - project-scoped writes/reads require membership of the target project
 *   - service-token callers without membership can't list cross-project rows
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockVaultStore,
  mockVaultListForAccess,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockHasScope: vi.fn(),
  mockVerifyProjectAccess: vi.fn(),
  mockVaultStore: vi.fn(),
  mockVaultListForAccess: vi.fn(),
}));

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

// Stub VaultService to avoid real crypto/DB. The route also calls
// `createCryptoService(masterKey)` and `new DrizzleVaultDb(db)` — but those
// only construct the service we mock, so we can no-op them.
vi.mock('@open-rush/control-plane', () => ({
  createCryptoService: () => ({ encrypt: () => 'x', decrypt: () => 'x' }),
  DrizzleVaultDb: class {
    constructor(_db: unknown) {}
  },
  VaultService: class {
    store = mockVaultStore;
    listForAccess = mockVaultListForAccess;
  },
}));

// Stub the drizzle client so BOTH chain variants used by
// `listAccessibleProjectIds` return [] without hitting a real DB:
//   - db.select(...).from(...).innerJoin(...).where(...)  (membership)
//   - db.select(...).from(...).where(...)                  (created-by)
vi.mock('@open-rush/db', () => ({
  getDbClient: () => ({
    select: () => {
      // Terminal chain: every call on the final object returns an empty array
      // (treated as a thenable). The mock is deliberately permissive.
      const terminal: Record<string, unknown> = {};
      terminal.where = async () => [];
      terminal.innerJoin = () => ({ where: async () => [] });
      return { from: () => terminal };
    },
  }),
  projectMembers: { projectId: 'pm.pid', userId: 'pm.uid' },
  projects: { id: 'p.id', createdBy: 'p.cb', deletedAt: 'p.deletedAt' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
  isNull: (c: unknown) => ({ type: 'isNull', c }),
}));

beforeEach(() => {
  process.env.VAULT_MASTER_KEY = 'y5yPxvWNZHZx6JBn280nbmleA+zfQaO6kAl4rtlJYVA=';
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue({ userId: 'user-1', scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
});

// Import AFTER mocks.
import { GET, POST } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';

function jsonReq(method: string, body?: unknown, url = 'https://t/api/v1/vaults/entries'): Request {
  const init: RequestInit = { method, headers: { 'content-type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

function fakeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: '00000000-0000-0000-0000-0000000000aa',
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

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/v1/vaults/entries', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(401);
  });

  it('403 when missing vaults:write scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'vaults:write');
  });

  it('400 for invalid JSON', async () => {
    const req = new Request('https://t/api/v1/vaults/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400 when schema refine fails (scope=platform WITH projectId)', async () => {
    const res = await POST(
      jsonReq('POST', {
        scope: 'platform',
        projectId: PROJECT_ID,
        name: 'X',
        credentialType: 'env_var',
        value: 's',
      })
    );
    expect(res.status).toBe(400);
  });

  it('403 when service-token tries to create a platform entry', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user-1',
      scopes: ['vaults:write'],
      authType: 'service-token',
    });
    const res = await POST(
      jsonReq('POST', {
        scope: 'platform',
        name: 'PLATFORM_KEY',
        credentialType: 'env_var',
        value: 'secret',
      })
    );
    expect(res.status).toBe(403);
    expect(mockVaultStore).not.toHaveBeenCalled();
  });

  it('403 when caller cannot access the target project', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(403);
    expect(mockVaultStore).not.toHaveBeenCalled();
  });

  it('201 on success; response body never includes encryptedValue', async () => {
    mockVaultStore.mockResolvedValue(fakeEntry());
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(201);
    const raw = await res.text();
    // Structural check + defensive grep.
    expect(raw).not.toContain('encryptedValue');
    expect(raw).not.toContain('encrypted_value');
    const body = JSON.parse(raw) as { data: { id: string; createdAt: string } };
    expect(body.data.id).toBe('00000000-0000-0000-0000-0000000000aa');
    expect(body.data.createdAt).toBe('2024-01-01T00:00:00.000Z');
  });

  it('400 VALIDATION_ERROR with hint when the per-scope cap is hit', async () => {
    mockVaultStore.mockRejectedValue(new Error('Maximum 20 credentials per scope reached'));
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.hint).toMatch(/Delete an existing/);
  });

  it('rethrows unknown errors', async () => {
    mockVaultStore.mockRejectedValue(new Error('boom'));
    await expect(POST(jsonReq('POST', validProjectBody()))).rejects.toThrow('boom');
  });

  it('500 INTERNAL when VAULT_MASTER_KEY is not configured (v1 envelope, not a raw throw)', async () => {
    delete process.env.VAULT_MASTER_KEY;
    const res = await POST(jsonReq('POST', validProjectBody()));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string; hint?: string } };
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).toMatch(/VAULT_MASTER_KEY/);
    expect(body.error.hint).toMatch(/base64 32 bytes/);
    expect(mockVaultStore).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/vaults/entries', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(401);
  });

  it('403 when missing vaults:read scope', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'vaults:read');
  });

  it('400 when scope query value is invalid', async () => {
    const res = await GET(jsonReq('GET', undefined, 'https://t/api/v1/vaults/entries?scope=nope'));
    expect(res.status).toBe(400);
  });

  it('403 when service-token asks for scope=platform', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user-1',
      scopes: ['vaults:read'],
      authType: 'service-token',
    });
    const res = await GET(
      jsonReq('GET', undefined, 'https://t/api/v1/vaults/entries?scope=platform')
    );
    expect(res.status).toBe(403);
  });

  it('403 when filtering to a project the caller cannot access', async () => {
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(
      jsonReq('GET', undefined, `https://t/api/v1/vaults/entries?projectId=${PROJECT_ID}`)
    );
    expect(res.status).toBe(403);
  });

  it('returns entries without encryptedValue; nextCursor is null (v0.1)', async () => {
    mockVaultListForAccess.mockResolvedValue([
      fakeEntry({ id: 'id-1', name: 'A' }),
      fakeEntry({ id: 'id-2', name: 'B', scope: 'platform', projectId: null }),
    ]);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('encryptedValue');
    expect(raw).not.toContain('encrypted_value');
    const body = (await JSON.parse(raw)) as {
      data: Array<{ id: string; name: string; createdAt: string }>;
      nextCursor: string | null;
    };
    expect(body.data.map((e) => e.id)).toEqual(['id-1', 'id-2']);
    expect(body.data[0].createdAt).toBe('2024-01-01T00:00:00.000Z');
    expect(body.nextCursor).toBeNull();
  });

  it('includePlatform is false for service-token callers', async () => {
    mockAuthenticate.mockResolvedValue({
      userId: 'user-1',
      scopes: ['vaults:read'],
      authType: 'service-token',
    });
    mockVaultListForAccess.mockResolvedValue([]);
    await GET(jsonReq('GET'));
    expect(mockVaultListForAccess).toHaveBeenCalledWith(
      expect.objectContaining({ includePlatform: false })
    );
  });

  it('narrows to a single project when ?projectId=X', async () => {
    mockVaultListForAccess.mockResolvedValue([]);
    await GET(jsonReq('GET', undefined, `https://t/api/v1/vaults/entries?projectId=${PROJECT_ID}`));
    const [[opts]] = mockVaultListForAccess.mock.calls;
    expect(opts.includePlatform).toBe(false);
    expect(opts.projectIds).toEqual([PROJECT_ID]);
  });

  it('returns ALL visible rows without truncation (no silent pagination-loss)', async () => {
    // Construct a page larger than the default `limit=50` to guard against
    // regressions to the old `.slice(0, limit)` behaviour.
    const many = Array.from({ length: 75 }, (_, i) => fakeEntry({ id: `id-${i}`, name: `K${i}` }));
    mockVaultListForAccess.mockResolvedValue(many);
    const res = await GET(jsonReq('GET'));
    const body = (await res.json()) as { data: Array<{ id: string }>; nextCursor: string | null };
    expect(body.data).toHaveLength(75);
    expect(body.nextCursor).toBeNull();
  });

  it('500 INTERNAL when VAULT_MASTER_KEY is not configured', async () => {
    delete process.env.VAULT_MASTER_KEY;
    mockVaultListForAccess.mockResolvedValue([]);
    const res = await GET(jsonReq('GET'));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL');
  });
});

function validProjectBody(overrides: Record<string, unknown> = {}) {
  return {
    scope: 'project',
    projectId: PROJECT_ID,
    name: 'MY_KEY',
    credentialType: 'env_var',
    value: 'plaintext-secret',
    ...overrides,
  };
}

/**
 * Integration test — real VaultService + real DrizzleVaultDb + PGlite through
 * the vault routes (only auth + membership check + db client factory mocked).
 *
 * Focus: properties that the mocked unit tests can't prove:
 *   - the real `DrizzleVaultDb.findById` + `removeById` work against PG SQL
 *   - `listForAccess` returns only the intersection of (platform if session)
 *     + (projectIds) — no cross-project leak
 *   - encrypted values are stored & returned without exposure on the wire
 */
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import * as schema from '@open-rush/db';
import { projectMembers, projects, users, vaultEntries } from '@open-rush/db';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let pglite: PGlite;
let db: TestDb;

const { mockAuthenticate, mockHasScope, mockVerifyProjectAccess, mockGetDbClient } = vi.hoisted(
  () => ({
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockGetDbClient: vi.fn(),
  })
);

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

// Real `@open-rush/db` exports with `getDbClient` swapped to our PGlite
// instance.
vi.mock('@open-rush/db', async () => {
  const actual = await vi.importActual<typeof import('@open-rush/db')>('@open-rush/db');
  return {
    ...actual,
    getDbClient: () => mockGetDbClient(),
  };
});

let POST_CREATE: typeof import('./route')['POST'];
let GET_LIST: typeof import('./route')['GET'];
let DELETE_BY_ID: typeof import('./[id]/route')['DELETE'];

beforeAll(async () => {
  pglite = new PGlite();
  db = drizzle(pglite, { schema });
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT,
      email TEXT UNIQUE,
      email_verified_at TIMESTAMPTZ,
      image TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      description TEXT,
      sandbox_provider VARCHAR(50) NOT NULL DEFAULT 'opensandbox',
      default_model VARCHAR(255),
      default_connection_mode VARCHAR(50) DEFAULT 'anthropic',
      created_by UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      deleted_at TIMESTAMPTZ
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS project_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(20) NOT NULL DEFAULT 'member',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(project_id, user_id)
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS vault_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      scope VARCHAR(20) NOT NULL,
      project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
      owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
      name VARCHAR(255) NOT NULL,
      credential_type VARCHAR(50) NOT NULL DEFAULT 'env_var',
      encrypted_value TEXT NOT NULL,
      key_version INTEGER NOT NULL DEFAULT 1,
      injection_target VARCHAR(255),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT vault_scope_project_check CHECK (
        (scope = 'platform' AND project_id IS NULL) OR
        (scope = 'project' AND project_id IS NOT NULL)
      ),
      CONSTRAINT vault_entries_scope_project_name_idx UNIQUE(scope, project_id, name)
    )
  `);

  mockGetDbClient.mockReturnValue(db);
  const [collection, idRoute] = await Promise.all([import('./route'), import('./[id]/route')]);
  POST_CREATE = collection.POST;
  GET_LIST = collection.GET;
  DELETE_BY_ID = idRoute.DELETE;
}, 30000);

afterAll(async () => {
  await pglite.close();
}, 30000);

let USER_ID = '';
let OTHER_USER_ID = '';
let PROJECT_A = '';
let PROJECT_B = '';

beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE vault_entries, project_members, projects, users RESTART IDENTITY CASCADE`
  );
  // Base64-encoded 32-byte master key (VaultService requires 32 decoded bytes).
  process.env.VAULT_MASTER_KEY = 'y5yPxvWNZHZx6JBn280nbmleA+zfQaO6kAl4rtlJYVA=';
  USER_ID = randomUUID();
  OTHER_USER_ID = randomUUID();

  const [u1] = await db
    .insert(users)
    .values({ id: USER_ID, name: 'Alice', email: `a-${USER_ID}@ex.com` })
    .returning();
  const [u2] = await db
    .insert(users)
    .values({ id: OTHER_USER_ID, name: 'Bob', email: `b-${OTHER_USER_ID}@ex.com` })
    .returning();

  const [pa] = await db.insert(projects).values({ name: 'A', createdBy: u1.id }).returning();
  PROJECT_A = pa.id;
  const [pb] = await db.insert(projects).values({ name: 'B', createdBy: u2.id }).returning();
  PROJECT_B = pb.id;

  mockAuthenticate.mockResolvedValue({ userId: USER_ID, scopes: ['*'], authType: 'session' });
  mockHasScope.mockReturnValue(true);
  // Alice can access project A by default; Bob's project B is blocked.
  mockVerifyProjectAccess.mockImplementation(async (pid: string, uid: string) => {
    if (uid !== USER_ID) return false;
    return pid === PROJECT_A;
  });
});

function postReq(body: unknown) {
  return new Request('https://t/api/v1/vaults/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('Vault entries — integration (real PGlite + crypto)', () => {
  it('POST then GET roundtrip: encrypted at rest, ciphertext never on the wire', async () => {
    const res = await POST_CREATE(
      postReq({
        scope: 'project',
        projectId: PROJECT_A,
        name: 'MY_SECRET',
        credentialType: 'env_var',
        value: 'super-secret-plaintext',
      })
    );
    expect(res.status).toBe(201);
    const createBody = (await res.json()) as { data: { id: string } };
    expect(createBody.data.id).toBeDefined();

    // Sanity: DB row carries ciphertext that isn't the plaintext.
    const [row] = await db.select().from(vaultEntries);
    expect(row.encryptedValue).not.toBe('super-secret-plaintext');
    expect(row.encryptedValue.length).toBeGreaterThan(10);

    // GET returns the row WITHOUT encryptedValue.
    const listRes = await GET_LIST(new Request('https://t/api/v1/vaults/entries'));
    expect(listRes.status).toBe(200);
    const raw = await listRes.text();
    expect(raw).not.toContain('encryptedValue');
    expect(raw).not.toContain('encrypted_value');
    expect(raw).not.toContain('super-secret-plaintext');
    const list = JSON.parse(raw) as { data: Array<{ id: string; name: string }> };
    expect(list.data).toHaveLength(1);
    expect(list.data[0].name).toBe('MY_SECRET');
  });

  it('service-token cannot create a platform entry; session can', async () => {
    // Service token attempt → 403
    mockAuthenticate.mockResolvedValueOnce({
      userId: USER_ID,
      scopes: ['vaults:write'],
      authType: 'service-token',
    });
    const svcRes = await POST_CREATE(
      postReq({
        scope: 'platform',
        name: 'PLATFORM_KEY',
        credentialType: 'env_var',
        value: 'p',
      })
    );
    expect(svcRes.status).toBe(403);

    // Session attempt → 201
    const sessionRes = await POST_CREATE(
      postReq({
        scope: 'platform',
        name: 'PLATFORM_KEY',
        credentialType: 'env_var',
        value: 'p',
      })
    );
    expect(sessionRes.status).toBe(201);
  });

  it('GET never leaks rows from projects the caller cannot access', async () => {
    // Insert entries in both projects directly.
    await db.execute(sql`
      INSERT INTO vault_entries (scope, project_id, name, encrypted_value, credential_type)
      VALUES ('project', ${PROJECT_A}, 'IN_A', 'ct-a', 'env_var'),
             ('project', ${PROJECT_B}, 'IN_B', 'ct-b', 'env_var')
    `);
    // Add Alice as a member of project B in the MEMBERSHIP table,
    // but we also need `verifyProjectAccess` to deny it — which it already
    // does because we scoped the mock to PROJECT_A. The route instead relies
    // on `listAccessibleProjectIds` which pulls from project_members AND
    // created-by. Alice is NOT a member of B and NOT its creator, so B is
    // out of scope regardless of the mock.
    const res = await GET_LIST(new Request('https://t/api/v1/vaults/entries'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ name: string }> };
    expect(body.data.map((e) => e.name)).toEqual(['IN_A']);
  });

  it('DELETE: session → platform ok; service-token → platform 403', async () => {
    // Seed a platform entry directly.
    await db.execute(sql`
      INSERT INTO vault_entries (scope, project_id, name, encrypted_value, credential_type)
      VALUES ('platform', NULL, 'P', 'ct', 'env_var')
    `);
    const [entry] = await db.select().from(vaultEntries);

    // Service token attempt → 403
    mockAuthenticate.mockResolvedValueOnce({
      userId: USER_ID,
      scopes: ['vaults:write'],
      authType: 'service-token',
    });
    const svcRes = await DELETE_BY_ID(
      new Request(`https://t/api/v1/vaults/entries/${entry.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: entry.id }) }
    );
    expect(svcRes.status).toBe(403);
    expect(await db.select().from(vaultEntries)).toHaveLength(1); // still there

    // Session attempt → 200 + row gone
    const sessRes = await DELETE_BY_ID(
      new Request(`https://t/api/v1/vaults/entries/${entry.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: entry.id }) }
    );
    expect(sessRes.status).toBe(200);
    expect(await db.select().from(vaultEntries)).toHaveLength(0);
  });

  it('DELETE: member of the project can delete; non-member gets 403', async () => {
    // Project A entry.
    await db.execute(sql`
      INSERT INTO vault_entries (scope, project_id, name, encrypted_value, credential_type)
      VALUES ('project', ${PROJECT_A}, 'KEY_A', 'ct', 'env_var')
    `);
    const [entry] = await db.select().from(vaultEntries);

    // Alice (member/creator of A) → 200
    const aliceRes = await DELETE_BY_ID(
      new Request(`https://t/api/v1/vaults/entries/${entry.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: entry.id }) }
    );
    expect(aliceRes.status).toBe(200);

    // Re-insert a project-B entry for the non-member test.
    await db.execute(sql`
      INSERT INTO vault_entries (scope, project_id, name, encrypted_value, credential_type)
      VALUES ('project', ${PROJECT_B}, 'KEY_B', 'ct', 'env_var')
    `);
    const [entryB] = await db.select().from(vaultEntries).where(sql`project_id = ${PROJECT_B}`);

    // Alice tries to delete B-scoped entry → 403 (mock returns false for B).
    const res = await DELETE_BY_ID(
      new Request(`https://t/api/v1/vaults/entries/${entryB.id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: entryB.id }) }
    );
    expect(res.status).toBe(403);
    // Row still exists.
    const rows = await db.select().from(vaultEntries).where(sql`project_id = ${PROJECT_B}`);
    expect(rows).toHaveLength(1);
  });

  it('DELETE unknown id → 404', async () => {
    const randomId = randomUUID();
    const res = await DELETE_BY_ID(
      new Request(`https://t/api/v1/vaults/entries/${randomId}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: randomId }) }
    );
    expect(res.status).toBe(404);
  });
});

// Suppress unused import warning from beforeEach fixtures
void projectMembers;

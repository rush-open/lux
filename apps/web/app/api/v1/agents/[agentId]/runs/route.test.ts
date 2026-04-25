/**
 * Tests for POST/GET /api/v1/agents/:agentId/runs.
 *
 * POST is the only place in the managed-agents API that honours
 * Idempotency-Key (spec §幂等性). We mock the service call so we can
 * verify the hash + key are plumbed correctly, plus the conflict →
 * error envelope mapping.
 *
 * GET is a simple cursor paginator; we script the drizzle fake to
 * return rows and assert the wire shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockCreateRun,
  mockComputeHash,
  dbFake,
  FakeIdempotencyConflictError,
} = vi.hoisted(() => {
  class IdempotencyConflict extends Error {
    constructor(opts: {
      idempotencyKey: string;
      existingRunId: string;
      existingRequestHash: string;
      incomingRequestHash: string;
    }) {
      super(`idempotency conflict: key=${opts.idempotencyKey} existingRun=${opts.existingRunId}`);
      this.name = 'IdempotencyConflictError';
    }
  }

  const selectSpy = vi.fn();
  function makeSelectChain(projArgs: unknown[]) {
    const invocation = selectSpy({ kind: 'select', projArgs });
    const result = Array.isArray(invocation) ? invocation : [];
    const chain: {
      from: (t: unknown) => typeof chain;
      where: (p: unknown) => typeof chain & Promise<unknown[]>;
      orderBy: (...o: unknown[]) => typeof chain;
      limit: (n: number) => Promise<unknown[]>;
    } = {
      from: () => chain,
      where: () => {
        const asPromise = Promise.resolve(result) as Promise<unknown[]>;
        return Object.assign(asPromise, chain) as typeof chain & Promise<unknown[]>;
      },
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
    };
    return chain;
  }

  return {
    mockAuthenticate: vi.fn(),
    mockHasScope: vi.fn(),
    mockVerifyProjectAccess: vi.fn(),
    mockCreateRun: vi.fn(),
    mockComputeHash: vi.fn((_body: unknown) => 'hash-of-body'),
    dbFake: {
      __select: selectSpy,
      select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
    },
    FakeIdempotencyConflictError: IdempotencyConflict,
  };
});

vi.mock('@/lib/auth/unified-auth', () => ({
  authenticate: (req: Request) => mockAuthenticate(req),
  hasScope: (ctx: unknown, scope: string) => mockHasScope(ctx, scope),
}));

vi.mock('@/lib/api-utils', () => ({
  verifyProjectAccess: (projectId: string, userId: string) =>
    mockVerifyProjectAccess(projectId, userId),
}));

vi.mock('@open-rush/control-plane', () => ({
  DrizzleRunDb: class {},
  RunService: class {
    createRunWithIdempotency = mockCreateRun;
  },
  IdempotencyConflictError: FakeIdempotencyConflictError,
  RunAlreadyTerminalError: class extends Error {},
  RunCannotCancelError: class extends Error {},
  RunNotFoundError: class extends Error {},
  computeIdempotencyHash: (body: unknown) => mockComputeHash(body),
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  tasks: {
    id: 't.id',
    projectId: 't.pid',
    agentId: 't.aid',
    status: 't.status',
    definitionVersion: 't.dv',
  },
  runs: {
    id: 'r.id',
    agentId: 'r.aid',
    taskId: 'r.tid',
    status: 'r.status',
    createdAt: 'r.createdAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: (...parts: unknown[]) => ({ type: 'and', parts }),
  or: (...parts: unknown[]) => ({ type: 'or', parts }),
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
  like: (c: unknown, v: unknown) => ({ type: 'like', c, v }),
  lt: (c: unknown, v: unknown) => ({ type: 'lt', c, v }),
  isNull: (c: unknown) => ({ type: 'isNull', c }),
  not: (p: unknown) => ({ type: 'not', p }),
  desc: (c: unknown) => ({ type: 'desc', c }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks
// ---------------------------------------------------------------------------

import { GET, POST } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const DEFINITION_ID = '00000000-0000-0000-0000-000000000aaa';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';
const USER_ID = 'user-1';

function sessionAuth() {
  return { userId: USER_ID, scopes: ['*'], authType: 'session' as const };
}

function paramsOf(agentId: string) {
  return Promise.resolve({ agentId });
}

function jsonReq(
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
  url = `https://t/api/v1/agents/${TASK_ID}/runs`
): Request {
  const init: RequestInit = {
    method,
    headers: { 'content-type': 'application/json', ...headers },
  };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

const SAMPLE_TASK_ROW = {
  id: TASK_ID,
  projectId: PROJECT_ID,
  agentId: DEFINITION_ID,
  status: 'active',
  definitionVersion: 3,
};

const SAMPLE_RUN_RESULT = {
  id: RUN_ID,
  agentId: DEFINITION_ID,
  taskId: TASK_ID,
  conversationId: null,
  parentRunId: null,
  status: 'queued',
  prompt: 'hello',
  provider: 'claude-code',
  connectionMode: 'anthropic',
  modelId: null,
  triggerSource: 'user',
  agentDefinitionVersion: 3,
  idempotencyKey: null,
  idempotencyRequestHash: null,
  activeStreamId: null,
  retryCount: 0,
  maxRetries: 3,
  errorMessage: null,
  createdAt: new Date('2024-03-04T05:06:07.000Z'),
  updatedAt: new Date('2024-03-04T05:06:07.000Z'),
  startedAt: null,
  completedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthenticate.mockResolvedValue(sessionAuth());
  mockHasScope.mockReturnValue(true);
  mockVerifyProjectAccess.mockResolvedValue(true);
  mockComputeHash.mockReturnValue('hash-of-body');
});

// ---------------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------------

describe('POST /api/v1/agents/:agentId/runs', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope runs:write missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'runs:write');
  });

  it('400 when agentId is not a UUID', async () => {
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf('not-a-uuid') });
    expect(res.status).toBe(400);
  });

  it('400 when body is invalid JSON', async () => {
    const req = new Request(`https://t/api/v1/agents/${TASK_ID}/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json',
    });
    const res = await POST(req, { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(400);
  });

  it('400 when input is empty (schema validation)', async () => {
    const res = await POST(jsonReq('POST', { input: '' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(400);
  });

  it('400 when Idempotency-Key header is malformed', async () => {
    const res = await POST(jsonReq('POST', { input: 'hi' }, { 'idempotency-key': 'has spaces!' }), {
      params: paramsOf(TASK_ID),
    });
    expect(res.status).toBe(400);
    expect(mockCreateRun).not.toHaveBeenCalled();
  });

  it('404 when Agent not found', async () => {
    dbFake.__select.mockReturnValueOnce([]);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
  });

  it('409 VERSION_CONFLICT when Agent is completed', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK_ROW, status: 'completed' }]);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  it('409 VERSION_CONFLICT when Agent is cancelled', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK_ROW, status: 'cancelled' }]);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(409);
  });

  it('400 when Agent has no bound definitionVersion', async () => {
    dbFake.__select.mockReturnValueOnce([{ ...SAMPLE_TASK_ROW, definitionVersion: null }]);
    const res = await POST(jsonReq('POST', { input: 'hi' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.hint).toMatch(/recreate/i);
  });

  it('201 creates Run without Idempotency-Key', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockCreateRun.mockResolvedValue(SAMPLE_RUN_RESULT);
    const res = await POST(jsonReq('POST', { input: 'hello' }), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { data: { id: string; agentId: string; status: string } };
    expect(body.data.id).toBe(RUN_ID);
    expect(body.data.agentId).toBe(TASK_ID);
    expect(body.data.status).toBe('queued');
    // Second positional arg to createRunWithIdempotency must be undefined
    // when no header was supplied.
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: DEFINITION_ID,
        prompt: 'hello',
        taskId: TASK_ID,
        agentDefinitionVersion: 3,
        triggerSource: 'user',
      }),
      undefined
    );
  });

  it('201 passes task-scoped Idempotency-Key + hash to service', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockCreateRun.mockResolvedValue(SAMPLE_RUN_RESULT);
    const res = await POST(
      jsonReq('POST', { input: 'hi' }, { 'idempotency-key': 'client-key-42' }),
      { params: paramsOf(TASK_ID) }
    );
    expect(res.status).toBe(201);
    expect(mockComputeHash).toHaveBeenCalledWith({ input: 'hi' });
    // Key must be task-scoped ("task:<id>|<client-key>") so two Agents
    // backed by the same AgentDefinition don't collide on the same
    // user-supplied key — see route comment.
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        key: `task:${TASK_ID}|client-key-42`,
        requestHash: 'hash-of-body',
      })
    );
  });

  it('500 when idempotent replay crosses task boundary (fail-closed safety)', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    // Service returns a run from a DIFFERENT task — shouldn't happen
    // with the task-scoped key, but the guard should catch the drift.
    mockCreateRun.mockResolvedValue({
      ...SAMPLE_RUN_RESULT,
      taskId: '00000000-0000-0000-0000-000000000999',
    });
    await expect(
      POST(jsonReq('POST', { input: 'hi' }, { 'idempotency-key': 'k' }), {
        params: paramsOf(TASK_ID),
      })
    ).rejects.toThrow(/crossed task boundary/);
  });

  it('409 IDEMPOTENCY_CONFLICT when service throws', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockCreateRun.mockRejectedValue(
      new FakeIdempotencyConflictError({
        idempotencyKey: 'k',
        existingRunId: 'existing-run',
        existingRequestHash: 'old',
        incomingRequestHash: 'new',
      })
    );
    const res = await POST(jsonReq('POST', { input: 'hi' }, { 'idempotency-key': 'k' }), {
      params: paramsOf(TASK_ID),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('parentRunId + modelId pass through to service', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockCreateRun.mockResolvedValue(SAMPLE_RUN_RESULT);
    const parent = '00000000-0000-0000-0000-000000000333';
    await POST(jsonReq('POST', { input: 'x', parentRunId: parent, modelId: 'claude-sonnet-4-5' }), {
      params: paramsOf(TASK_ID),
    });
    expect(mockCreateRun).toHaveBeenCalledWith(
      expect.objectContaining({ parentRunId: parent, modelId: 'claude-sonnet-4-5' }),
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/v1/agents/:agentId/runs', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope runs:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'runs:read');
  });

  it('400 when agentId is not a UUID', async () => {
    const res = await GET(jsonReq('GET'), { params: paramsOf('not-a-uuid') });
    expect(res.status).toBe(400);
  });

  it('400 on malformed limit query', async () => {
    const res = await GET(
      jsonReq('GET', undefined, {}, `https://t/api/v1/agents/${TASK_ID}/runs?limit=abc`),
      { params: paramsOf(TASK_ID) }
    );
    expect(res.status).toBe(400);
  });

  it('404 when Agent does not exist', async () => {
    dbFake.__select.mockReturnValueOnce([]);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(403);
  });

  it('200 returns paginated envelope with ISO dates', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]).mockReturnValueOnce([
      {
        ...SAMPLE_RUN_RESULT,
        createdAt: new Date('2024-03-04T05:06:07.000Z'),
        updatedAt: new Date('2024-03-04T05:06:07.000Z'),
        startedAt: null,
        completedAt: null,
      },
    ]);
    const res = await GET(jsonReq('GET'), { params: paramsOf(TASK_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; agentId: string; createdAt: string; status: string }>;
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe(RUN_ID);
    expect(body.data[0].agentId).toBe(TASK_ID);
    expect(body.data[0].createdAt).toBe('2024-03-04T05:06:07.000Z');
    expect(body.nextCursor).toBeNull();
  });

  it('status=cancelled filter renders user-cancelled rows with virtual cancelled status', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]).mockReturnValueOnce([
      {
        ...SAMPLE_RUN_RESULT,
        status: 'failed',
        errorMessage: 'cancelled by user',
        createdAt: new Date('2024-03-04T05:06:07.000Z'),
        updatedAt: new Date('2024-03-04T05:06:07.000Z'),
      },
    ]);
    const res = await GET(
      jsonReq('GET', undefined, {}, `https://t/api/v1/agents/${TASK_ID}/runs?status=cancelled`),
      { params: paramsOf(TASK_ID) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ status: string; errorMessage: string | null }>;
    };
    // Wire shape must show 'cancelled', errorMessage preserved.
    expect(body.data[0].status).toBe('cancelled');
    expect(body.data[0].errorMessage).toBe('cancelled by user');
  });

  it('status=failed filter still surfaces real failures (not cancelled)', async () => {
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]).mockReturnValueOnce([
      {
        ...SAMPLE_RUN_RESULT,
        status: 'failed',
        errorMessage: 'provisioning timed out',
        createdAt: new Date('2024-03-04T05:06:07.000Z'),
        updatedAt: new Date('2024-03-04T05:06:07.000Z'),
      },
    ]);
    const res = await GET(
      jsonReq('GET', undefined, {}, `https://t/api/v1/agents/${TASK_ID}/runs?status=failed`),
      { params: paramsOf(TASK_ID) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ status: string }> };
    expect(body.data[0].status).toBe('failed');
  });

  it('malformed cursor (non-UUID id) is silently dropped (no 500)', async () => {
    // base64url("2024-01-01T00:00:00.000Z|not-a-uuid")
    const bad = Buffer.from('2024-01-01T00:00:00.000Z|not-a-uuid', 'utf8').toString('base64url');
    dbFake.__select.mockReturnValueOnce([SAMPLE_TASK_ROW]).mockReturnValueOnce([]);
    const res = await GET(
      jsonReq(
        'GET',
        undefined,
        {},
        `https://t/api/v1/agents/${TASK_ID}/runs?cursor=${encodeURIComponent(bad)}`
      ),
      { params: paramsOf(TASK_ID) }
    );
    // Handler silently falls back to "first page" and returns 200.
    expect(res.status).toBe(200);
  });

  it('emits nextCursor when the page is full', async () => {
    const row2 = {
      ...SAMPLE_RUN_RESULT,
      id: '00000000-0000-0000-0000-000000000223',
      createdAt: new Date('2024-03-03T00:00:00.000Z'),
      updatedAt: new Date('2024-03-03T00:00:00.000Z'),
    };
    dbFake.__select
      .mockReturnValueOnce([SAMPLE_TASK_ROW])
      .mockReturnValueOnce([SAMPLE_RUN_RESULT, row2]);
    const res = await GET(
      jsonReq('GET', undefined, {}, `https://t/api/v1/agents/${TASK_ID}/runs?limit=1`),
      { params: paramsOf(TASK_ID) }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: unknown[];
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.nextCursor).not.toBeNull();
  });
});

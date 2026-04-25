/**
 * Tests for GET /api/v1/agents/:agentId/runs/:runId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockAuthenticate, mockHasScope, mockVerifyProjectAccess, mockGetById, dbFake } = vi.hoisted(
  () => {
    const selectSpy = vi.fn();
    function makeSelectChain(projArgs: unknown[]) {
      const invocation = selectSpy({ kind: 'select', projArgs });
      const result = Array.isArray(invocation) ? invocation : [];
      const chain: {
        from: (t: unknown) => typeof chain;
        where: (p: unknown) => typeof chain & Promise<unknown[]>;
        limit: (n: number) => Promise<unknown[]>;
      } = {
        from: () => chain,
        where: () => {
          const asPromise = Promise.resolve(result) as Promise<unknown[]>;
          return Object.assign(asPromise, chain) as typeof chain & Promise<unknown[]>;
        },
        limit: () => Promise.resolve(result),
      };
      return chain;
    }
    return {
      mockAuthenticate: vi.fn(),
      mockHasScope: vi.fn(),
      mockVerifyProjectAccess: vi.fn(),
      mockGetById: vi.fn(),
      dbFake: {
        __select: selectSpy,
        select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
      },
    };
  }
);

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
    getById = mockGetById;
  },
  IdempotencyConflictError: class extends Error {},
  RunAlreadyTerminalError: class extends Error {},
  RunCannotCancelError: class extends Error {},
  RunNotFoundError: class extends Error {},
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  tasks: { id: 't.id', projectId: 't.pid' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
}));

import { GET } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';

function sessionAuth() {
  return { userId: 'user-1', scopes: ['*'], authType: 'session' as const };
}

function params(agentId: string, runId: string) {
  return Promise.resolve({ agentId, runId });
}

function req(url = `https://t/api/v1/agents/${TASK_ID}/runs/${RUN_ID}`): Request {
  return new Request(url);
}

const SAMPLE_RUN = {
  id: RUN_ID,
  agentId: '00000000-0000-0000-0000-000000000aaa',
  taskId: TASK_ID,
  conversationId: null,
  parentRunId: null,
  status: 'running',
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
});

describe('GET /api/v1/agents/:agentId/runs/:runId', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope runs:read missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'runs:read');
  });

  it('400 when params are not UUIDs', async () => {
    const res = await GET(req(), { params: params('not-uuid', RUN_ID) });
    expect(res.status).toBe(400);
  });

  it('404 when run does not exist', async () => {
    mockGetById.mockResolvedValue(null);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('404 when run belongs to a different Agent (cross-agent probing)', async () => {
    // Run exists but taskId doesn't match the URL agentId.
    mockGetById.mockResolvedValue({
      ...SAMPLE_RUN,
      taskId: '00000000-0000-0000-0000-000000000999',
    });
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
  });

  it('200 returns Run with ISO dates + API-layer agentId', async () => {
    mockGetById.mockResolvedValue(SAMPLE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; agentId: string; createdAt: string; status: string };
    };
    expect(body.data.id).toBe(RUN_ID);
    // API-layer agentId must equal the URL agentId = task id,
    // NOT the service-layer agentId (= AgentDefinition id).
    expect(body.data.agentId).toBe(TASK_ID);
    expect(body.data.createdAt).toBe('2024-03-04T05:06:07.000Z');
    expect(body.data.status).toBe('running');
  });

  it('200 surfaces virtual cancelled status for user-cancelled runs', async () => {
    // User-cancelled rows live as failed + "cancelled by user" in DB;
    // the GET response must show `status='cancelled'` so clients see a
    // consistent result right after they hit POST /cancel.
    mockGetById.mockResolvedValue({
      ...SAMPLE_RUN,
      status: 'failed',
      errorMessage: 'cancelled by user',
    });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; errorMessage: string | null };
    };
    expect(body.data.status).toBe('cancelled');
    expect(body.data.errorMessage).toBe('cancelled by user');
  });

  it('200 shows failed (not cancelled) for non-user failures', async () => {
    mockGetById.mockResolvedValue({
      ...SAMPLE_RUN,
      status: 'failed',
      errorMessage: 'something else went wrong',
    });
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    const res = await GET(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('failed');
  });
});

/**
 * Tests for POST /api/v1/agents/:agentId/runs/:runId/cancel.
 *
 * Covers the full RunService error surface:
 * - cancel on a cancellable state → 200 with status='cancelled' override
 * - cancel on a terminal state → idempotent 200 with status='cancelled'
 * - cancel on finalizing_retryable_failed → 400 VALIDATION_ERROR
 * - RunNotFound / cross-agent probing → 404
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAuthenticate,
  mockHasScope,
  mockVerifyProjectAccess,
  mockGetById,
  mockCancelRun,
  dbFake,
  FakeRunAlreadyTerminalError,
  FakeRunCannotCancelError,
} = vi.hoisted(() => {
  class AlreadyTerminal extends Error {
    readonly status: string;
    constructor(_runId: string, status: string) {
      super('already terminal');
      this.name = 'RunAlreadyTerminalError';
      this.status = status;
    }
  }
  class CannotCancel extends Error {
    readonly status: string;
    constructor(_runId: string, status: string) {
      super('cannot cancel');
      this.name = 'RunCannotCancelError';
      this.status = status;
    }
  }

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
    mockCancelRun: vi.fn(),
    dbFake: {
      __select: selectSpy,
      select: (...projArgs: unknown[]) => makeSelectChain(projArgs),
    },
    FakeRunAlreadyTerminalError: AlreadyTerminal,
    FakeRunCannotCancelError: CannotCancel,
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
    getById = mockGetById;
    cancelRun = mockCancelRun;
  },
  RunAlreadyTerminalError: FakeRunAlreadyTerminalError,
  RunCannotCancelError: FakeRunCannotCancelError,
  RunNotFoundError: class extends Error {},
  IdempotencyConflictError: class extends Error {},
}));

vi.mock('@open-rush/db', () => ({
  getDbClient: () => dbFake,
  tasks: { id: 't.id', projectId: 't.pid' },
}));

vi.mock('drizzle-orm', () => ({
  eq: (c: unknown, v: unknown) => ({ type: 'eq', c, v }),
}));

import { POST } from './route';

const PROJECT_ID = '00000000-0000-0000-0000-000000000001';
const TASK_ID = '00000000-0000-0000-0000-000000000111';
const RUN_ID = '00000000-0000-0000-0000-000000000222';

function sessionAuth() {
  return { userId: 'user-1', scopes: ['*'], authType: 'session' as const };
}

function params(agentId: string, runId: string) {
  return Promise.resolve({ agentId, runId });
}

function req(): Request {
  return new Request(`https://t/api/v1/agents/${TASK_ID}/runs/${RUN_ID}/cancel`, {
    method: 'POST',
  });
}

const BASE_RUN = {
  id: RUN_ID,
  agentId: '00000000-0000-0000-0000-000000000aaa',
  taskId: TASK_ID,
  conversationId: null,
  parentRunId: null,
  status: 'running' as const,
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

describe('POST /api/v1/agents/:agentId/runs/:runId/cancel', () => {
  it('401 when unauthenticated', async () => {
    mockAuthenticate.mockResolvedValue(null);
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(401);
  });

  it('403 when scope runs:cancel missing', async () => {
    mockHasScope.mockReturnValue(false);
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
    expect(mockHasScope).toHaveBeenCalledWith(expect.anything(), 'runs:cancel');
  });

  it('400 when params are not UUIDs', async () => {
    const res = await POST(req(), { params: params('not-uuid', RUN_ID) });
    expect(res.status).toBe(400);
  });

  it('404 when run does not exist', async () => {
    mockGetById.mockResolvedValue(null);
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('404 when run belongs to different Agent', async () => {
    mockGetById.mockResolvedValue({ ...BASE_RUN, taskId: '00000000-0000-0000-0000-000000000999' });
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(404);
  });

  it('403 when caller lacks project access', async () => {
    mockGetById.mockResolvedValue(BASE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockVerifyProjectAccess.mockResolvedValue(false);
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(403);
  });

  it('200 cancels Run + overrides status to cancelled', async () => {
    mockGetById.mockResolvedValue(BASE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockCancelRun.mockResolvedValue({
      ...BASE_RUN,
      status: 'failed',
      errorMessage: 'cancelled by user',
    });
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { status: string; errorMessage: string | null };
    };
    // Service returned 'failed'; wire MUST show 'cancelled'.
    expect(body.data.status).toBe('cancelled');
    expect(body.data.errorMessage).toBe('cancelled by user');
    expect(mockCancelRun).toHaveBeenCalledWith(RUN_ID);
  });

  it('200 idempotent: already-terminal run returns status cancelled', async () => {
    mockGetById.mockResolvedValueOnce(BASE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockCancelRun.mockRejectedValue(new FakeRunAlreadyTerminalError(RUN_ID, 'completed'));
    // Pre-flight `getById` already loaded the run; the idempotent
    // branch calls `getById` again — prime a fresh terminal row.
    mockGetById.mockResolvedValueOnce({
      ...BASE_RUN,
      status: 'completed',
      completedAt: new Date('2024-03-04T05:06:08.000Z'),
    });
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { status: string } };
    expect(body.data.status).toBe('cancelled');
  });

  it('400 VALIDATION_ERROR on finalizing_retryable_failed', async () => {
    mockGetById.mockResolvedValue(BASE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockCancelRun.mockRejectedValue(
      new FakeRunCannotCancelError(RUN_ID, 'finalizing_retryable_failed')
    );
    const res = await POST(req(), { params: params(TASK_ID, RUN_ID) });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; hint?: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.hint).toMatch(/retry/i);
  });

  it('rethrows unknown errors (surfaces 500 in Next.js runtime)', async () => {
    mockGetById.mockResolvedValue(BASE_RUN);
    dbFake.__select.mockReturnValueOnce([{ projectId: PROJECT_ID }]);
    mockCancelRun.mockRejectedValue(new Error('boom'));
    await expect(POST(req(), { params: params(TASK_ID, RUN_ID) })).rejects.toThrow('boom');
  });
});

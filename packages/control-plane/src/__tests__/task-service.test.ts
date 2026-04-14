import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CreateTaskInput,
  type Task,
  type TaskDb,
  TaskService,
  type UpdateTaskInput,
} from '../task/task-service.js';

class InMemoryTaskDb implements TaskDb {
  private tasks = new Map<string, Task>();

  async create(input: CreateTaskInput): Promise<Task> {
    const now = new Date();
    const task: Task = {
      id: randomUUID(),
      projectId: input.projectId,
      agentId: input.agentId ?? null,
      createdBy: input.createdBy,
      title: input.title ?? null,
      status: input.status ?? 'active',
      handoffSummary: input.handoffSummary ?? null,
      headRunId: null,
      activeRunId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async findById(id: string): Promise<Task | null> {
    return this.tasks.get(id) ?? null;
  }

  async listByProject(projectId: string, limit = 50): Promise<Task[]> {
    return Array.from(this.tasks.values())
      .filter((task) => task.projectId === projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) return null;
    Object.assign(task, input, { updatedAt: new Date() });
    return task;
  }
}

describe('TaskService', () => {
  let service: TaskService;
  const projectId = randomUUID();
  const userId = randomUUID();

  beforeEach(() => {
    service = new TaskService(new InMemoryTaskDb());
  });

  it('creates a task with defaults', async () => {
    const task = await service.create({ projectId, createdBy: userId });
    expect(task.projectId).toBe(projectId);
    expect(task.createdBy).toBe(userId);
    expect(task.status).toBe('active');
    expect(task.agentId).toBeNull();
  });

  it('trims title on create', async () => {
    const task = await service.create({
      projectId,
      createdBy: userId,
      title: '  Implement auth  ',
    });
    expect(task.title).toBe('Implement auth');
  });

  it('lists tasks by project', async () => {
    await service.create({ projectId, createdBy: userId, title: 'A' });
    await service.create({ projectId, createdBy: userId, title: 'B' });
    await service.create({ projectId: randomUUID(), createdBy: userId, title: 'Other' });
    const tasks = await service.listByProject(projectId);
    expect(tasks).toHaveLength(2);
  });

  it('updates activeRunId and headRunId', async () => {
    const task = await service.create({ projectId, createdBy: userId });
    const activeRunId = randomUUID();
    const headRunId = randomUUID();

    const active = await service.setActiveRunId(task.id, activeRunId);
    expect(active.activeRunId).toBe(activeRunId);

    const head = await service.setHeadRunId(task.id, headRunId);
    expect(head.headRunId).toBe(headRunId);
  });

  it('updates handoff summary', async () => {
    const task = await service.create({ projectId, createdBy: userId });
    const updated = await service.setHandoffSummary(task.id, 'Continue implementing auth');
    expect(updated.handoffSummary).toContain('auth');
  });

  it('throws when updating unknown task', async () => {
    await expect(service.setActiveRunId(randomUUID(), randomUUID())).rejects.toThrow(
      'Task not found'
    );
  });
});

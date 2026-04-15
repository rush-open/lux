import { type DbClient, tasks } from '@open-rush/db';
import { desc, eq } from 'drizzle-orm';
import type { CreateTaskInput, Task, TaskDb, UpdateTaskInput } from './task-service.js';

type TaskRow = typeof tasks.$inferSelect;

function mapRow(row: TaskRow): Task {
  return {
    id: row.id,
    projectId: row.projectId,
    agentId: row.agentId,
    createdBy: row.createdBy,
    title: row.title,
    status: row.status,
    handoffSummary: row.handoffSummary,
    headRunId: row.headRunId,
    activeRunId: row.activeRunId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleTaskDb implements TaskDb {
  constructor(private db: DbClient) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const [row] = await this.db
      .insert(tasks)
      .values({
        projectId: input.projectId,
        createdBy: input.createdBy,
        agentId: input.agentId ?? null,
        title: input.title ?? null,
        status: input.status ?? 'active',
        handoffSummary: input.handoffSummary ?? null,
      })
      .returning();
    return mapRow(row);
  }

  async findById(id: string): Promise<Task | null> {
    const [row] = await this.db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
    return row ? mapRow(row) : null;
  }

  async listByProject(projectId: string, limit = 50): Promise<Task[]> {
    const rows = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.updatedAt))
      .limit(limit);
    return rows.map(mapRow);
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task | null> {
    const updates: Partial<typeof tasks.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (input.agentId !== undefined) updates.agentId = input.agentId;
    if (input.title !== undefined) updates.title = input.title;
    if (input.status !== undefined) updates.status = input.status;
    if (input.handoffSummary !== undefined) updates.handoffSummary = input.handoffSummary;
    if (input.headRunId !== undefined) updates.headRunId = input.headRunId;
    if (input.activeRunId !== undefined) updates.activeRunId = input.activeRunId;

    const [row] = await this.db.update(tasks).set(updates).where(eq(tasks.id, id)).returning();
    return row ? mapRow(row) : null;
  }
}

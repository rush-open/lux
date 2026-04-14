import { DrizzleTaskDb, TaskService } from '@open-rush/control-plane';
import { getDbClient, runs } from '@open-rush/db';
import { eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: taskId } = await params;
  const db = getDbClient();
  const taskService = new TaskService(new DrizzleTaskDb(db));
  const task = await taskService.getById(taskId);
  if (!task) {
    return apiError(404, 'TASK_NOT_FOUND', `Task ${taskId} not found`);
  }
  if (task.createdBy !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this task');
  }

  let activeRunPrompt: string | null = null;
  if (task.activeRunId) {
    const [row] = await db
      .select({ prompt: runs.prompt })
      .from(runs)
      .where(eq(runs.id, task.activeRunId))
      .limit(1);
    activeRunPrompt = row?.prompt ?? null;
  }

  return apiSuccess({
    id: task.id,
    projectId: task.projectId,
    agentId: task.agentId,
    title: task.title,
    status: task.status,
    handoffSummary: task.handoffSummary,
    headRunId: task.headRunId,
    activeRunId: task.activeRunId,
    activeRunPrompt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  });
}

import { CreateTaskConversationRequest } from '@open-rush/contracts';
import {
  ConversationService,
  DrizzleConversationDb,
  DrizzleTaskDb,
  TaskService,
} from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { resolveAgentIdForProject } from '@/lib/agents/resolve-agent-id';
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id: taskId } = await params;

  let body: unknown;
  try {
    body = await request.json().catch(() => ({}));
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateTaskConversationRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const db = getDbClient();
  const taskService = new TaskService(new DrizzleTaskDb(db));
  const task = await taskService.getById(taskId);
  if (!task) {
    return apiError(404, 'TASK_NOT_FOUND', 'Task not found');
  }

  const hasAccess = await verifyProjectAccess(task.projectId, userId);
  if (!hasAccess || task.createdBy !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this task');
  }

  let agentId = task.agentId;
  if (parsed.data.agentId) {
    if (task.agentId && parsed.data.agentId !== task.agentId) {
      return apiError(400, 'INVALID_AGENT', 'Agent does not match the task agent');
    }

    try {
      agentId = await resolveAgentIdForProject({
        db,
        projectId: task.projectId,
        userId,
        requestedAgentId: parsed.data.agentId,
      });
    } catch (error) {
      return apiError(
        400,
        'INVALID_AGENT',
        error instanceof Error ? error.message : 'Invalid agent'
      );
    }
  }

  if (!agentId) {
    return apiError(400, 'MISSING_AGENT', 'Task does not have an active agent');
  }

  const conversationService = new ConversationService(new DrizzleConversationDb(db));
  const conversation = await conversationService.create({
    projectId: task.projectId,
    taskId: task.id,
    userId,
    agentId,
    title: parsed.data.title,
  });

  return apiSuccess(conversation, 201);
}

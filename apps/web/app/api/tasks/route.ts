import { CreateTaskRequest } from '@open-rush/contracts';
import { DrizzleTaskDb, TaskService } from '@open-rush/control-plane';
import { getDbClient } from '@open-rush/db';
import { resolveAgentIdForProject } from '@/lib/agents/resolve-agent-id';
import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateTaskRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const { projectId, title } = parsed.data;
  const db = getDbClient();

  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  let agentId: string;
  try {
    agentId = await resolveAgentIdForProject({
      db,
      projectId,
      userId,
      requestedAgentId: parsed.data.agentId,
    });
  } catch (error) {
    return apiError(400, 'INVALID_AGENT', error instanceof Error ? error.message : 'Invalid agent');
  }

  const taskService = new TaskService(new DrizzleTaskDb(db));
  const task = await taskService.create({
    projectId,
    createdBy: userId,
    agentId,
    title: title ?? null,
  });

  return apiSuccess(task, 201);
}

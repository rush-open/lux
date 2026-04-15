import { CreateRunRequest } from '@open-rush/contracts';
import {
  DrizzleAgentConfigStore,
  DrizzleRunDb,
  DrizzleTaskDb,
  isTerminal,
  ProjectAgentService,
  RunService,
  TaskService,
} from '@open-rush/control-plane';
import { conversations, getDbClient, projects, tasks } from '@open-rush/db';
import { and, eq, isNull } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth, verifyProjectAccess } from '@/lib/api-utils';
import { getQueue } from '@/lib/queue';

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  // Parse & validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, 'VALIDATION_ERROR', 'Invalid JSON body');
  }

  const parsed = CreateRunRequest.safeParse(body);
  if (!parsed.success) {
    return apiError(400, 'VALIDATION_ERROR', parsed.error.issues[0].message);
  }

  const { prompt, projectId, taskId, conversationId, connectionMode, model, triggerSource } =
    parsed.data;
  let { agentId } = parsed.data;

  // Verify project exists and user has access
  const db = getDbClient();
  const taskService = new TaskService(new DrizzleTaskDb(db));
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) {
    return apiError(404, 'PROJECT_NOT_FOUND', `Project ${projectId} not found`);
  }
  const hasAccess = await verifyProjectAccess(projectId, userId);
  if (!hasAccess) {
    return apiError(403, 'FORBIDDEN', 'No access to this project');
  }

  let taskRecord:
    | {
        id: string;
        projectId: string;
        agentId: string | null;
        createdBy: string;
        headRunId: string | null;
        activeRunId: string | null;
      }
    | undefined;

  if (taskId && conversationId) {
    const [task, conversation] = await Promise.all([
      db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          agentId: tasks.agentId,
          createdBy: tasks.createdBy,
          headRunId: tasks.headRunId,
          activeRunId: tasks.activeRunId,
        })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .limit(1)
        .then((rows) => rows[0]),
      db
        .select({
          id: conversations.id,
          projectId: conversations.projectId,
          taskId: conversations.taskId,
          userId: conversations.userId,
        })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
        .then((rows) => rows[0]),
    ]);

    if (!task) {
      return apiError(404, 'TASK_NOT_FOUND', `Task ${taskId} not found`);
    }
    if (!conversation) {
      return apiError(404, 'CONVERSATION_NOT_FOUND', `Conversation ${conversationId} not found`);
    }
    if (task.projectId !== projectId) {
      return apiError(
        400,
        'TASK_PROJECT_MISMATCH',
        'Task does not belong to the specified project'
      );
    }
    if (conversation.projectId !== projectId) {
      return apiError(
        400,
        'CONVERSATION_PROJECT_MISMATCH',
        'Conversation does not belong to the specified project'
      );
    }
    if (conversation.taskId !== taskId) {
      return apiError(
        400,
        'CONVERSATION_TASK_MISMATCH',
        'Conversation does not belong to the specified task'
      );
    }
    if (conversation.userId !== userId || task.createdBy !== userId) {
      return apiError(403, 'FORBIDDEN', 'No access to this task conversation');
    }

    taskRecord = task;
    if (taskRecord.activeRunId) {
      const runService = new RunService(new DrizzleRunDb(db));
      const activeRun = await runService.getById(taskRecord.activeRunId);
      if (activeRun && isTerminal(activeRun.status)) {
        const releasedTask = await taskService.update(taskId, {
          activeRunId: null,
          ...(activeRun.status === 'completed' ? { headRunId: activeRun.id } : {}),
        });
        taskRecord = {
          ...taskRecord,
          activeRunId: releasedTask.activeRunId,
          headRunId: releasedTask.headRunId,
        };
      }
    }
  }

  // Resolve agent for the project or task.
  const store = new DrizzleAgentConfigStore(db);
  const projectAgentService = new ProjectAgentService(db);
  if (agentId) {
    if (taskRecord?.agentId && agentId !== taskRecord.agentId) {
      return apiError(400, 'INVALID_AGENT', 'Agent does not match the task agent');
    }

    const existingAgent = await store.getById(agentId);
    if (
      !existingAgent ||
      existingAgent.projectId !== projectId ||
      existingAgent.status !== 'active'
    ) {
      return apiError(400, 'INVALID_AGENT', 'Agent does not belong to this project');
    }

    await projectAgentService.setCurrentAgent(projectId, agentId);
  } else if (taskRecord?.agentId) {
    agentId = taskRecord.agentId;
    const existingAgent = await store.getById(agentId);
    if (
      !existingAgent ||
      existingAgent.projectId !== projectId ||
      existingAgent.status !== 'active'
    ) {
      return apiError(400, 'INVALID_AGENT', 'Task agent is no longer active in this project');
    }
  } else {
    const current = await projectAgentService.getCurrentAgent(projectId);
    if (!current) {
      return apiError(
        400,
        'MISSING_AGENT',
        'No agent selected for this project. Set a current agent first.'
      );
    }
    agentId = current.agentId;
  }

  if (!agentId) {
    return apiError(400, 'MISSING_AGENT', 'Unable to resolve an agent for this run');
  }

  // Create Run in DB
  let run:
    | {
        id: string;
      }
    | undefined;

  if (taskRecord && taskId && conversationId) {
    try {
      run = await db.transaction(async (tx) => {
        const runDb = new DrizzleRunDb(tx as never);
        const runService = new RunService(runDb);
        const created = await runService.createRun({
          agentId,
          taskId,
          conversationId,
          parentRunId: taskRecord.headRunId ?? undefined,
          prompt,
          connectionMode: connectionMode ?? undefined,
          modelId: model ?? undefined,
          triggerSource: triggerSource ?? undefined,
        });

        // Try CAS: claim the task lock
        const [claimedTask] = await tx
          .update(tasks)
          .set({ activeRunId: created.id, updatedAt: new Date() })
          .where(and(eq(tasks.id, taskId), isNull(tasks.activeRunId)))
          .returning({ id: tasks.id });

        if (!claimedTask) {
          // CAS failed — check if the blocker is actually a terminal run (stale lock).
          // If so, release the stale lock and retry the claim inside the same transaction.
          const [staleCheck] = await tx
            .select({ activeRunId: tasks.activeRunId })
            .from(tasks)
            .where(eq(tasks.id, taskId));
          if (staleCheck?.activeRunId) {
            const blocker = await runService.getById(staleCheck.activeRunId);
            if (blocker && isTerminal(blocker.status)) {
              // Stale lock — release and retry
              await tx
                .update(tasks)
                .set({
                  activeRunId: created.id,
                  headRunId: blocker.status === 'completed' ? blocker.id : undefined,
                  updatedAt: new Date(),
                })
                .where(eq(tasks.id, taskId));
              return created;
            }
          }
          throw new Error('TASK_ACTIVE_RUN_CONFLICT');
        }

        return created;
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TASK_ACTIVE_RUN_CONFLICT') {
        const latestTask = await taskService.getById(taskId);
        return Response.json(
          {
            success: false,
            code: 'TASK_ALREADY_RUNNING',
            error: 'This task already has an active run',
            data: { activeRunId: latestTask?.activeRunId ?? null },
          },
          { status: 409 }
        );
      }
      throw error;
    }
  } else {
    const runDb = new DrizzleRunDb(db);
    const runService = new RunService(runDb);
    run = await runService.createRun({
      agentId,
      prompt,
      connectionMode: connectionMode ?? undefined,
      modelId: model ?? undefined,
      triggerSource: triggerSource ?? undefined,
    });
  }

  // Enqueue pg-boss job
  const queue = await getQueue();
  await queue.send('run/execute', {
    runId: run.id,
    prompt,
    agentId,
  });

  return apiSuccess({ runId: run.id, agentId, isNewAgent: false }, 201);
}

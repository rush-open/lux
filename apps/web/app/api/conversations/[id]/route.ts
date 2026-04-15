import {
  ConversationService,
  DrizzleConversationDb,
  reconstructMessages,
} from '@open-rush/control-plane';
import { getDbClient, runEvents, runs } from '@open-rush/db';
import { eq } from 'drizzle-orm';

import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));

  const conversation = await service.getById(id);
  if (!conversation) {
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }

  // Ownership check: only the conversation creator can view it
  if (conversation.userId !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  // Runs scoped to this chat window (task-chat-run model)
  const associatedRuns = await db
    .select()
    .from(runs)
    .where(eq(runs.conversationId, id))
    .orderBy(runs.createdAt);

  // Reconstruct messages from each run's events
  const allMessages = [];
  for (const run of associatedRuns) {
    const events = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.runId, run.id))
      .orderBy(runEvents.seq);

    const messages = reconstructMessages(run.prompt, events);
    allMessages.push(...messages);
  }

  return apiSuccess({
    conversation,
    messages: allMessages,
    runCount: associatedRuns.length,
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    return res as Response;
  }

  const { id } = await params;
  const db = getDbClient();
  const service = new ConversationService(new DrizzleConversationDb(db));

  const conversation = await service.getById(id);
  if (!conversation) {
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }

  // Only conversation creator can delete
  if (conversation.userId !== userId) {
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  await service.remove(id);
  return apiSuccess({ deleted: true });
}

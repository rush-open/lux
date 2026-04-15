/**
 * Messages API — GET/POST /api/chat/[conversationId]/messages
 *
 * GET: Load messages for a conversation
 * POST: Save messages for a conversation (used by auto-save)
 */

import { conversations, getDbClient, messages as messagesTable } from '@open-rush/db';
import { createLogger } from '@open-rush/observability';
import { eq } from 'drizzle-orm';
import { apiError, apiSuccess, requireAuth } from '@/lib/api-utils';

const logger = createLogger({ service: 'web:messages-api' });

/** Verify the conversation exists and belongs to the current user. */
async function verifyConversationOwner(conversationId: string, userId: string) {
  const db = getDbClient();
  const [conv] = await db
    .select({ userId: conversations.userId })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1);

  if (!conv) return 'NOT_FOUND' as const;
  if (conv.userId !== userId) return 'FORBIDDEN' as const;
  return 'OK' as const;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const requestId = request.headers.get('x-request-id') || `msg-get-${Date.now()}`;

  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    logger.warn({ requestId }, '🚫 Auth failed');
    return res as Response;
  }

  const { conversationId } = await params;
  logger.info({ requestId, userId, conversationId }, '📨 GET messages request');

  const check = await verifyConversationOwner(conversationId, userId);
  if (check === 'NOT_FOUND') {
    logger.warn({ requestId, conversationId }, '⚠️ Conversation not found');
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }
  if (check === 'FORBIDDEN') {
    logger.warn({ requestId, conversationId, userId }, '🚫 Forbidden access');
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  const db = getDbClient();
  const rows = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt);

  logger.info({ requestId, conversationId, count: rows.length }, '✅ Messages loaded');

  const uiMessages = rows.map((row) => row.content);
  return apiSuccess(uiMessages);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  const requestId = request.headers.get('x-request-id') || `msg-post-${Date.now()}`;

  let userId: string;
  try {
    userId = await requireAuth();
  } catch (res) {
    logger.warn({ requestId }, '🚫 Auth failed');
    return res as Response;
  }

  const { conversationId } = await params;
  logger.info({ requestId, userId, conversationId }, '📨 POST messages request (auto-save)');

  const check = await verifyConversationOwner(conversationId, userId);
  if (check === 'NOT_FOUND') {
    logger.warn({ requestId, conversationId }, '⚠️ Conversation not found');
    return apiError(404, 'NOT_FOUND', 'Conversation not found');
  }
  if (check === 'FORBIDDEN') {
    logger.warn({ requestId, conversationId, userId }, '🚫 Forbidden access');
    return apiError(403, 'FORBIDDEN', 'No access to this conversation');
  }

  const body = await request.json();
  const { messages, model } = body as {
    messages: Array<{ id: string; role: string; parts?: unknown[]; [key: string]: unknown }>;
    model?: string;
  };

  if (!Array.isArray(messages)) {
    logger.warn({ requestId }, '⚠️ Invalid messages format');
    return apiError(400, 'VALIDATION_ERROR', 'messages must be an array');
  }

  logger.info({ requestId, conversationId, count: messages.length }, '💾 Saving messages...');

  const db = getDbClient();

  try {
    // Atomic replace: delete + insert in a transaction
    await db.transaction(async (tx) => {
      await tx.delete(messagesTable).where(eq(messagesTable.conversationId, conversationId));

      if (messages.length > 0) {
        await tx.insert(messagesTable).values(
          messages.map((msg) => ({
            conversationId,
            role: msg.role,
            content: msg,
            model: model ?? null,
          }))
        );
      }
    });

    logger.info({ requestId, conversationId, saved: messages.length }, '✅ Messages saved');
    return apiSuccess({ saved: messages.length });
  } catch (err) {
    logger.error({ requestId, conversationId, error: err }, '❌ Failed to save messages');
    return apiError(500, 'SAVE_ERROR', 'Failed to save messages');
  }
}

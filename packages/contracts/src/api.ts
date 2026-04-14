import { z } from 'zod';
import { RunSpec } from './run.js';

export const CreateRunRequest = RunSpec.superRefine((data, ctx) => {
  const hasTaskId = data.taskId !== undefined;
  const hasConversationId = data.conversationId !== undefined;

  if (hasTaskId !== hasConversationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'taskId and conversationId must be provided together',
      path: hasTaskId ? ['conversationId'] : ['taskId'],
    });
  }
});
export type CreateRunRequest = z.infer<typeof CreateRunRequest>;

export const CreateRunResponse = z.object({
  runId: z.string().uuid(),
  agentId: z.string().uuid(),
  isNewAgent: z.boolean(),
});
export type CreateRunResponse = z.infer<typeof CreateRunResponse>;

export const ApiResponse = z.object({
  success: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
});
export type ApiResponse = z.infer<typeof ApiResponse>;

import { z } from 'zod';

export const Task = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  agentId: z.string().uuid().nullable().default(null),
  createdBy: z.string().uuid(),
  title: z.string().nullable().default(null),
  status: z.string().default('active'),
  handoffSummary: z.string().nullable().default(null),
  headRunId: z.string().uuid().nullable().default(null),
  activeRunId: z.string().uuid().nullable().default(null),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Task = z.infer<typeof Task>;

export const CreateTaskRequest = z.object({
  projectId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  title: z.string().min(1).optional(),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequest>;

export const CreateTaskConversationRequest = z.object({
  title: z.string().min(1).optional(),
  agentId: z.string().uuid().optional(),
});
export type CreateTaskConversationRequest = z.infer<typeof CreateTaskConversationRequest>;

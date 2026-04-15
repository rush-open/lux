import {
  type AnyPgColumn,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { agents } from './agents.js';
import { projects } from './projects.js';
import { runs } from './runs.js';
import { users } from './users.js';

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    handoffSummary: text('handoff_summary'),
    headRunId: uuid('head_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    activeRunId: uuid('active_run_id').references((): AnyPgColumn => runs.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('tasks_project_id_idx').on(t.projectId),
    index('tasks_project_updated_at_idx').on(t.projectId, t.updatedAt),
    index('tasks_status_idx').on(t.status),
    index('tasks_head_run_id_idx').on(t.headRunId),
    index('tasks_active_run_id_idx').on(t.activeRunId),
  ]
);

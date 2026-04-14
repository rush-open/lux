export interface Task {
  id: string;
  projectId: string;
  agentId: string | null;
  createdBy: string;
  title: string | null;
  status: string;
  handoffSummary: string | null;
  headRunId: string | null;
  activeRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTaskInput {
  projectId: string;
  createdBy: string;
  agentId?: string | null;
  title?: string | null;
  status?: string;
  handoffSummary?: string | null;
}

export interface UpdateTaskInput {
  agentId?: string | null;
  title?: string | null;
  status?: string;
  handoffSummary?: string | null;
  headRunId?: string | null;
  activeRunId?: string | null;
}

export interface TaskDb {
  create(input: CreateTaskInput): Promise<Task>;
  findById(id: string): Promise<Task | null>;
  listByProject(projectId: string, limit?: number): Promise<Task[]>;
  update(id: string, input: UpdateTaskInput): Promise<Task | null>;
}

export class TaskService {
  constructor(private db: TaskDb) {}

  async create(input: CreateTaskInput): Promise<Task> {
    const title = input.title?.trim() ?? null;
    if (title !== null && title.length === 0) {
      throw new Error('Task title cannot be empty');
    }
    return this.db.create({ ...input, title });
  }

  async getById(id: string): Promise<Task | null> {
    return this.db.findById(id);
  }

  async listByProject(projectId: string, limit = 50): Promise<Task[]> {
    return this.db.listByProject(projectId, limit);
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    if (input.title !== undefined) {
      const title = input.title?.trim() ?? null;
      if (title !== null && title.length === 0) {
        throw new Error('Task title cannot be empty');
      }
      input = { ...input, title };
    }

    const updated = await this.db.update(id, input);
    if (!updated) throw new Error('Task not found');
    return updated;
  }

  async setActiveRunId(id: string, activeRunId: string | null): Promise<Task> {
    return this.update(id, { activeRunId });
  }

  async setHeadRunId(id: string, headRunId: string | null): Promise<Task> {
    return this.update(id, { headRunId });
  }

  async setHandoffSummary(id: string, handoffSummary: string | null): Promise<Task> {
    return this.update(id, { handoffSummary });
  }
}

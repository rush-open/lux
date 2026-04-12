export interface Checkpoint {
  id: string;
  runId: string;
  status: 'in_progress' | 'completed' | 'failed';
  messagesSnapshotRef: string | null;
  workspaceDeltaRef: string | null;
  lastEventSeq: number | null;
  degradedRecovery: boolean;
  createdAt: Date;
}

export interface CheckpointStorage {
  uploadSnapshot(runId: string, data: Buffer): Promise<string>;
  downloadSnapshot(ref: string): Promise<Buffer>;
}

export interface CheckpointDb {
  create(runId: string): Promise<Checkpoint>;
  update(id: string, update: Partial<Checkpoint>): Promise<Checkpoint | null>;
  findLatest(runId: string): Promise<Checkpoint | null>;
}

export class CheckpointService {
  constructor(
    private db: CheckpointDb,
    private storage: CheckpointStorage
  ) {}

  async createCheckpoint(
    runId: string,
    messagesSnapshot: Buffer,
    lastEventSeq: number
  ): Promise<Checkpoint> {
    const checkpoint = await this.db.create(runId);

    const ref = await this.storage.uploadSnapshot(runId, messagesSnapshot);

    const updated = await this.db.update(checkpoint.id, {
      messagesSnapshotRef: ref,
      lastEventSeq,
      status: 'completed',
    });

    if (!updated) throw new Error('Checkpoint not found after create');
    return updated;
  }

  async restoreCheckpoint(
    runId: string
  ): Promise<{ checkpoint: Checkpoint; messages: Buffer } | null> {
    const checkpoint = await this.db.findLatest(runId);
    if (!checkpoint?.messagesSnapshotRef) return null;

    const messages = await this.storage.downloadSnapshot(checkpoint.messagesSnapshotRef);
    return { checkpoint, messages };
  }
}

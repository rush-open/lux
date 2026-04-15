import type { RunEvent } from '@open-rush/contracts';
import { type DbClient, runEvents } from '@open-rush/db';
import { and, desc, eq, gt } from 'drizzle-orm';
import type {
  EventStore,
  EventStoreEvent,
  GapDetectionResult,
  InsertResult,
} from './event-store.js';

function clone(event: RunEvent): RunEvent {
  return {
    ...event,
    payload: structuredClone(event.payload),
    createdAt: new Date(event.createdAt),
  };
}

export class DrizzleEventStore implements EventStore {
  constructor(private db: DbClient) {}

  async append(event: EventStoreEvent): Promise<InsertResult> {
    if (!Number.isInteger(event.seq) || event.seq < 0) {
      throw new Error(`Invalid seq: must be a non-negative integer, got ${event.seq}`);
    }

    const [inserted] = await this.db
      .insert(runEvents)
      .values({
        runId: event.runId,
        eventType: event.eventType,
        payload: structuredClone(event.payload) ?? null,
        seq: event.seq,
        schemaVersion: event.schemaVersion ?? '1',
      })
      .onConflictDoNothing({
        target: [runEvents.runId, runEvents.seq],
      })
      .returning();

    if (inserted) {
      return {
        inserted: true,
        event: clone({
          ...inserted,
          createdAt: inserted.createdAt,
        }),
      };
    }

    const [existing] = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, event.runId), eq(runEvents.seq, event.seq)))
      .limit(1);

    if (!existing) {
      throw new Error(`Failed to read run event ${event.runId}:${event.seq} after conflict`);
    }

    return {
      inserted: false,
      event: clone(existing),
    };
  }

  async getEvents(runId: string, afterSeq = -1): Promise<RunEvent[]> {
    const rows = await this.db
      .select()
      .from(runEvents)
      .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
      .orderBy(runEvents.seq);

    return rows.map(clone);
  }

  async getLastSeq(runId: string): Promise<number> {
    const [last] = await this.db
      .select({ seq: runEvents.seq })
      .from(runEvents)
      .where(eq(runEvents.runId, runId))
      .orderBy(desc(runEvents.seq))
      .limit(1);

    return last?.seq ?? -1;
  }

  async detectGaps(runId: string): Promise<GapDetectionResult> {
    const events = await this.getEvents(runId);
    if (events.length === 0) {
      return { hasGaps: false, missingSeqs: [], lastSeq: -1 };
    }

    const seqs = events.map((event) => event.seq).sort((a, b) => a - b);
    const lastSeq = seqs[seqs.length - 1];
    const missingSeqs: number[] = [];

    for (let i = 0; i <= lastSeq; i += 1) {
      if (!seqs.includes(i)) {
        missingSeqs.push(i);
      }
    }

    return {
      hasGaps: missingSeqs.length > 0,
      missingSeqs,
      lastSeq,
    };
  }
}

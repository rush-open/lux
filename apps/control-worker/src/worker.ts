import {
  AgentExecutor,
  DrizzleAgentConfigStore,
  DrizzleEventStore,
  DrizzleRunDb,
  RunOrchestrator,
  RunService,
} from '@open-rush/control-plane';
import { closeDbClient, getDbClient, runs, tasks } from '@open-rush/db';
import {
  LocalDevSandboxProvider,
  OpenSandboxProvider,
  type SandboxProvider,
} from '@open-rush/sandbox';
import { and, eq } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://rush:rush@localhost:5432/rush';
const OPENSANDBOX_API_URL = process.env.OPENSANDBOX_API_URL ?? 'http://localhost:8090';
const EXEC_HOST = process.env.OPENSANDBOX_EXEC_HOST ?? 'localhost';
const DEV_AGENT_WORKER_URL = process.env.DEV_AGENT_WORKER_URL ?? 'http://127.0.0.1:8787';
const IS_DEV = process.env.NODE_ENV !== 'production';

const noProxyValues = new Set(
  (process.env.NO_PROXY ?? process.env.no_proxy ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
);
for (const host of ['127.0.0.1', 'localhost']) {
  noProxyValues.add(host);
}
process.env.NO_PROXY = Array.from(noProxyValues).join(',');
process.env.no_proxy = process.env.NO_PROXY;

async function main() {
  const boss = new PgBoss(DATABASE_URL);

  const db = getDbClient(DATABASE_URL);
  const runDb = new DrizzleRunDb(db);
  const runService = new RunService(runDb);
  const agentStore = new DrizzleAgentConfigStore(db);
  const agentExecutor = new AgentExecutor({
    resolveAgent: async (agentId, projectId) => {
      const agent = await agentStore.getById(agentId);
      if (!agent || agent.projectId !== projectId || agent.status !== 'active') {
        return null;
      }
      return agent;
    },
    resolveVaultEnv: async () => ({}),
    resolveSkills: async () => [],
    resolveMcpServers: async () => [],
  });
  const sandboxProvider: SandboxProvider = IS_DEV
    ? new LocalDevSandboxProvider({ agentWorkerUrl: DEV_AGENT_WORKER_URL })
    : new OpenSandboxProvider({
        apiUrl: OPENSANDBOX_API_URL,
        execHost: EXEC_HOST,
      });
  const eventStore = new DrizzleEventStore(db);
  const orchestrator = new RunOrchestrator({
    runService,
    sandboxProvider,
    eventStore,
    agentExecutor,
    resolveProjectIdForAgent: async (agentId: string) => {
      const agent = await agentStore.getById(agentId);
      return agent?.projectId ?? null;
    },
    releaseTaskLock: async (runId: string) => {
      const [run] = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
      if (!run?.taskId) return;
      await db
        .update(tasks)
        .set({
          activeRunId: null,
          updatedAt: new Date(),
          ...(run.status === 'completed' ? { headRunId: run.id } : {}),
        })
        .where(and(eq(tasks.id, run.taskId), eq(tasks.activeRunId, runId)));
    },
  });

  boss.on('error', (error: Error) => {
    console.error('pg-boss error:', error);
  });

  await boss.start();

  // pg-boss 12.x requires explicit queue creation
  await boss.createQueue('run/execute');
  await boss.createQueue('run/finalize');
  await boss.createQueue('run/recover');

  console.log('Control worker started');

  await boss.work<{ runId: string; prompt: string; agentId: string }>(
    'run/execute',
    async ([job]) => {
      if (!job) return;
      const { runId, agentId } = job.data;
      if (!runId || !agentId) {
        console.error('run/execute job missing runId or agentId', job.data);
        return;
      }

      // Prefer job data prompt, fallback to DB
      let { prompt } = job.data;
      if (!prompt) {
        const run = await runService.getById(runId);
        if (!run) {
          console.error(`run/execute — run ${runId} not found in DB`);
          return;
        }
        prompt = run.prompt;
      }

      console.log(`Processing run/execute — runId=${runId}, agentId=${agentId}`);
      await orchestrator.execute(runId, prompt, agentId);
      console.log(`Completed run/execute — runId=${runId}`);
    }
  );

  await boss.work<{ runId: string }>('run/finalize', async ([job]) => {
    if (!job) return;
    const { runId } = job.data;
    console.log(`Processing run/finalize — runId=${runId} (handled by orchestrator)`);
    // Finalization is done inline by RunOrchestrator for MVP
  });

  // Recovery: check for stuck runs every 2 minutes
  await boss.schedule('run/recover', '*/2 * * * *');
  await boss.work('run/recover', async () => {
    console.log('Checking for stuck runs...');
    const recovered = await runService.recoverStuckRuns();
    if (recovered.length > 0) {
      console.log(`Recovered ${recovered.length} stuck runs`);
    }
  });

  async function shutdown() {
    console.log('Shutting down control worker...');
    await boss.stop();
    await closeDbClient();
    process.exit(0);
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((error) => {
  console.error('Control worker failed to start:', error);
  process.exit(1);
});

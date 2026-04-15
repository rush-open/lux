import { readdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import {
  ensureProjectDir,
  getWorkspacePathWithSlash,
  type PromptAgentConfig,
  resolveSystemPrompt,
  validateProjectId,
} from '@lux/prompts';
import { streamText } from 'ai';
import { claudeCode } from 'ai-sdk-provider-claude-code';
import { Hono } from 'hono';

const app = new Hono();

// Track active sessions for abort support
const activeSessions = new Map<string, AbortController>();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'agent-worker',
    activeRuns: activeSessions.size,
    timestamp: new Date().toISOString(),
  })
);

app.get('/status', (c) => c.json({ ready: true, activeRuns: activeSessions.size }));

app.post('/prompt', async (c) => {
  const body = await c.req.json();
  const {
    prompt,
    sessionId,
    messages,
    env,
    systemPrompt,
    modelId,
    allowedTools,
    maxTurns,
    projectId,
    agentConfig,
  } = body as {
    prompt?: string;
    sessionId?: string;
    messages?: Array<{ role: string; content: string }>;
    env?: Record<string, string>;
    systemPrompt?: string;
    modelId?: string;
    allowedTools?: string[];
    maxTurns?: number;
    projectId?: string;
    agentConfig?: PromptAgentConfig;
  };

  // Support both prompt (direct) and messages (AI SDK useChat) formats
  const userPrompt = prompt ?? messages?.filter((m) => m.role === 'user').pop()?.content;
  if (!userPrompt) {
    return c.json({ error: 'prompt is required' }, 400);
  }

  const abortController = new AbortController();
  const sid = sessionId ?? crypto.randomUUID();
  activeSessions.set(sid, abortController);

  // Validate projectId before entering the try block so it returns 400, not 500
  if (projectId) {
    try {
      validateProjectId(projectId);
    } catch (err: unknown) {
      activeSessions.delete(sid);
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 400);
    }
  }

  try {
    // --- Workspace setup ---
    // If projectId is provided, ensure the project directory exists
    // and resolve the system prompt using the prompt resolver
    let effectiveSystemPrompt = systemPrompt;
    let projectPath: string | undefined;

    if (projectId) {
      projectPath = ensureProjectDir(projectId);
      console.log(`[Workspace] Project directory ready: ${projectPath}`);

      // If agentConfig is provided, resolve system prompt via prompt-resolver
      // Otherwise fall back to the raw systemPrompt from the request
      if (agentConfig) {
        const workspacePath = getWorkspacePathWithSlash();
        effectiveSystemPrompt = resolveSystemPrompt(agentConfig, {
          projectId,
          workspacePath,
        });
        console.log(
          `[Prompt] Resolved system prompt for agent: ${agentConfig.name} (${effectiveSystemPrompt.length} chars)`
        );
      }
    }

    // Model from env: CLAUDE_MODEL / ANTHROPIC_MODEL (Bedrock ARN) or fallback
    const effectiveModelId =
      modelId ?? process.env.CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL ?? 'sonnet';
    const providerEnv: Record<string, string> = {
      ...(env ?? {}),
      ...(process.env.ANTHROPIC_BASE_URL && { ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL }),
      ...(process.env.ANTHROPIC_API_KEY && { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY }),
    };

    const hasWorkspaceContent = projectPath && readdirSync(projectPath).length > 0;

    const result = streamText({
      model: claudeCode(effectiveModelId, {
        permissionMode: 'bypassPermissions',
        maxTurns: maxTurns ?? 30,
        sessionId: sid,
        ...(allowedTools?.length ? { allowedTools } : {}),
        ...(Object.keys(providerEnv).length > 0 ? { env: providerEnv } : {}),
        ...(hasWorkspaceContent ? { cwd: projectPath } : {}),
      }),
      ...(effectiveSystemPrompt ? { system: effectiveSystemPrompt } : {}),
      prompt: userPrompt,
      abortSignal: abortController.signal,
    });

    // UI message stream (SSE + JSON chunks) — persisted to run_events by control-worker
    const response = result.toUIMessageStreamResponse();

    // Cleanup after stream ends
    Promise.resolve(result.response).then(
      () => activeSessions.delete(sid),
      () => activeSessions.delete(sid)
    );

    return response;
  } catch (err: unknown) {
    activeSessions.delete(sid);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: message }, 500);
  }
});

app.post('/abort', async (c) => {
  const { sessionId } = (await c.req.json()) as { sessionId?: string };
  if (!sessionId) {
    return c.json({ error: 'sessionId is required' }, 400);
  }
  const controller = activeSessions.get(sessionId);
  if (controller) {
    controller.abort();
    activeSessions.delete(sessionId);
    return c.json({ aborted: true });
  }
  return c.json({ aborted: false, reason: 'session not found' }, 404);
});

const port = Number.parseInt(process.env.PORT ?? '8787', 10);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Agent worker listening on http://localhost:${info.port}`);
});

export default app;

import type { CreateSandboxOptions, SandboxInfo, SandboxProvider } from './provider.js';

/**
 * A no-op sandbox provider for local development.
 * Skips real sandbox provisioning and returns a fake sandbox
 * that points to the local agent-worker.
 */
export class LocalDevSandboxProvider implements SandboxProvider {
  private agentWorkerUrl: string;

  constructor(options?: { agentWorkerUrl?: string }) {
    this.agentWorkerUrl = options?.agentWorkerUrl ?? 'http://127.0.0.1:8787';
  }

  async create(_options: CreateSandboxOptions): Promise<SandboxInfo> {
    return {
      id: `local-dev-${Date.now()}`,
      status: 'running',
      endpoint: this.agentWorkerUrl,
      previewUrl: null,
      createdAt: new Date(),
    };
  }

  async destroy(_sandboxId: string): Promise<void> {
    // no-op
  }

  async getInfo(sandboxId: string): Promise<SandboxInfo | null> {
    return {
      id: sandboxId,
      status: 'running',
      endpoint: this.agentWorkerUrl,
      previewUrl: null,
      createdAt: new Date(),
    };
  }

  async healthCheck(_sandboxId: string): Promise<boolean> {
    try {
      const response = await fetch(`${this.agentWorkerUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getEndpointUrl(_sandboxId: string, _port: number): Promise<string | null> {
    return this.agentWorkerUrl;
  }

  async exec(
    _sandboxId: string,
    _command: string
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return { stdout: '', stderr: '', exitCode: 0 };
  }
}

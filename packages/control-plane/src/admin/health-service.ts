export interface ComponentHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latencyMs?: number;
  message?: string;
  checkedAt: Date;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  components: ComponentHealth[];
  checkedAt: Date;
}

export interface HealthCheck {
  name: string;
  check(): Promise<ComponentHealth>;
}

export class HealthService {
  private checks: HealthCheck[] = [];

  register(check: HealthCheck): void {
    this.checks.push(check);
  }

  async getHealth(): Promise<SystemHealth> {
    const results = await Promise.allSettled(this.checks.map((c) => c.check()));

    const components: ComponentHealth[] = results.map((result, i) => {
      if (result.status === 'fulfilled') return result.value;
      return {
        name: this.checks[i].name,
        status: 'unhealthy' as const,
        message: result.reason instanceof Error ? result.reason.message : 'Check failed',
        checkedAt: new Date(),
      };
    });

    const hasUnhealthy = components.some((c) => c.status === 'unhealthy');
    const hasDegraded = components.some((c) => c.status === 'degraded');

    return {
      status: hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy',
      components,
      checkedAt: new Date(),
    };
  }
}

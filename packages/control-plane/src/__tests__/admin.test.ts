import { describe, expect, it } from 'vitest';
import { type DiagnosticsProvider, DiagnosticsService } from '../admin/diagnostics.js';
import { HealthService } from '../admin/health-service.js';

describe('HealthService', () => {
  it('reports healthy when all checks pass', async () => {
    const service = new HealthService();
    service.register({
      name: 'database',
      async check() {
        return { name: 'database', status: 'healthy', latencyMs: 5, checkedAt: new Date() };
      },
    });
    service.register({
      name: 'redis',
      async check() {
        return { name: 'redis', status: 'healthy', latencyMs: 2, checkedAt: new Date() };
      },
    });

    const health = await service.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.components).toHaveLength(2);
  });

  it('reports degraded when one check is degraded', async () => {
    const service = new HealthService();
    service.register({
      name: 'database',
      async check() {
        return { name: 'database', status: 'healthy', checkedAt: new Date() };
      },
    });
    service.register({
      name: 'redis',
      async check() {
        return {
          name: 'redis',
          status: 'degraded',
          message: 'High latency',
          checkedAt: new Date(),
        };
      },
    });

    const health = await service.getHealth();
    expect(health.status).toBe('degraded');
  });

  it('reports unhealthy when any check fails', async () => {
    const service = new HealthService();
    service.register({
      name: 'database',
      async check() {
        return {
          name: 'database',
          status: 'unhealthy',
          message: 'Connection refused',
          checkedAt: new Date(),
        };
      },
    });

    const health = await service.getHealth();
    expect(health.status).toBe('unhealthy');
  });

  it('handles check that throws', async () => {
    const service = new HealthService();
    service.register({
      name: 'broken',
      async check() {
        throw new Error('Check crashed');
      },
    });

    const health = await service.getHealth();
    expect(health.status).toBe('unhealthy');
    expect(health.components[0].message).toBe('Check crashed');
  });

  it('returns empty components when no checks registered', async () => {
    const service = new HealthService();
    const health = await service.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.components).toHaveLength(0);
  });
});

describe('DiagnosticsService', () => {
  it('returns system stats', async () => {
    const provider: DiagnosticsProvider = {
      async getActiveRunCount() {
        return 5;
      },
      async getActiveSandboxCount() {
        return 3;
      },
      async getTotalProjectCount() {
        return 100;
      },
      async getTotalUserCount() {
        return 50;
      },
    };

    const service = new DiagnosticsService(provider);
    const stats = await service.getStats();

    expect(stats.activeRuns).toBe(5);
    expect(stats.activeSandboxes).toBe(3);
    expect(stats.totalProjects).toBe(100);
    expect(stats.totalUsers).toBe(50);
    expect(stats.uptime).toBeGreaterThanOrEqual(0);
    expect(stats.memoryUsageMb).toBeGreaterThan(0);
  });
});

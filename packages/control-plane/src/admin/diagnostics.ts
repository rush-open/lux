export interface SystemStats {
  activeRuns: number;
  activeSandboxes: number;
  totalProjects: number;
  totalUsers: number;
  uptime: number;
  memoryUsageMb: number;
}

export interface DiagnosticsProvider {
  getActiveRunCount(): Promise<number>;
  getActiveSandboxCount(): Promise<number>;
  getTotalProjectCount(): Promise<number>;
  getTotalUserCount(): Promise<number>;
}

export class DiagnosticsService {
  private startTime = Date.now();

  constructor(private provider: DiagnosticsProvider) {}

  async getStats(): Promise<SystemStats> {
    const [activeRuns, activeSandboxes, totalProjects, totalUsers] = await Promise.all([
      this.provider.getActiveRunCount(),
      this.provider.getActiveSandboxCount(),
      this.provider.getTotalProjectCount(),
      this.provider.getTotalUserCount(),
    ]);

    return {
      activeRuns,
      activeSandboxes,
      totalProjects,
      totalUsers,
      uptime: Date.now() - this.startTime,
      memoryUsageMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    };
  }
}

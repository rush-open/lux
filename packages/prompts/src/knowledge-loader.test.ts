import { describe, expect, it } from 'vitest';
import {
  loadBackendIntegrationRules,
  loadLogMonitorRules,
  loadProjectRules,
} from './knowledge-loader.js';
import { createDefaultVariables } from './variable-injector.js';

describe('knowledge-loader', () => {
  const variables = createDefaultVariables({
    workspacePath: '/home/user/workspace/',
    projectId: 'p_test',
    podApiBaseUrl: 'http://localhost:8787',
  });

  describe('loadLogMonitorRules', () => {
    it('should load and inject variables into log-monitor-rules.md', () => {
      const result = loadLogMonitorRules(variables);
      expect(result).toContain('日志监控');
      expect(result).toContain('/home/user/workspace/');
      expect(result).toContain('p_test');
    });

    it('should not contain raw variable placeholders', () => {
      const result = loadLogMonitorRules(variables);
      expect(result).not.toContain('${workspacePath}');
      expect(result).not.toContain('${projectId}');
    });
  });

  describe('loadBackendIntegrationRules', () => {
    it('should load backend-integration-rules.md', () => {
      const result = loadBackendIntegrationRules(variables);
      expect(result).toContain('后端集成');
    });
  });

  describe('loadProjectRules', () => {
    it('should load and inject variables into create-project-rules.md', () => {
      const result = loadProjectRules({
        workspacePath: '/home/user/workspace/',
        projectId: 'p_test',
      });
      expect(result).toContain('项目创建规范');
      expect(result).toContain('/home/user/workspace/');
      expect(result).toContain('p_test');
    });

    it('should include log monitor rules by default', () => {
      const result = loadProjectRules({
        workspacePath: '/home/user/workspace/',
        projectId: 'p_test',
      });
      expect(result).toContain('日志监控');
    });

    it('should exclude log monitor rules when disabled', () => {
      const result = loadProjectRules({
        workspacePath: '/home/user/workspace/',
        projectId: 'p_test',
        includeLogMonitor: false,
        includeBackendIntegration: false,
      });
      expect(result).toContain('项目创建规范');
      expect(result).not.toContain('日志监控');
    });

    it('should include backend integration rules when enabled', () => {
      const result = loadProjectRules({
        workspacePath: '/home/user/workspace/',
        projectId: 'p_test',
        includeBackendIntegration: true,
      });
      expect(result).toContain('后端集成');
    });

    it('should inject podApiBaseUrl', () => {
      const result = loadProjectRules({
        workspacePath: '/home/user/workspace/',
        projectId: 'p_test',
        podApiBaseUrl: 'http://custom:9999',
      });
      expect(result).toContain('http://custom:9999');
    });
  });
});
